import type { HistoricalRepository } from '../database/historicalRepository.js';
import type { ScraperFactory } from '../scrapers/scraperFactory.js';
import type { CatalogDiscoveryService } from './catalogDiscoveryService.js';
import type { Logger } from '../utils/logger.js';
import { scheduleNextCheck } from './revalidationPolicy.js';
import type { CollectionRunResult, CollectionSource } from '../types/historical.js';

export class HistoricalCollectorService {
  public constructor(
    private readonly repository: HistoricalRepository,
    private readonly scraperFactory: ScraperFactory,
    private readonly discovery: CatalogDiscoveryService,
    private readonly logger: Logger,
    private readonly options: { maxDiscoveryPages: number; maxDiscoveryDepth: number; concurrency: number },
  ) {}

  public async collectUrl(url: string, recheckCount = 0): Promise<number> {
    const scraper = this.scraperFactory.forUrl(url);
    const data = await scraper.scrape(url);
    const schedule = scheduleNextCheck(data, recheckCount);
    const observation = await this.repository.saveObservation(scraper.site, url, data, schedule);
    this.logger.info('Historical lot collected', { id: observation.id, outcome: observation.outcome,
      site: scraper.site, url, nextCheckAt: schedule.nextCheckAt });
    return observation.id;
  }

  public async collectDueLots(limit: number): Promise<CollectionRunResult> {
    const due = await this.repository.listDueLots(limit);
    return this.collectUrls(due.map((lot) => ({ url: lot.url, recheckCount: lot.recheckCount })));
  }

  public async revalidateSite(site: string, limit = 10_000): Promise<CollectionRunResult> {
    return this.collectUrls(await this.repository.listSiteLots(site, limit));
  }

  public async scanSource(source: CollectionSource): Promise<CollectionRunResult> {
    const runId = await this.repository.startRun(source.id, source.site);
    try {
      const urls = await this.discovery.discoverLotUrls(source.site, source.url, {
        maxPages: this.options.maxDiscoveryPages,
        maxDepth: this.options.maxDiscoveryDepth,
      });
      const result = await this.collectUrls(urls.map((url) => ({ url, recheckCount: 0 })));
      result.discovered = urls.length;
      await this.repository.markSourceScanned(source);
      await this.repository.finishRun(runId, result);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const result = { discovered: 0, collected: 0, failed: 1, new: 0, updated: 0, unchanged: 0 };
      await this.repository.postponeFailedSource(source);
      await this.repository.finishRun(runId, result, message);
      throw error;
    }
  }

  private async collectUrls(items: Array<{ url: string; recheckCount: number }>): Promise<CollectionRunResult> {
    let collected = 0;
    let failed = 0;
    let newCount = 0;
    let updated = 0;
    let unchanged = 0;
    let cursor = 0;

    const workers = Array.from({ length: Math.max(1, this.options.concurrency) }, async () => {
      while (cursor < items.length) {
        const item = items[cursor++];
        if (!item) continue;
        try {
          const scraper = this.scraperFactory.forUrl(item.url);
          const data = await scraper.scrape(item.url);
          const observation = await this.repository.saveObservation(
            scraper.site, item.url, data, scheduleNextCheck(data, item.recheckCount),
          );
          collected += 1;
          if (observation.outcome === 'new') newCount += 1;
          else if (observation.outcome === 'updated') updated += 1;
          else unchanged += 1;
        } catch (error) {
          failed += 1;
          await this.repository.postponeFailedLot(item.url, item.recheckCount);
          this.logger.error('Historical collection failed', {
            url: item.url,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    });

    await Promise.all(workers);
    return { discovered: items.length, collected, failed, new: newCount, updated, unchanged };
  }
}
