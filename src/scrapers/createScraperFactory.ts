import type { AppConfig } from '../config.js';
import { ExampleSiteScraper } from './providers/exampleSite.js';
import { LeiloScraper } from './providers/leilo.js';
import { SuperbidScraper } from './providers/superbid.js';
import { VipLeiloesScraper } from './providers/vipLeiloes.js';
import type { VipLeiloesClient } from './providers/vipLeiloesClient.js';
import { ScraperFactory } from './scraperFactory.js';

export function createScraperFactory(
  config: AppConfig,
  dependencies: { vipClient?: VipLeiloesClient } = {},
): ScraperFactory {
  return new ScraperFactory([
    new VipLeiloesScraper(dependencies.vipClient),
    new LeiloScraper(),
    new SuperbidScraper(),
    new ExampleSiteScraper(config.exampleScraperHosts),
  ]);
}
