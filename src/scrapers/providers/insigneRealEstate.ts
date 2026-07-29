import type { AuctionScraper } from '../base/auctionScraper.js';
import type { LotData } from '../../types/lot.js';
import { hostMatches } from '../../utils/url.js';
import { InsigneRealEstateCatalogProvider } from './insigneRealEstateCatalog.js';

export class InsigneRealEstateScraper implements AuctionScraper {
  public readonly site = 'insigneleiloes';
  private readonly provider = new InsigneRealEstateCatalogProvider(0);

  public supports(url: string): boolean {
    return hostMatches(url, ['insigneleiloes.com.br'])
      && /\/lote\/[^/]+\/\d+\/?$/i.test(new URL(url).pathname);
  }

  public scrape(url: string): Promise<LotData> {
    return this.provider.scrapeLot(url);
  }
}
