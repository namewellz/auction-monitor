export interface IntegrationDefinition {
  site: string;
  name: string;
  catalog: 'vehicles' | 'real_estate';
  publicUrl: string;
  collectionUrl: string;
  scopes: string[];
}

export function integrationDefinitions(leiloApiUrl: string): IntegrationDefinition[] {
  return [
    { site: 'leilo', name: 'Leilo', catalog: 'vehicles', publicUrl: 'https://leilo.com.br/leilao', collectionUrl: leiloApiUrl, scopes: ['Carros', 'Motos', 'Pesados'] },
    { site: 'vipleiloes', name: 'VIP Leilões', catalog: 'vehicles', publicUrl: 'https://www.vipleiloes.com.br/evento', collectionUrl: 'https://www.vipleiloes.com.br/evento', scopes: ['Seminovos', 'Usados', 'Motos', 'Pesados'] },
    { site: 'superbid', name: 'Superbid', catalog: 'vehicles', publicUrl: 'https://www.superbid.net/categorias/carros-motos', collectionUrl: 'https://offer-query.superbid.net/seo/offers/', scopes: ['Carros', 'Motos'] },
    { site: 'francoleiloes', name: 'Franco Leilões', catalog: 'real_estate', publicUrl: 'https://www.francoleiloes.com.br/busca/#Engine=Start&Pagina=1&ID_Categoria=55', collectionUrl: 'https://www.francoleiloes.com.br/busca/', scopes: ['Imóveis'] },
    { site: 'alessandroteixeira', name: 'Alessandro Teixeira Leilões', catalog: 'real_estate', publicUrl: 'https://alessandroteixeiraleiloes.com.br/leilao/index/imoveis', collectionUrl: 'https://alessandroteixeiraleiloes.com.br/core/api/get-lotes', scopes: ['Imóveis'] },
    { site: 'alvaroleiloes', name: 'Álvaro Leilões', catalog: 'real_estate', publicUrl: 'https://alvaroleiloes.com.br/leilao/index/imoveis', collectionUrl: 'https://alvaroleiloes.com.br/core/api/get-lotes', scopes: ['Imóveis'] },
    { site: 'brunoleiloes', name: 'Bruno Leilões', catalog: 'real_estate', publicUrl: 'https://www.brunoleiloes.com.br/leilao/index/imoveis', collectionUrl: 'https://www.brunoleiloes.com.br/core/api/get-lotes', scopes: ['Imóveis'] },
    { site: 'calilleiloes', name: 'Calil Leilões', catalog: 'real_estate', publicUrl: 'https://www.calilleiloes.com.br/lotes/imovel', collectionUrl: 'https://www.calilleiloes.com.br/lotes/imovel', scopes: ['Imóveis'] },
    { site: 'capitalvalorleiloes', name: 'Capital Valor Leilões', catalog: 'real_estate', publicUrl: 'https://www.capitalvalorleiloes.com.br/leilao/index/imoveis', collectionUrl: 'https://www.capitalvalorleiloes.com.br/core/api/get-lotes', scopes: ['Imóveis'] },
    { site: 'd1lance', name: 'D1 Lance', catalog: 'real_estate', publicUrl: 'https://d1lance.com.br/navegar-pelo-mapa?tipo_filtro=imoveis', collectionUrl: 'https://d1lance.com.br/navegar-pelo-mapa?tipo_filtro=imoveis', scopes: ['Imóveis'] },
  ];
}
