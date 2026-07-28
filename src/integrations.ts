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
    { site: 'carloferrarileiloes', name: 'Carlo Ferrari Leilões', catalog: 'real_estate', publicUrl: 'https://www.carloferrarileiloes.com.br/leilao/index/imoveis', collectionUrl: 'https://www.carloferrarileiloes.com.br/core/api/get-lotes', scopes: ['Imóveis'] },
    { site: 'dasilvaleiloes', name: 'Da Silva Leilões', catalog: 'real_estate', publicUrl: 'https://www.dasilvaleiloes.com.br/leilao/index/imoveis', collectionUrl: 'https://www.dasilvaleiloes.com.br/core/api/get-lotes', scopes: ['Imóveis'] },
    { site: 'cidafixerleiloes', name: 'Cida Fixer Leilões', catalog: 'real_estate', publicUrl: 'https://www.cidafixerleiloes.com.br/leilao/index/imoveis', collectionUrl: 'https://www.cidafixerleiloes.com.br/core/api/get-lotes', scopes: ['Imóveis'] },
    { site: 'doleiloes', name: 'Dó Leilões', catalog: 'real_estate', publicUrl: 'https://www.doleiloes.com.br/leilao/index/imoveis', collectionUrl: 'https://www.doleiloes.com.br/core/api/get-lotes', scopes: ['Imóveis'] },
    { site: 'akimotoleiloes', name: 'Akimoto Leilões', catalog: 'real_estate', publicUrl: 'https://www.akimotoleiloes.com.br/', collectionUrl: 'https://www.akimotoleiloes.com.br/core/api/get-lotes', scopes: ['Imóveis'] },
    { site: 'alessandraleiloes', name: 'Alessandra Leilões', catalog: 'real_estate', publicUrl: 'https://www.alessandraleiloes.com.br/', collectionUrl: 'https://www.alessandraleiloes.com.br/core/api/get-lotes', scopes: ['Imóveis'] },
    { site: 'deonizialeiloes', name: 'Deonizia Leilões', catalog: 'real_estate', publicUrl: 'https://www.deonizialeiloes.com.br/', collectionUrl: 'https://www.deonizialeiloes.com.br/core/api/get-lotes', scopes: ['Imóveis'] },
    { site: 'jrleiloes', name: 'JR Leilões', catalog: 'real_estate', publicUrl: 'https://jrleiloes.com.br/', collectionUrl: 'https://jrleiloes.com.br/core/api/get-lotes', scopes: ['Imóveis'] },
    { site: 'giordanoleiloes', name: 'Giordano Leilões', catalog: 'real_estate', publicUrl: 'https://www.giordanoleiloes.com.br/', collectionUrl: 'https://www.giordanoleiloes.com.br/core/api/get-lotes', scopes: ['Imóveis'] },
    { site: 'franciscofreitasleiloes', name: 'Francisco Freitas Leilões', catalog: 'real_estate', publicUrl: 'https://franciscofreitasleiloes.com.br/', collectionUrl: 'https://franciscofreitasleiloes.com.br/core/api/get-lotes', scopes: ['Imóveis'] },
    { site: 'rioleiloes', name: 'Rio Leilões', catalog: 'real_estate', publicUrl: 'https://www.rioleiloes.com.br/', collectionUrl: 'https://www.rioleiloes.com.br/core/api/get-lotes', scopes: ['Imóveis'] },
    { site: 'hdleiloes', name: 'HD Leilões', catalog: 'real_estate', publicUrl: 'https://www.hdleiloes.com.br/', collectionUrl: 'https://www.hdleiloes.com.br/core/api/get-lotes', scopes: ['Imóveis'] },
    { site: 'trileiloes', name: 'TRI Leilões', catalog: 'real_estate', publicUrl: 'https://trileiloes.com.br/leiloes', collectionUrl: 'https://trileiloes.com.br/leiloes', scopes: ['Imóveis'] },
    { site: 'thaisteixeiraleiloes', name: 'Thaís Teixeira Leilões', catalog: 'real_estate', publicUrl: 'https://www.thaisteixeiraleiloes.com.br/externo/', collectionUrl: 'https://www.thaisteixeiraleiloes.com.br/core/api/get-lotes', scopes: ['Imóveis'] },
    { site: 'valeroleiloes', name: 'Valero Leilões', catalog: 'real_estate', publicUrl: 'https://valeroleiloes.com.br/', collectionUrl: 'https://valeroleiloes.com.br/leiloes', scopes: ['Imóveis'] },
    { site: 'rigolonleiloes', name: 'Rigolon Leilões', catalog: 'real_estate', publicUrl: 'https://www.rigolonleiloes.com.br/externo', collectionUrl: 'https://www.rigolonleiloes.com.br/core/api/get-lotes', scopes: ['Imóveis'] },
    { site: 'leiloesjudiciaisbahia', name: 'Leilões Judiciais Bahia', catalog: 'real_estate', publicUrl: 'https://www.leiloesjudiciaisbahia.com.br/externo/', collectionUrl: 'https://www.leiloesjudiciaisbahia.com.br/core/api/get-lotes', scopes: ['Imóveis'] },
    { site: 'fabioleiloes', name: 'Fábio Leilões', catalog: 'real_estate', publicUrl: 'https://www.fabioleiloes.com.br/', collectionUrl: 'https://www.fabioleiloes.com.br/core/api/get-lotes', scopes: ['Imóveis'] },
    { site: 'galvanileiloes', name: 'Galvani Leilões', catalog: 'real_estate', publicUrl: 'https://www.galvanileiloes.com.br/', collectionUrl: 'https://www.galvanileiloes.com.br/core/api/get-lotes', scopes: ['Imóveis'] },
    { site: 'joserodovalholeiloes', name: 'José Rodovalho Leilões', catalog: 'real_estate', publicUrl: 'https://www.joserodovalholeiloes.com.br/', collectionUrl: 'https://www.joserodovalholeiloes.com.br/core/api/get-lotes', scopes: ['Imóveis'] },
    { site: 'rosioliveiraleiloes', name: 'Rosi Oliveira Leilões', catalog: 'real_estate', publicUrl: 'https://rosioliveiraleiloes.com.br/', collectionUrl: 'https://rosioliveiraleiloes.com.br/core/api/get-lotes', scopes: ['Imóveis'] },
    { site: 'fidelisleiloes', name: 'Fidelis Leilões', catalog: 'real_estate', publicUrl: 'https://www.fidelisleiloes.com.br/', collectionUrl: 'https://www.fidelisleiloes.com.br/core/api/get-lotes', scopes: ['Imóveis'] },
    { site: 'milanleiloes', name: 'Milan Leilões', catalog: 'real_estate', publicUrl: 'https://milanleiloes.com.br/pesquisa/imoveis', collectionUrl: 'https://milanleiloes.com.br/pesquisa/imoveis', scopes: ['Imóveis'] },
    { site: 'leiloeiropublico', name: 'Leiloeiro Público', catalog: 'real_estate', publicUrl: 'https://www.leiloeiropublico.com.br/', collectionUrl: 'https://www.leiloeiropublico.com.br/', scopes: ['Imóveis'] },
    { site: 'satoleiloes', name: 'Sato Leilões', catalog: 'real_estate', publicUrl: 'https://satoleiloes.com.br/', collectionUrl: 'https://satoleiloes.com.br/', scopes: ['Imóveis'] },
    { site: 'gilsonleiloes', name: 'Gilson Leilões', catalog: 'real_estate', publicUrl: 'https://www.gilsonleiloes.com.br/', collectionUrl: 'https://www.gilsonleiloes.com.br/leilao/index/imoveis', scopes: ['Imóveis'] },
    { site: 'jdleiloes', name: 'JD Leilões', catalog: 'real_estate', publicUrl: 'https://www.jdleiloes.com.br/', collectionUrl: 'https://www.jdleiloes.com.br/leilao/index/imoveis', scopes: ['Imóveis'] },
    { site: 'mariafixerleiloes', name: 'Maria Fixer Leilões', catalog: 'real_estate', publicUrl: 'https://www.mariafixerleiloes.com.br/', collectionUrl: 'https://www.mariafixerleiloes.com.br/leilao/index/imoveis', scopes: ['Imóveis'] },
  ];
}
