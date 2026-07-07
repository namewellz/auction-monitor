import type { TelegramClient } from './telegram.js';
import type { MessageHandler } from './handlers/messageHandler.js';
import type { Logger } from '../utils/logger.js';

export class TelegramBot {
  private offset: number | undefined;
  private running = false;

  public constructor(
    private readonly telegram: TelegramClient,
    private readonly handler: MessageHandler,
    private readonly logger: Logger,
  ) {}

  public start(): void {
    if (this.running) {
      return;
    }

    this.running = true;
    void this.poll();
    this.logger.info('Telegram bot started');
  }

  public stop(): void {
    this.running = false;
  }

  private async poll(): Promise<void> {
    while (this.running) {
      try {
        const updates = await this.telegram.getUpdates(this.offset);

        for (const update of updates) {
          this.offset = update.update_id + 1;
          if (update.message) {
            await this.handler.handle(update.message);
          }
        }
      } catch (error) {
        this.logger.error('Telegram polling failed', { error: error instanceof Error ? error.message : String(error) });
        await sleep(5000);
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
