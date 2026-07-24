import type { AuctionScraper } from '../base/auctionScraper.js';
import type { LotData } from '../../types/lot.js';
import { hostMatches } from '../../utils/url.js';
import { CalilRealEstateCatalogProvider } from './calilRealEstateCatalog.js';

export class CalilRealEstateScraper implements AuctionScraper {
  public readonly site = 'calilleiloes';
  private readonly provider = new CalilRealEstateCatalogProvider(0);

  public supports(url: string): boolean {
    if (!hostMatches(url, ['calilleiloes.com.br'])) return false;
    return /^\/item\/\d+\/detalhes\/?$/i.test(new URL(url).pathname);
  }

  public scrape(url: string): Promise<LotData> {
    return this.provider.scrapeLot(url);
  }
}
