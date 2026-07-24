import * as cheerio from 'cheerio';
import type { CatalogPage, CatalogProvider } from '../base/catalogProvider.js';
import type { LotData } from '../../types/lot.js';

const BASE_URL = 'https://d1lance.com.br';
const SOURCE_URL = `${BASE_URL}/navegar-pelo-mapa?tipo_filtro=imoveis`;
const MEDIA_URL = 'https://midia.d1lance.com.br/public/';
const PAGE_SIZE = 12;

export class D1LanceRealEstateCatalogProvider implements CatalogProvider {
  public readonly site = 'd1lance';
  public readonly source = SOURCE_URL;

  public constructor(private readonly requestIntervalMs = 750) {}

  public async scrapePage(page: number): Promise<CatalogPage> {
    const response = await fetch(SOURCE_URL, { headers: headers(), signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`D1 Lance catalog failed: HTTP ${response.status}`);
    const $ = cheerio.load(await response.text());
    const urls = unique($('a[href*="/lote/"]').map((_, element) => absolute($(element).attr('href') ?? '')).get()
      .filter((url) => /\/lote\/[^/]+\/\d+(?:\?|$)/.test(url)));
    const pageUrls = urls.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    const lots = [];
    for (const url of pageUrls) {
      const data = await this.scrapeLot(url);
      if (data.assetType === 'real_estate') lots.push({ url, data, classification: 'Imóveis', assetType: 'real_estate' as const });
      if (this.requestIntervalMs > 0) await sleep(this.requestIntervalMs);
    }
    return { page, pageSize: PAGE_SIZE, total: urls.length, hasNext: page * PAGE_SIZE < urls.length, lots };
  }

  public async scrapeLot(url: string): Promise<LotData> {
    const response = await fetch(url, { headers: headers(), signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`D1 Lance lot detail failed: HTTP ${response.status}`);
    const $ = cheerio.load(await response.text());
    const lot = structuredLot($);
    if (!lot) throw new Error(`D1 Lance structured lot not found: ${url}`);
    const id = String(lot.id ?? /\/(\d+)(?:\?|$)/.exec(url)?.[1] ?? url);
    const location = lot.localizacao_dos_bens?.[0] ?? {};
    const estate = lot.bens_do_lote?.[0]?.imovel ?? {};
    const property = lot.bens_do_lote?.[0] ?? {};
    const description = plainText(lot.descricao_lote ?? property.descricao_do_bem ?? '');
    const rounds: any[] = Array.isArray(lot.pracas_do_lote) ? lot.pracas_do_lote : [];
    const first = round(rounds, 'primeira')?.valor ?? number(lot.valor_primeira_praca);
    const second = round(rounds, 'segunda')?.valor ?? number(lot.valor_segunda_praca);
    const third = round(rounds, 'terceira')?.valor ?? number(lot.valor_terceira_praca);
    const endings = rounds.map((item: any) => date(item.termino)).filter((value: Date | undefined): value is Date => Boolean(value));
    const starts = rounds.map((item: any) => date(item.inicio)).filter((value: Date | undefined): value is Date => Boolean(value));
    const currentBid = number(lot.ultimo_lance?.valor ?? lot.ultimo_lance);
    const images = unique($('a[href*="midia.d1lance.com.br/public/imgs/lotes/imagens/"]')
      .map((_, element) => $(element).attr('href') ?? '').get().filter(Boolean));
    const media = parseJsonArray(lot.midias_do_lote);
    for (const item of media) {
      const path = item?.midias?.url;
      if (path && Number(item?.midias?.categoria_de_midia) === 7) images.push(new URL(path, MEDIA_URL).toString());
    }
    const documents = $('a[href]').map((_, element) => {
      const href = absolute($(element).attr('href') ?? '');
      const label = compact($(element).text());
      return /(?:\.pdf(?:\?|$)|\/download\/|\/documentos?\/)/i.test(href)
        ? { url: href, label: label || 'Documento', documentType: documentType(label || href) }
        : undefined;
    }).get().filter((item): item is NonNullable<typeof item> => Boolean(item));
    const title = compact(lot.titulo_lote ?? lot.subtitulo_do_lote ?? lot.titulo_do_lote ?? property.identificador_do_bem ?? `Imóvel ${id}`);
    const area = localizedNumber(estate.area_construida ?? estate.area_terreno);
    const address = compact([location.rua, location.numero, location.complemento].filter(Boolean).join(', '));
    const status = compact(lot.status ?? '');
    return {
      title,
      currentBid,
      nextBid: currentBid || number(lot.valor_inicial_da_praca_atual_do_lote) || first,
      auctionEnd: endings.at(-1) ?? date(lot.data_hora_final_lote) ?? new Date(),
      ...(starts[0] ? { auctionStart: starts[0] } : {}),
      city: compact(location.cidade?.nome ?? ''),
      state: compact(location.estado?.sigla ?? location.cidade?.sigla ?? ''),
      address,
      neighborhood: compact(location.bairro ?? ''),
      neighborhoodNormalized: normalize(location.bairro ?? ''),
      postalCode: compact(location.cep ?? ''),
      propertyType: normalizePropertyType(`${property.categoria?.nome ?? ''} ${property.tipo_bem?.nome ?? ''} ${title}`),
      occupancyStatus: normalize(estate.ocupacao ?? ''),
      ...(area ? { privateAreaM2: area } : {}),
      ...(Number.isFinite(Number(location.latitude)) ? { latitude: Number(location.latitude) } : {}),
      ...(Number.isFinite(Number(location.longitude)) ? { longitude: Number(location.longitude) } : {}),
      acceptsFinancing: Boolean(lot.aceita_financiamento),
      ...(description ? { observations: description } : {}),
      ...(first ? { firstRoundMinimumValue: first } : {}),
      ...(second ? { secondRoundMinimumValue: second } : {}),
      ...(third ? { thirdRoundMinimumValue: third } : {}),
      lotNumber: String(lot.ordem ?? ''), externalCode: id, sourceAnnouncementId: id,
      consignor: plainText(lot.leilao?.comitente?.pessoa?.nome ?? ''),
      saleStatus: status, displayStatus: status, classification: 'Imóveis', assetType: 'real_estate',
      bidCount: Number(lot.quantidade_de_lances ?? 0),
      eventName: compact(lot.titulo_do_lote ?? lot.leilao?.titulo_leilao ?? title),
      eventExternalCode: String(lot.leilao_id ?? ''),
      eventUrl: url,
      imageUrls: unique(images),
      documents,
      additionalDetails: {
        matricula: compact(estate.matricula ?? ''),
        modalidade: compact(lot.leilao?.modalidade?.nome ?? ''),
        processo: compact(lot.leilao?.processo?.numero_do_processo ?? ''),
        valorAvaliacao: String(number(property.valor_atual_do_bem ?? property.valor_avaliacao)),
      },
    };
  }
}

function structuredLot($: cheerio.CheerioAPI): any | undefined {
  for (const element of $('[wire\\:initial-data]').toArray()) {
    try {
      const payload = JSON.parse($(element).attr('wire:initial-data') ?? '{}');
      const lot = payload?.serverMemo?.data?.lote;
      if (lot?.id && (lot.valor_primeira_praca != null || lot.pracas_do_lote != null)) return lot;
    } catch {}
  }
  return undefined;
}
function headers(): Record<string, string> { return { Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'pt-BR,pt;q=0.9', 'User-Agent': 'Mozilla/5.0 (compatible; AuctionMonitor/1.0)' }; }
function absolute(path: string): string { return path ? new URL(path, `${BASE_URL}/`).toString() : ''; }
function unique<T>(values: T[]): T[] { return [...new Set(values)]; }
function compact(value: unknown): string { return String(value ?? '').replace(/\s+/g, ' ').trim(); }
function plainText(value: unknown): string { return cheerio.load(`<div>${String(value ?? '')}</div>`)('div').text().replace(/\s+/g, ' ').trim(); }
function normalize(value: unknown): string { return compact(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
function number(value: unknown): number { const parsed = Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0; }
function localizedNumber(value: unknown): number { const parsed = Number(String(value ?? '').replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.')); return Number.isFinite(parsed) ? parsed : 0; }
function parseJsonArray(value: unknown): any[] { if (Array.isArray(value)) return value; try { const parsed = JSON.parse(String(value ?? '[]')); return Array.isArray(parsed) ? parsed : []; } catch { return []; } }
function round(values: any[], name: string): any | undefined { return values.find((item) => item?.nome === name); }
function date(value: unknown): Date | undefined { if (!value) return undefined; const parsed = new Date(`${String(value).replace(' ', 'T').replace(/\.\d+$/, '')}-03:00`); return Number.isNaN(parsed.getTime()) ? undefined : parsed; }
function sleep(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }
function normalizePropertyType(value: string): string { const item = normalize(value); if (/apartamento|apto/.test(item)) return 'apartamento'; if (/casa|sobrado|residencia/.test(item)) return 'casa'; if (/terreno|lote|gleba/.test(item)) return 'terreno'; if (/loja|sala|conjunto|predio|galpao|comercial|industrial/.test(item)) return 'comercial'; if (/sitio|fazenda|chacara|rural/.test(item)) return 'rural'; if (/vaga.*garagem/.test(item)) return 'garagem'; return 'outro'; }
function documentType(value: string): string { const item = normalize(value); if (item.includes('matricula')) return 'matricula'; if (item.includes('edital')) return 'edital'; if (item.includes('laudo') || item.includes('avaliacao')) return 'laudo'; return 'outro'; }
