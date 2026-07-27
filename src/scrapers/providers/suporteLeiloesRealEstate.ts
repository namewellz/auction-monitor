import type { AuctionScraper } from '../base/auctionScraper.js';
import type { LotData } from '../../types/lot.js';
import { hostMatches } from '../../utils/url.js';
import {
  SuporteLeiloesRealEstateCatalogProvider,
  type SuporteLeiloesDefinition,
} from './suporteLeiloesRealEstateCatalog.js';

export const suporteLeiloesDefinitions = [
  { site: 'trileiloes', host: 'trileiloes.com.br', baseUrl: 'https://trileiloes.com.br' },
  { site: 'valeroleiloes', host: 'valeroleiloes.com.br', baseUrl: 'https://valeroleiloes.com.br', catalogPath: '/' },
] as const;

type Definition = (typeof suporteLeiloesDefinitions)[number];

export class SuporteLeiloesRealEstateScraper implements AuctionScraper {
  public readonly site: string;
  private readonly provider: SuporteLeiloesRealEstateCatalogProvider;

  public constructor(private readonly definition: Definition) {
    this.site = definition.site;
    this.provider = new SuporteLeiloesRealEstateCatalogProvider(definition as SuporteLeiloesDefinition, 0);
  }

  public supports(url: string): boolean {
    return hostMatches(url, [this.definition.host])
      && /\/eventos\/leilao\/.+\/lote(?:\/\d+\/?.*)?$/i.test(new URL(url).pathname);
  }

  public async scrape(url: string): Promise<LotData> {
    return this.provider.scrapeLot(url);
  }
}
