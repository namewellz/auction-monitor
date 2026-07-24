import type { AuctionScraper } from '../base/auctionScraper.js';
import type { LotData } from '../../types/lot.js';
import { hostMatches } from '../../utils/url.js';
import { D1LanceRealEstateCatalogProvider } from './d1LanceRealEstateCatalog.js';

export class D1LanceRealEstateScraper implements AuctionScraper {
  public readonly site = 'd1lance';
  private readonly provider = new D1LanceRealEstateCatalogProvider(0);

  public supports(url: string): boolean {
    return hostMatches(url, ['d1lance.com.br'])
      && /\/lote\/[^/]+\/\d+\/?$/i.test(new URL(url).pathname);
  }

  public scrape(url: string): Promise<LotData> {
    return this.provider.scrapeLot(url);
  }
}
