import cron, { type ScheduledTask } from 'node-cron';
import type { HistoricalRepository } from '../database/historicalRepository.js';
import type { HistoricalCollectorService } from '../services/historicalCollectorService.js';
import type { Logger } from '../utils/logger.js';
import type { MediaStorageService } from '../services/mediaStorageService.js';

export class HistoricalCollectorScheduler {
  private task: ScheduledTask | undefined;
  private running = false;

  public constructor(
    private readonly cronExpression: string,
    private readonly repository: HistoricalRepository,
    private readonly collector: HistoricalCollectorService,
    private readonly mediaStorage: MediaStorageService,
    private readonly logger: Logger,
    private readonly batchSize: number,
  ) {}

  public start(): void {
    if (this.task) return;
    this.task = cron.schedule(this.cronExpression, () => void this.tick());
    void this.tick();
    this.logger.info('Historical collector started', { cron: this.cronExpression });
  }

  public stop(): void {
    this.task?.stop();
    this.task = undefined;
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      const sources = await this.repository.listDueSources(10);
      for (const source of sources) {
        try {
          const result = await this.collector.scanSource(source);
          this.logger.info('Collection source scanned', { source: source.url, ...result });
        } catch (error) {
          this.logger.error('Collection source failed', {
            source: source.url,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const dueResult = await this.collector.collectDueLots(this.batchSize);
      if (dueResult.discovered > 0) {
        this.logger.info('Due historical lots revalidated', { ...dueResult });
      }

      const mediaResult = await this.mediaStorage.downloadPending();
      if (mediaResult.queued > 0) this.logger.info('Pending media downloaded', { ...mediaResult });
    } finally {
      this.running = false;
    }
  }
}
