import type { LotData } from '../../types/lot.js';
import { hostMatches } from '../../utils/url.js';
import type { AuctionScraper } from '../base/auctionScraper.js';
import { MegaRealEstateCatalogProvider } from './megaRealEstateCatalog.js';

export class MegaRealEstateScraper implements AuctionScraper {
  public readonly site = 'megaleiloes';
  private readonly provider = new MegaRealEstateCatalogProvider(0);

  public supports(url: string): boolean {
    if (!hostMatches(url, ['megaleiloes.com.br'])) return false;
    const path = new URL(url).pathname;
    return /^\/imoveis\/[^/]+\/[a-z]{2}\/[^/]+\/.+-[jxv]\d+\/?$/i.test(path);
  }

  public scrape(url: string): Promise<LotData> {
    return this.provider.scrapeLot(url);
  }
}
