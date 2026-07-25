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

export class JrRealEstateCatalogProvider extends AlessandroTeixeiraRealEstateCatalogProvider {
  public constructor(requestIntervalMs = 750) {
    super(requestIntervalMs, {
      site: 'jrleiloes',
      baseUrl: 'https://jrleiloes.com.br',
      catalogType: '3',
    });
  }
}

export class GiordanoRealEstateCatalogProvider extends AlessandroTeixeiraRealEstateCatalogProvider {
  public constructor(requestIntervalMs = 750) {
    super(requestIntervalMs, {
      site: 'giordanoleiloes',
      baseUrl: 'https://www.giordanoleiloes.com.br',
      catalogType: '3',
    });
  }
}

export class FranciscoFreitasRealEstateCatalogProvider extends AlessandroTeixeiraRealEstateCatalogProvider {
  public constructor(requestIntervalMs = 750) {
    super(requestIntervalMs, {
      site: 'franciscofreitasleiloes',
      baseUrl: 'https://franciscofreitasleiloes.com.br',
      catalogType: '3',
    });
  }
}

export class RioRealEstateCatalogProvider extends AlessandroTeixeiraRealEstateCatalogProvider {
  public constructor(requestIntervalMs = 750) {
    super(requestIntervalMs, {
      site: 'rioleiloes',
      baseUrl: 'https://www.rioleiloes.com.br',
      catalogType: '3',
    });
  }
}

export class HdRealEstateCatalogProvider extends AlessandroTeixeiraRealEstateCatalogProvider {
  public constructor(requestIntervalMs = 750) {
    super(requestIntervalMs, {
      site: 'hdleiloes',
      baseUrl: 'https://www.hdleiloes.com.br',
      catalogType: '3',
    });
  }
}
