import { AlessandroTeixeiraRealEstateCatalogProvider } from './alessandroTeixeiraRealEstateCatalog.js';

export class BrunoRealEstateCatalogProvider extends AlessandroTeixeiraRealEstateCatalogProvider {
  public constructor(requestIntervalMs = 750) {
    super(requestIntervalMs, {
      site: 'brunoleiloes',
      baseUrl: 'https://www.brunoleiloes.com.br',
    });
  }
}
