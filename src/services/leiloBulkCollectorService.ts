import type { HistoricalRepository } from '../database/historicalRepository.js';
import type { LeiloCatalogScraper } from '../scrapers/providers/leiloCatalog.js';
import type { Logger } from '../utils/logger.js';
import { scheduleNextCheck } from './revalidationPolicy.js';
import type { MediaStorageService } from './mediaStorageService.js';

export interface LeiloCollectionProgress {
  running: boolean;
  startedAt?: string;
  finishedAt?: string;
  totalPages: number;
  processedPages: number;
  discovered: number;
  saved: number;
  failed: number;
  mediaQueued: number;
  mediaDownloaded: number;
  mediaFailed: number;
  mediaBytes: number;
  lastError?: string;
}

export class LeiloBulkCollectorService {
  private progress: LeiloCollectionProgress = emptyProgress();

  public constructor(
    private readonly repository: HistoricalRepository,
    private readonly catalog: LeiloCatalogScraper,
    private readonly mediaStorage: MediaStorageService,
    private readonly logger: Logger,
    private readonly maxPages: number,
  ) {}

  public getProgress(): LeiloCollectionProgress {
    return { ...this.progress };
  }

  public async collectAll(): Promise<LeiloCollectionProgress> {
    if (this.progress.running) return this.getProgress();

    this.progress = { ...emptyProgress(), running: true, startedAt: new Date().toISOString() };
    const runId = await this.repository.startRun();

    try {
      const first = await this.catalog.scrapePage(1);
      const calculatedPages = Math.max(1, Math.ceil(first.total / Math.max(1, first.pageSize)));
      this.progress.totalPages = Math.min(calculatedPages, this.maxPages);
      await this.savePage(first.lots);
      this.progress.processedPages = 1;

      for (let page = 2; page <= this.progress.totalPages; page += 1) {
        const result = await this.catalog.scrapePage(page);
        if (result.lots.length === 0) break;
        await this.savePage(result.lots);
        this.progress.processedPages = page;
      }

      const media = await this.mediaStorage.downloadPending();
      this.progress.mediaQueued = media.queued;
      this.progress.mediaDownloaded = media.downloaded;
      this.progress.mediaFailed = media.failed;
      this.progress.mediaBytes = media.bytes;

      this.progress.running = false;
      this.progress.finishedAt = new Date().toISOString();
      await this.repository.finishRun(runId, {
        discovered: this.progress.discovered,
        collected: this.progress.saved,
        failed: this.progress.failed,
      });
      this.logger.info('Leilo catalog collection completed', { ...this.progress });
      return this.getProgress();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.progress.running = false;
      this.progress.finishedAt = new Date().toISOString();
      this.progress.lastError = message;
      await this.repository.finishRun(
        runId,
        { discovered: this.progress.discovered, collected: this.progress.saved, failed: this.progress.failed + 1 },
        message,
      );
      this.logger.error('Leilo catalog collection failed', { error: message });
      return this.getProgress();
    }
  }

  private async savePage(lots: Array<{ url: string; data: import('../types/lot.js').LotData }>): Promise<void> {
    this.progress.discovered += lots.length;
    for (const lot of lots) {
      try {
        await this.repository.saveObservation('leilo', lot.url, lot.data, scheduleNextCheck(lot.data));
        this.progress.saved += 1;
      } catch (error) {
        this.progress.failed += 1;
        this.logger.warn('Leilo lot could not be persisted', {
          url: lot.url,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}

function emptyProgress(): LeiloCollectionProgress {
  return {
    running: false,
    totalPages: 0,
    processedPages: 0,
    discovered: 0,
    saved: 0,
    failed: 0,
    mediaQueued: 0,
    mediaDownloaded: 0,
    mediaFailed: 0,
    mediaBytes: 0,
  };
}
