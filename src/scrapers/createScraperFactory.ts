import type { AppConfig } from '../config.js';
import { ExampleSiteScraper } from './providers/exampleSite.js';
import { LeiloScraper } from './providers/leilo.js';
import { SuperbidScraper } from './providers/superbid.js';
import { VipLeiloesScraper } from './providers/vipLeiloes.js';
import { FrancoRealEstateScraper } from './providers/francoRealEstate.js';
import { CalilRealEstateScraper } from './providers/calilRealEstate.js';
import { D1LanceRealEstateScraper } from './providers/d1LanceRealEstate.js';
import {
  VlanceRealEstateScraper,
  vlanceRealEstateDefinitions,
} from './providers/vlanceRealEstate.js';
import {
  SuporteLeiloesRealEstateScraper,
  suporteLeiloesDefinitions,
} from './providers/suporteLeiloesRealEstate.js';
import { MilanRealEstateScraper } from './providers/milanRealEstate.js';
import { SatoRealEstateScraper } from './providers/satoRealEstate.js';
import { LeiloeiroPublicoRealEstateScraper } from './providers/leiloeiroPublicoRealEstate.js';
import { InsigneRealEstateScraper } from './providers/insigneRealEstate.js';
import { MegaRealEstateScraper } from './providers/megaRealEstate.js';
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
    new FrancoRealEstateScraper(),
    new CalilRealEstateScraper(),
    new D1LanceRealEstateScraper(),
    ...vlanceRealEstateDefinitions.map((definition) => new VlanceRealEstateScraper(definition)),
    ...suporteLeiloesDefinitions.map((definition) => new SuporteLeiloesRealEstateScraper(definition)),
    new MilanRealEstateScraper(config.milanFlareSolverrUrl),
    new SatoRealEstateScraper(),
    new LeiloeiroPublicoRealEstateScraper(),
    new InsigneRealEstateScraper(),
    new MegaRealEstateScraper(),
    new ExampleSiteScraper(config.exampleScraperHosts),
  ]);
}
