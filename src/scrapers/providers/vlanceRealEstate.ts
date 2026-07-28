import type { AuctionScraper } from '../base/auctionScraper.js';
import type { LotData } from '../../types/lot.js';
import { hostMatches } from '../../utils/url.js';
import { AlessandroTeixeiraRealEstateCatalogProvider } from './alessandroTeixeiraRealEstateCatalog.js';

export const vlanceRealEstateDefinitions = [
  { site: 'alessandroteixeira', host: 'alessandroteixeiraleiloes.com.br', baseUrl: 'https://alessandroteixeiraleiloes.com.br' },
  { site: 'alvaroleiloes', host: 'alvaroleiloes.com.br', baseUrl: 'https://alvaroleiloes.com.br' },
  { site: 'brunoleiloes', host: 'brunoleiloes.com.br', baseUrl: 'https://www.brunoleiloes.com.br' },
  { site: 'capitalvalorleiloes', host: 'capitalvalorleiloes.com.br', baseUrl: 'https://www.capitalvalorleiloes.com.br' },
  { site: 'carloferrarileiloes', host: 'carloferrarileiloes.com.br', baseUrl: 'https://www.carloferrarileiloes.com.br' },
  { site: 'dasilvaleiloes', host: 'dasilvaleiloes.com.br', baseUrl: 'https://www.dasilvaleiloes.com.br' },
  { site: 'cidafixerleiloes', host: 'cidafixerleiloes.com.br', baseUrl: 'https://www.cidafixerleiloes.com.br' },
  { site: 'doleiloes', host: 'doleiloes.com.br', baseUrl: 'https://www.doleiloes.com.br' },
  { site: 'akimotoleiloes', host: 'akimotoleiloes.com.br', baseUrl: 'https://www.akimotoleiloes.com.br', catalogType: '3' },
  { site: 'alessandraleiloes', host: 'alessandraleiloes.com.br', baseUrl: 'https://www.alessandraleiloes.com.br', catalogType: '3' },
  { site: 'deonizialeiloes', host: 'deonizialeiloes.com.br', baseUrl: 'https://www.deonizialeiloes.com.br', catalogType: '3' },
  { site: 'jrleiloes', host: 'jrleiloes.com.br', baseUrl: 'https://jrleiloes.com.br', catalogType: '3' },
  { site: 'giordanoleiloes', host: 'giordanoleiloes.com.br', baseUrl: 'https://www.giordanoleiloes.com.br', catalogType: '3' },
  { site: 'franciscofreitasleiloes', host: 'franciscofreitasleiloes.com.br', baseUrl: 'https://franciscofreitasleiloes.com.br', catalogType: '3' },
  { site: 'rioleiloes', host: 'rioleiloes.com.br', baseUrl: 'https://www.rioleiloes.com.br', catalogType: '3' },
  { site: 'hdleiloes', host: 'hdleiloes.com.br', baseUrl: 'https://www.hdleiloes.com.br', catalogType: '3' },
  { site: 'thaisteixeiraleiloes', host: 'thaisteixeiraleiloes.com.br', baseUrl: 'https://www.thaisteixeiraleiloes.com.br', catalogType: '3' },
  { site: 'rigolonleiloes', host: 'rigolonleiloes.com.br', baseUrl: 'https://www.rigolonleiloes.com.br', catalogType: '3' },
  { site: 'leiloesjudiciaisbahia', host: 'leiloesjudiciaisbahia.com.br', baseUrl: 'https://www.leiloesjudiciaisbahia.com.br', catalogType: '3' },
  { site: 'fabioleiloes', host: 'fabioleiloes.com.br', baseUrl: 'https://www.fabioleiloes.com.br', catalogType: '3' },
  { site: 'galvanileiloes', host: 'galvanileiloes.com.br', baseUrl: 'https://www.galvanileiloes.com.br', catalogType: '3' },
  { site: 'joserodovalholeiloes', host: 'joserodovalholeiloes.com.br', baseUrl: 'https://www.joserodovalholeiloes.com.br', catalogType: '3' },
  { site: 'rosioliveiraleiloes', host: 'rosioliveiraleiloes.com.br', baseUrl: 'https://rosioliveiraleiloes.com.br', catalogType: '3' },
  { site: 'fidelisleiloes', host: 'fidelisleiloes.com.br', baseUrl: 'https://www.fidelisleiloes.com.br', catalogType: '3' },
  { site: 'gilsonleiloes', host: 'gilsonleiloes.com.br', baseUrl: 'https://www.gilsonleiloes.com.br', catalogType: '3' },
  { site: 'jdleiloes', host: 'jdleiloes.com.br', baseUrl: 'https://www.jdleiloes.com.br', catalogType: '3' },
  { site: 'mariafixerleiloes', host: 'mariafixerleiloes.com.br', baseUrl: 'https://www.mariafixerleiloes.com.br', catalogType: '3' },
] as const;

type VlanceRealEstateDefinition = (typeof vlanceRealEstateDefinitions)[number];

export class VlanceRealEstateScraper implements AuctionScraper {
  public readonly site: string;
  private readonly provider: AlessandroTeixeiraRealEstateCatalogProvider;

  public constructor(private readonly definition: VlanceRealEstateDefinition) {
    this.site = definition.site;
    this.provider = new AlessandroTeixeiraRealEstateCatalogProvider(0, definition);
  }

  public supports(url: string): boolean {
    return hostMatches(url, [this.definition.host])
      && /\/leilao\/index\/leilao_id\/\d+\/lote\/\d+\/?$/i.test(new URL(url).pathname);
  }

  public async scrape(url: string): Promise<LotData> {
    return this.provider.scrapeLot(url);
  }
}
