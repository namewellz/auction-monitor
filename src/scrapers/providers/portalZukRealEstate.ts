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
    const parsed = new URL(url);
    return (hostMatches(url, ['portalzuk.com.br'])
      && /^\/imovel\/[a-z]{2}\/[^/]+\/[^/]+\/[^/]+\/\d+-\d+\/?$/i.test(parsed.pathname))
      || (hostMatches(url, ['comprei.pgfn.gov.br'])
        && /^\/anuncio\/detalhe\/\d+\/?$/i.test(parsed.pathname));
  }

  public scrape(url: string): Promise<LotData> {
    return hostMatches(url, ['comprei.pgfn.gov.br'])
      ? this.provider.scrapePartnerLot(url)
      : this.provider.scrapeLot(url);
  }
}
