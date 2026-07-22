import { AlessandroTeixeiraRealEstateCatalogProvider } from './alessandroTeixeiraRealEstateCatalog.js';

export class CapitalValorRealEstateCatalogProvider extends AlessandroTeixeiraRealEstateCatalogProvider {
  public constructor(requestIntervalMs = 750) {
    super(requestIntervalMs, {
      site: 'capitalvalorleiloes',
      baseUrl: 'https://www.capitalvalorleiloes.com.br',
    });
  }
}
