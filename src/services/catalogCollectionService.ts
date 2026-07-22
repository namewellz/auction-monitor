import type { HistoricalRepository } from '../database/historicalRepository.js';
import type { CatalogLot, CatalogProvider } from '../scrapers/base/catalogProvider.js';
import type { ScraperFactory } from '../scrapers/scraperFactory.js';
import type { Logger } from '../utils/logger.js';
import { scheduleNextCheck } from './revalidationPolicy.js';
import type { MediaStorageService } from './mediaStorageService.js';

export interface CatalogCollectionProgress {
  running: boolean;
  site?: string;
  currentSite?: string;
  startedAt?: string;
  finishedAt?: string;
  totalPages: number;
  processedPages: number;
  discovered: number;
  saved: number;
  new: number;
  updated: number;
  unchanged: number;
  failed: number;
  mediaQueued: number;
  mediaDownloaded: number;
  mediaFailed: number;
  mediaBytes: number;
  lastError?: string;
}

export class CatalogCollectionService {
  private progress: CatalogCollectionProgress = emptyProgress();

  public constructor(
    private readonly repository: HistoricalRepository,
    private readonly providers: CatalogProvider[],
    private readonly scraperFactory: ScraperFactory,
    private readonly mediaStorage: MediaStorageService,
    private readonly logger: Logger,
    private readonly maxPages: number,
  ) {}

  public getProgress(): CatalogCollectionProgress {
    return { ...this.progress };
  }

  public async collectAll(site?: string): Promise<CatalogCollectionProgress> {
    if (this.progress.running) return this.getProgress();
    const selected = site ? this.providers.filter((provider) => provider.site === site) : this.providers;
    if (!selected.length) throw new Error(`No catalog provider registered for site: ${site ?? 'all'}`);
    this.progress = { ...emptyProgress(), running: true, ...(site ? { site } : {}), startedAt: new Date().toISOString() };
    const runId = await this.repository.startRun(undefined, site);
    const visited = new Set<string>();

    try {
      for (const provider of selected) await this.collectProvider(provider, visited);
      const media = await this.mediaStorage.downloadPending();
      Object.assign(this.progress, {
        mediaQueued: media.queued,
        mediaDownloaded: media.downloaded,
        mediaFailed: media.failed,
        mediaBytes: media.bytes,
        running: false,
        finishedAt: new Date().toISOString(),
      });
      await this.repository.finishRun(runId, {
        discovered: this.progress.discovered,
        collected: this.progress.saved,
        failed: this.progress.failed,
        new: this.progress.new,
        updated: this.progress.updated,
        unchanged: this.progress.unchanged,
      });
      this.logger.info('Catalog collection completed', { ...this.progress });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      Object.assign(this.progress, { running: false, finishedAt: new Date().toISOString(), lastError: message });
      await this.repository.finishRun(
        runId,
        { discovered: this.progress.discovered, collected: this.progress.saved, failed: this.progress.failed + 1,
          new: this.progress.new, updated: this.progress.updated, unchanged: this.progress.unchanged },
        message,
      );
      this.logger.error('Catalog collection failed', { site, error: message });
    }
    return this.getProgress();
  }

  private async collectProvider(provider: CatalogProvider, visited: Set<string>): Promise<void> {
    this.progress.currentSite = provider.site;
    let page = 1;
    let expectedPagesAdded = false;
    while (page <= this.maxPages) {
      const result = await provider.scrapePage(page);
      if (!expectedPagesAdded) {
        const expected = result.pageSize > 0 ? Math.ceil(result.total / result.pageSize) : 1;
        this.progress.totalPages += Math.min(this.maxPages, Math.max(1, expected));
        expectedPagesAdded = true;
      }
      if (!result.lots.length) break;
      await this.savePage(provider, result.lots, visited);
      this.progress.processedPages += 1;
      if (!result.hasNext) break;
      page += 1;
    }
  }

  private async savePage(provider: CatalogProvider, lots: CatalogLot[], visited: Set<string>): Promise<void> {
    for (const lot of lots) {
      if (visited.has(lot.url)) continue;
      visited.add(lot.url);
      this.progress.discovered += 1;
      try {
        const scraped = lot.data ?? await this.scraperFactory.forUrl(lot.url).scrape(lot.url);
        const data = {
          ...scraped,
          ...(lot.classification ? { classification: lot.classification } : {}),
          ...(lot.assetType ? { assetType: lot.assetType } : {}),
        };
        const observation = await this.repository.saveObservation(provider.site, lot.url, data, scheduleNextCheck(data));
        this.progress.saved += 1;
        this.progress[observation.outcome] += 1;
      } catch (error) {
        this.progress.failed += 1;
        this.logger.warn('Catalog lot could not be persisted', {
          site: provider.site,
          source: provider.source,
          url: lot.url,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}

function emptyProgress(): CatalogCollectionProgress {
  return {
    running: false,
    totalPages: 0,
    processedPages: 0,
    discovered: 0,
    saved: 0,
    new: 0,
    updated: 0,
    unchanged: 0,
    failed: 0,
    mediaQueued: 0,
    mediaDownloaded: 0,
    mediaFailed: 0,
    mediaBytes: 0,
  };
}
