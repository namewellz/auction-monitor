import type { LotData } from '../../types/lot.js';
import { hostMatches } from '../../utils/url.js';
import type { AuctionScraper } from '../base/auctionScraper.js';
import { PortalZukClient, PortalZukRealEstateCatalogProvider } from './portalZukRealEstateCatalog.js';

export class PortalZukRealEstateScraper implements AuctionScraper {
  public readonly site = 'portalzuk';
  private readonly provider: PortalZukRealEstateCatalogProvider;

  public constructor(flareSolverrUrl?: string) {
    this.provider = new PortalZukRealEstateCatalogProvider(0, 0, new PortalZukClient(flareSolverrUrl));
  }

  public supports(url: string): boolean {
    return hostMatches(url, ['portalzuk.com.br'])
      && /^\/imovel\/[a-z]{2}\/[^/]+\/[^/]+\/[^/]+\/\d+-\d+\/?$/i.test(new URL(url).pathname);
  }

  public scrape(url: string): Promise<LotData> {
    return this.provider.scrapeLot(url);
  }
}
