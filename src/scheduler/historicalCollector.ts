import cron, { type ScheduledTask } from 'node-cron';
import type { HistoricalRepository } from '../database/historicalRepository.js';
import type { HistoricalCollectorService } from '../services/historicalCollectorService.js';
import type { Logger } from '../utils/logger.js';
import type { MediaStorageService } from '../services/mediaStorageService.js';

export class HistoricalCollectorScheduler {
  private sourceTask: ScheduledTask | undefined;
  private mediaTask: ScheduledTask | undefined;
  private sourceRunning = false;
  private mediaRunning = false;
  private stopped = true;
  private revalidationLoop: Promise<void> | undefined;
  private wakeRevalidationLoop: (() => void) | undefined;

  public constructor(
    private readonly cronExpression: string,
    private readonly repository: HistoricalRepository,
    private readonly collector: HistoricalCollectorService,
    private readonly mediaStorage: MediaStorageService,
    private readonly logger: Logger,
    private readonly batchSize: number,
    private readonly idlePollMs: number,
  ) {}

  public start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.sourceTask = cron.schedule(this.cronExpression, () => void this.tickSources());
    this.mediaTask = cron.schedule(this.cronExpression, () => void this.tickMedia());
    this.revalidationLoop = this.runRevalidationLoop();
    void this.tickSources();
    void this.tickMedia();
    this.logger.info('Historical collector started', {
      cron: this.cronExpression,
      revalidationMode: 'continuous',
      batchSize: this.batchSize,
      idlePollMs: this.idlePollMs,
    });
  }

  public async stop(): Promise<void> {
    this.stopped = true;
    this.sourceTask?.stop();
    this.mediaTask?.stop();
    this.sourceTask = undefined;
    this.mediaTask = undefined;
    this.wakeRevalidationLoop?.();
    await this.revalidationLoop;
    this.revalidationLoop = undefined;
  }

  private async runRevalidationLoop(): Promise<void> {
    while (!this.stopped) {
      try {
        const result = await this.collector.collectDueLots(this.batchSize);
        if (result.discovered > 0) {
          this.logger.info('Due historical lots revalidated', { ...result });
          continue;
        }
      } catch (error) {
        this.logger.error('Continuous revalidation failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      await this.waitForWork();
    }
  }

  private waitForWork(): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.wakeRevalidationLoop = undefined;
        resolve();
      }, this.idlePollMs);
      this.wakeRevalidationLoop = () => {
        clearTimeout(timer);
        this.wakeRevalidationLoop = undefined;
        resolve();
      };
    });
  }

  private async tickSources(): Promise<void> {
    if (this.sourceRunning) return;
    this.sourceRunning = true;

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
    } finally {
      this.sourceRunning = false;
    }
  }

  private async tickMedia(): Promise<void> {
    if (this.mediaRunning) return;
    this.mediaRunning = true;
    try {
      const mediaResult = await this.mediaStorage.downloadPending();
      if (mediaResult.queued > 0) this.logger.info('Pending media downloaded', { ...mediaResult });
    } catch (error) {
      this.logger.error('Pending media processing failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.mediaRunning = false;
    }
  }
}
