import type { CommandRouter } from '../commands/commandRouter.js';
import type { TelegramClient } from '../telegram.js';
import type { Logger } from '../../utils/logger.js';
import type { TelegramMessage } from '../../types/telegram.js';

export class MessageHandler {
  public constructor(
    private readonly telegram: TelegramClient,
    private readonly router: CommandRouter,
    private readonly allowedChatIds: Set<number>,
    private readonly knownChatIds: Set<number>,
    private readonly logger: Logger,
  ) {}

  public async handle(message: TelegramMessage): Promise<void> {
    const chatId = message.chat.id;
    this.knownChatIds.add(chatId);

    if (this.allowedChatIds.size > 0 && !this.allowedChatIds.has(chatId)) {
      this.logger.warn('Rejected message from unauthorized chat', { chatId });
      await this.telegram.sendMessage(chatId, 'Este bot nao esta autorizado para este chat.');
      return;
    }

    if (!message.text) {
      return;
    }

    const response = await this.router.handle(message.text);
    await this.telegram.sendMessage(chatId, response);
  }
}
