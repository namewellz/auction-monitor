import cron, { type ScheduledTask } from 'node-cron';
import type { Logger } from '../utils/logger.js';
import type { CatalogCollectionService } from '../services/catalogCollectionService.js';

export interface CatalogCollectionSchedulerOptions {
  mode: 'continuous' | 'cron';
  cronExpression: string;
  idleMs: number;
  errorBackoffMs: number;
  collectOnStart: boolean;
}

export class CatalogCollectionScheduler {
  private readonly abortController = new AbortController();
  private cronTask: ScheduledTask | undefined;
  private loopPromise: Promise<void> | undefined;

  public constructor(
    private readonly collector: CatalogCollectionService,
    private readonly logger: Logger,
    private readonly invalidateCaches: () => void,
    private readonly options: CatalogCollectionSchedulerOptions,
  ) {}

  public start(): void {
    if (this.options.mode === 'continuous') {
      this.logger.info('Continuous catalog collection scheduler started', {
        idleMs: this.options.idleMs,
        errorBackoffMs: this.options.errorBackoffMs,
      });
      this.loopPromise = this.runContinuous();
      void this.loopPromise.catch((error: unknown) => {
        if (!this.abortController.signal.aborted) {
          this.logger.error('Continuous catalog scheduler stopped unexpectedly', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
      return;
    }

    this.cronTask = cron.schedule(this.options.cronExpression, () => void this.runOnce('cron'));
    this.logger.info('Cron catalog collection scheduler started', {
      cron: this.options.cronExpression,
    });
    if (this.options.collectOnStart) void this.runOnce('startup');
  }

  public stop(): void {
    this.abortController.abort();
    this.cronTask?.stop();
    this.logger.info('Catalog collection scheduler stopped');
  }

  private async runContinuous(): Promise<void> {
    while (!this.abortController.signal.aborted) {
      const result = await this.runOnce('continuous');
      if (this.abortController.signal.aborted) break;
      const waitMs = result === 'failed' ? this.options.errorBackoffMs : this.options.idleMs;
      this.logger.info('Next catalog collection scheduled after current cycle', {
        waitMs,
        reason: result === 'failed' ? 'error-backoff' : 'cycle-completed',
      });
      await abortableDelay(waitMs, this.abortController.signal);
    }
  }

  private async runOnce(trigger: 'continuous' | 'cron' | 'startup'): Promise<'completed' | 'failed' | 'busy'> {
    if (this.collector.getProgress().running) {
      this.logger.info('Catalog collection trigger skipped because a cycle is already active', { trigger });
      return 'busy';
    }

    const startedAt = Date.now();
    try {
      const progress = await this.collector.collectAll();
      this.invalidateCaches();
      const durationMs = Date.now() - startedAt;
      if (progress.lastError) {
        this.logger.warn('Catalog collection cycle finished with error', {
          trigger,
          durationMs,
          error: progress.lastError,
        });
        return 'failed';
      }
      this.logger.info('Catalog collection cycle finished', {
        trigger,
        durationMs,
        discovered: progress.discovered,
        saved: progress.saved,
        failed: progress.failed,
      });
      return 'completed';
    } catch (error) {
      this.invalidateCaches();
      this.logger.error('Catalog collection cycle failed unexpectedly', {
        trigger,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      return 'failed';
    }
  }
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });

    function done(): void {
      clearTimeout(timeout);
      signal.removeEventListener('abort', done);
      resolve();
    }
  });
}
