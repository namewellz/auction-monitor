import type { AuctionScraper } from '../base/auctionScraper.js';
import type { LotData } from '../../types/lot.js';
import { hostMatches } from '../../utils/url.js';
import { MilanPageClient, MilanRealEstateCatalogProvider } from './milanRealEstateCatalog.js';

export class MilanRealEstateScraper implements AuctionScraper {
  public readonly site = 'milanleiloes';
  private readonly provider: MilanRealEstateCatalogProvider;

  public constructor(flareSolverrUrl?: string) {
    this.provider = new MilanRealEstateCatalogProvider(0, new MilanPageClient(flareSolverrUrl));
  }

  public supports(url: string): boolean {
    return hostMatches(url, ['milanleiloes.com.br'])
      && /\/leilao\/\d+\/lote\/[^/?#]+/i.test(new URL(url).pathname);
  }

  public async scrape(url: string): Promise<LotData> {
    return this.provider.scrapeLot(url);
  }
}
