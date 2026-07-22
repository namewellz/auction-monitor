import { AlessandroTeixeiraRealEstateCatalogProvider } from './alessandroTeixeiraRealEstateCatalog.js';

export class CarloFerrariRealEstateCatalogProvider extends AlessandroTeixeiraRealEstateCatalogProvider {
  public constructor(requestIntervalMs = 750) {
    super(requestIntervalMs, { site: 'carloferrarileiloes', baseUrl: 'https://www.carloferrarileiloes.com.br' });
  }
}

export class DaSilvaRealEstateCatalogProvider extends AlessandroTeixeiraRealEstateCatalogProvider {
  public constructor(requestIntervalMs = 750) {
    super(requestIntervalMs, { site: 'dasilvaleiloes', baseUrl: 'https://www.dasilvaleiloes.com.br' });
  }
}

export class CidaFixerRealEstateCatalogProvider extends AlessandroTeixeiraRealEstateCatalogProvider {
  public constructor(requestIntervalMs = 750) {
    super(requestIntervalMs, { site: 'cidafixerleiloes', baseUrl: 'https://www.cidafixerleiloes.com.br' });
  }
}

export class DoLeiloesRealEstateCatalogProvider extends AlessandroTeixeiraRealEstateCatalogProvider {
  public constructor(requestIntervalMs = 750) {
    super(requestIntervalMs, { site: 'doleiloes', baseUrl: 'https://www.doleiloes.com.br' });
  }
}
