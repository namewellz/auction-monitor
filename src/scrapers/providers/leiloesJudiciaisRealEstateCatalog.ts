import { AlessandroTeixeiraRealEstateCatalogProvider } from './alessandroTeixeiraRealEstateCatalog.js';

export class AkimotoRealEstateCatalogProvider extends AlessandroTeixeiraRealEstateCatalogProvider {
  public constructor(requestIntervalMs = 750) {
    super(requestIntervalMs, {
      site: 'akimotoleiloes',
      baseUrl: 'https://www.akimotoleiloes.com.br',
      catalogType: '3',
    });
  }
}

export class AlessandraRealEstateCatalogProvider extends AlessandroTeixeiraRealEstateCatalogProvider {
  public constructor(requestIntervalMs = 750) {
    super(requestIntervalMs, {
      site: 'alessandraleiloes',
      baseUrl: 'https://www.alessandraleiloes.com.br',
      catalogType: '3',
    });
  }
}

export class DeoniziaRealEstateCatalogProvider extends AlessandroTeixeiraRealEstateCatalogProvider {
  public constructor(requestIntervalMs = 750) {
    super(requestIntervalMs, {
      site: 'deonizialeiloes',
      baseUrl: 'https://www.deonizialeiloes.com.br',
      catalogType: '3',
    });
  }
}
