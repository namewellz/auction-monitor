import type { AuctionScraper } from '../base/auctionScraper.js';
import type { LotData } from '../../types/lot.js';
import { hostMatches } from '../../utils/url.js';
import { SatoRealEstateCatalogProvider } from './satoRealEstateCatalog.js';

export class SatoRealEstateScraper implements AuctionScraper {
  public readonly site = 'satoleiloes';
  private readonly provider = new SatoRealEstateCatalogProvider(0);

  public supports(url: string): boolean {
    return hostMatches(url, ['satoleiloes.com.br'])
      && /\/leiloes\/\d+\/lotes\/\d+\/?$/i.test(new URL(url).pathname);
  }

  public scrape(url: string): Promise<LotData> {
    return this.provider.scrapeLot(url);
  }
}
