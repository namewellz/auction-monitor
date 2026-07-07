import cron, { type ScheduledTask } from 'node-cron';
import type { LotRepository } from '../database/lotRepository.js';
import type { LotService } from '../services/lotService.js';
import type { NotificationService } from '../services/notificationService.js';
import type { Logger } from '../utils/logger.js';
import type { Lot } from '../types/lot.js';
import { formatRemainingTime } from '../utils/format.js';

const alertThresholds = [
  { key: '60m', ms: 60 * 60_000, label: '1 hora' },
  { key: '30m', ms: 30 * 60_000, label: '30 minutos' },
  { key: '15m', ms: 15 * 60_000, label: '15 minutos' },
  { key: '10m', ms: 10 * 60_000, label: '10 minutos' },
  { key: '5m', ms: 5 * 60_000, label: '5 minutos' },
  { key: '1m', ms: 60_000, label: '1 minuto' },
] as const;

export class MonitorScheduler {
  private task: ScheduledTask | undefined;
  private running = false;

  public constructor(
    private readonly cronExpression: string,
    private readonly lots: LotRepository,
    private readonly lotService: LotService,
    private readonly notifications: NotificationService,
    private readonly logger: Logger,
  ) {}

  public start(): void {
    if (this.task) {
      return;
    }

    this.task = cron.schedule(this.cronExpression, () => {
      void this.tick();
    });

    this.logger.info('Monitoring started', { cron: this.cronExpression });
  }

  public stop(): void {
    this.task?.stop();
    this.task = undefined;
  }

  private async tick(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;

    try {
      const lots = await this.lots.listMonitored();
      for (const lot of lots) {
        await this.sendDueEndAlerts(lot);

        if (!shouldCheckNow(lot)) {
          continue;
        }

        await this.refreshLot(lot);
      }
    } finally {
      this.running = false;
    }
  }

  private async refreshLot(lot: Lot): Promise<void> {
    try {
      const result = await this.lotService.refresh(lot);
      await this.notifications.notifyChanges(result.lot, result.changes);
      this.logger.info('Lot checked', { id: lot.id });
    } catch (error) {
      this.logger.error('Scraper failed', { id: lot.id, error: error instanceof Error ? error.message : String(error) });
      await this.lots.markChecked(lot.id);
    }
  }

  private async sendDueEndAlerts(lot: Lot): Promise<void> {
    const remaining = lot.auctionEnd.getTime() - Date.now();
    if (remaining <= 0) {
      return;
    }

    for (const threshold of alertThresholds) {
      if (remaining > threshold.ms) {
        continue;
      }

      const alertKey = `end:${threshold.key}`;
      if (await this.lots.hasAlert(lot.id, alertKey)) {
        continue;
      }

      await this.lots.markAlert(lot.id, alertKey);
      await this.notifications.notifyAll(
        [`Encerramento proximo`, '', `Lote: ${lot.id}`, lot.title, '', `Faltam: ${threshold.label}`, `Tempo estimado: ${formatRemainingTime(lot.auctionEnd)}`].join(
          '\n',
        ),
      );
    }
  }
}

function shouldCheckNow(lot: Lot): boolean {
  if (!lot.lastCheck) {
    return true;
  }

  const elapsed = Date.now() - lot.lastCheck.getTime();
  return elapsed >= monitoringInterval(lot.auctionEnd);
}

function monitoringInterval(auctionEnd: Date): number {
  const remaining = auctionEnd.getTime() - Date.now();

  if (remaining > 24 * 60 * 60_000) return 60 * 60_000;
  if (remaining > 2 * 60 * 60_000) return 15 * 60_000;
  if (remaining > 30 * 60_000) return 5 * 60_000;
  if (remaining > 5 * 60_000) return 60_000;
  return 15_000;
}
