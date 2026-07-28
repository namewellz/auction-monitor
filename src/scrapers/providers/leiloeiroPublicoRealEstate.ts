import type { AuctionScraper } from '../base/auctionScraper.js';
import type { LotData } from '../../types/lot.js';
import { hostMatches } from '../../utils/url.js';
import { LeiloeiroPublicoRealEstateCatalogProvider } from './leiloeiroPublicoRealEstateCatalog.js';

export class LeiloeiroPublicoRealEstateScraper implements AuctionScraper {
  public readonly site = 'leiloeiropublico';
  private readonly provider = new LeiloeiroPublicoRealEstateCatalogProvider(0);

  public supports(url: string): boolean {
    return hostMatches(url, ['leiloeiropublico.com.br'])
      && /\/DetalheLote\.aspx$/i.test(new URL(url).pathname);
  }

  public scrape(url: string): Promise<LotData> {
    return this.provider.scrapeLot(url);
  }
}
