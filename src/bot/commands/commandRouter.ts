import type { LotService } from '../../services/lotService.js';
import type { NotificationService } from '../../services/notificationService.js';
import type { Logger } from '../../utils/logger.js';
import { isLikelyUrl } from '../../utils/url.js';

export class CommandRouter {
  public constructor(
    private readonly lots: LotService,
    private readonly notifications: NotificationService,
    private readonly logger: Logger,
  ) {}

  public async handle(text: string): Promise<string> {
    const trimmed = text.trim();
    if (isLikelyUrl(trimmed)) {
      return this.add(trimmed);
    }

    const [commandRaw = '', ...args] = trimmed.split(/\s+/);
    const command = commandRaw.split('@')[0]?.toLowerCase();

    try {
      switch (command) {
        case '/start':
        case '/help':
          return helpMessage();
        case '/add':
          return this.add(args.join(' '));
        case '/list':
          return this.notifications.formatList(await this.lots.list());
        case '/details':
          return this.details(args[0]);
        case '/remove':
          return this.remove(args[0]);
        case '/pause':
          return this.toggle(args[0], 'pause');
        case '/resume':
          return this.toggle(args[0], 'resume');
        case '/max':
          return this.max(args[0], args[1]);
        default:
          return 'Comando nao reconhecido. Use /help para ver as opcoes.';
      }
    } catch (error) {
      this.logger.error('Command failed', { error: error instanceof Error ? error.message : String(error) });
      return `Nao consegui executar esse comando: ${error instanceof Error ? error.message : 'erro desconhecido'}`;
    }
  }

  private async add(url: string): Promise<string> {
    if (!isLikelyUrl(url)) {
      return 'Envie assim: /add https://site.com.br/lote/12345';
    }

    const { lot, alreadyExists } = await this.lots.add(url);
    this.logger.info('Lot added', { id: lot.id, site: lot.site, alreadyExists });
    return this.notifications.formatAdded(lot, alreadyExists);
  }

  private async details(id: string | undefined): Promise<string> {
    if (!id) {
      return 'Envie assim: /details A17';
    }

    const lot = await this.lots.details(id);
    return lot ? this.notifications.formatDetails(lot) : 'Lote nao encontrado.';
  }

  private async remove(id: string | undefined): Promise<string> {
    if (!id) {
      return 'Envie assim: /remove A17';
    }

    return await this.lots.remove(id) ? `Lote ${id.toUpperCase()} removido.` : 'Lote nao encontrado.';
  }

  private async toggle(id: string | undefined, action: 'pause' | 'resume'): Promise<string> {
    if (!id) {
      return action === 'pause' ? 'Envie assim: /pause A17' : 'Envie assim: /resume A17';
    }

    const ok = action === 'pause' ? await this.lots.pause(id) : await this.lots.resume(id);
    if (!ok) {
      return 'Lote nao encontrado.';
    }

    return action === 'pause' ? `Monitoramento pausado para ${id.toUpperCase()}.` : `Monitoramento retomado para ${id.toUpperCase()}.`;
  }

  private async max(id: string | undefined, value: string | undefined): Promise<string> {
    if (!id || !value) {
      return 'Envie assim: /max A17 25000';
    }

    const parsed = Number(value.replace(/\./g, '').replace(',', '.'));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return 'Informe um valor maximo valido. Exemplo: /max A17 25000';
    }

    return await this.lots.setMaxBidLimit(id, parsed) ? `Limite salvo para ${id.toUpperCase()}.` : 'Lote nao encontrado.';
  }
}

function helpMessage(): string {
  return [
    'Comandos disponiveis:',
    '/add <url>',
    '/list',
    '/details <id>',
    '/remove <id>',
    '/pause <id>',
    '/resume <id>',
    '/max <id> <valor>',
    '',
    'Voce tambem pode enviar apenas a URL do lote.',
  ].join('\n');
}
