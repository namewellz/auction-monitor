import { AlessandroTeixeiraRealEstateCatalogProvider } from './alessandroTeixeiraRealEstateCatalog.js';

export class AlvaroRealEstateCatalogProvider extends AlessandroTeixeiraRealEstateCatalogProvider {
  public constructor(requestIntervalMs = 750) {
    super(requestIntervalMs, {
      site: 'alvaroleiloes',
      baseUrl: 'https://alvaroleiloes.com.br',
    });
  }
}
