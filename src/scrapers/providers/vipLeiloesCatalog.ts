import * as cheerio from 'cheerio';
import type { CatalogPage, CatalogProvider } from '../base/catalogProvider.js';
import type { VipLeiloesClient } from './vipLeiloesClient.js';

const classifications = {
  Seminovos: { id: '3', assetType: 'car' },
  Usados: { id: '5', assetType: 'car' },
  Motos: { id: '1', assetType: 'motorcycle' },
  Pesados: { id: '6', assetType: 'heavy' },
} as const;

export type VipClassification = keyof typeof classifications;

export class VipLeiloesCatalogProvider implements CatalogProvider {
  public readonly site = 'vipleiloes';
  public readonly source: string;

  public constructor(
    private readonly client: VipLeiloesClient,
    private readonly classification: VipClassification,
  ) {
    this.source = classification.toLowerCase();
  }

  public async scrapePage(page: number): Promise<CatalogPage> {
    const form = new URLSearchParams({
      'Filtro.Classificacao': classifications[this.classification].id,
      'Filtro.SelecaoVeiculos': 'true',
      'Filtro.SelecaoOutros': 'false',
      'Filtro.CurrentPage': String(page),
    });
    const response = await this.client.postForm(`/pesquisa?pageNumber=${page}&handler=pesquisar`, form);
    if (!response.ok) throw new Error(`VIP catalog failed with status ${response.status}.`);
    const $ = cheerio.load(await response.text());
    const urls = new Set<string>();
    $('a[href*="/evento/anuncio/"]').each((_, element) => {
      const href = $(element).attr('href');
      if (!href) return;
      const url = new URL(href, response.url || 'https://www.vipleiloes.com.br');
      url.search = '';
      url.hash = '';
      urls.add(url.toString());
    });

    const text = normalizeText($('body').text());
    const total = Number(text.match(/(\d+)\s+resultados encontrados/i)?.[1]) || urls.size;
    const hasNext = !$('.page-link[aria-label="Next"]').parent().hasClass('disabled') && urls.size > 0;
    return {
      page,
      pageSize: urls.size,
      total,
      hasNext,
      lots: [...urls].map((url) => ({
        url,
        classification: this.classification,
        assetType: classifications[this.classification].assetType,
      })),
    };
  }
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
