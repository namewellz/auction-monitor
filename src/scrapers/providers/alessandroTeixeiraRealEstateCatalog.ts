import * as cheerio from 'cheerio';
import type { CatalogPage, CatalogProvider } from '../base/catalogProvider.js';
import type { LotData } from '../../types/lot.js';
import { TerminalLotUnavailableError } from '../../errors/terminalLotUnavailableError.js';

const DEFAULT_BASE_URL = 'https://alessandroteixeiraleiloes.com.br';
const PAGE_SIZE = 40;
const REAL_ESTATE_CATEGORY_ID = 3;

interface Photo { nm_path_completo: string }
interface Attachment { nm: string; nm_path_completo: string }
interface ApiLot {
  lote_id: number; leilao_id: number; nu: string; nm_titulo_lote: string; nm_titulo_leilao: string;
  nm_descricao?: string; nm_statuslote: string; nm_cidade?: string; nm_estado?: string;
  nm_subcategoria?: string; id_categoria: number; dt_fechamento: string; vl_lance?: string | null;
  vl_lanceinicial?: string | null; vl_lanceinicialsegundoleilao?: string | null;
  vl_lanceminimo?: string | null; vl_venda?: string | null; nu_qtdelances?: number;
  nu_parcelas?: number; vl_percentualentrada?: number; iframe_streetview?: string | null;
  fotos?: Photo[]; anexos?: Attachment[]; nm_leiloeiro?: string;
}
interface ApiResponse { items: ApiLot[]; currentPage: number; totalPages: number; totalItems?: number }

export class AlessandroTeixeiraRealEstateCatalogProvider implements CatalogProvider {
  public readonly site: string;
  public readonly source: string;
  private readonly baseUrl: string;
  private readonly apiUrl: string;
  private readonly catalogType: string;

  public constructor(
    private readonly requestIntervalMs = 750,
    options: { site: string; baseUrl: string; catalogType?: string } = {
      site: 'alessandroteixeira',
      baseUrl: DEFAULT_BASE_URL,
    },
  ) {
    this.site = options.site;
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.apiUrl = `${this.baseUrl}/core/api/get-lotes`;
    this.catalogType = options.catalogType ?? 'imoveis';
    this.source = `${this.baseUrl}/leilao/index/imoveis`;
  }

  public async scrapePage(page: number): Promise<CatalogPage> {
    if (page > 1) await sleep(this.requestIntervalMs);
    const response = await fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (compatible; AuctionMonitor/1.0)',
        Referer: this.source,
      },
      body: new URLSearchParams({ pg: String(page), tipo: this.catalogType }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Alessandro Teixeira API failed: HTTP ${response.status}`);
    const payload = await response.json() as ApiResponse;
    const realEstateLots = (payload.items ?? []).filter((lot) =>
      lot.id_categoria === REAL_ESTATE_CATEGORY_ID && !isTestLot(lot));
    const lots = realEstateLots.map((lot) => {
      const url = `${this.baseUrl}/leilao/index/leilao_id/${lot.leilao_id}/lote/${lot.lote_id}`;
      return { url, data: mapLot(lot, this.baseUrl), classification: 'Imóveis', assetType: 'real_estate' as const };
    });
    return {
      page,
      pageSize: PAGE_SIZE,
      total: payload.totalItems ?? payload.totalPages * PAGE_SIZE,
      hasNext: page < payload.totalPages,
      lots,
    };
  }

  public async scrapeLot(url: string): Promise<LotData> {
    const pathname = new URL(url).pathname;
    const lotId = Number(/\/lote\/(\d+)/i.exec(pathname)?.[1]);
    const auctionId = Number(/\/leilao_id\/(\d+)/i.exec(pathname)?.[1]);
    if (!Number.isInteger(lotId) || lotId <= 0) throw new Error(`VLance lot id not found in URL: ${url}`);
    if (Number.isInteger(auctionId) && auctionId > 0) {
      const payload = await this.fetchLots(new URLSearchParams({
        pg: '1',
        tipo: this.catalogType,
        leilao_id: String(auctionId),
      }));
      const lot = (payload.items ?? []).find((candidate) => candidate.lote_id === lotId);
      if (lot) return this.mapRealEstateLot(lot);
    }
    let page = 1;
    while (page <= 100) {
      if (page > 1) await sleep(this.requestIntervalMs);
      const payload = await this.fetchLots(new URLSearchParams({ pg: String(page), tipo: this.catalogType }));
      const lot = (payload.items ?? []).find((candidate) => candidate.lote_id === lotId);
      if (lot) return this.mapRealEstateLot(lot);
      if (page >= payload.totalPages) break;
      page += 1;
    }
    throw new TerminalLotUnavailableError(`VLance lot ${lotId} is no longer available in the catalog API`);
  }

  private async fetchLots(body: URLSearchParams): Promise<ApiResponse> {
    const response = await fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (compatible; AuctionMonitor/1.0)',
        Referer: this.source,
      },
      body,
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`VLance API failed: HTTP ${response.status}`);
    return response.json() as Promise<ApiResponse>;
  }

  private mapRealEstateLot(lot: ApiLot): LotData {
    if (lot.id_categoria !== REAL_ESTATE_CATEGORY_ID) {
      throw new Error(`VLance lot ${lot.lote_id} is not a real-estate lot`);
    }
    return mapLot(lot, this.baseUrl);
  }
}

function mapLot(lot: ApiLot, baseUrl: string): LotData {
  const description = plainText(lot.nm_descricao ?? '');
  const title = plainText(lot.nm_titulo_lote);
  const currentBid = money(lot.vl_lance);
  const firstRoundMinimumValue = money(lot.vl_lanceminimo) || money(lot.vl_lanceinicial);
  const secondRoundMinimumValue = money(lot.vl_lanceinicialsegundoleilao);
  const nextBid = currentBid > 0
    ? currentBid
    : money(lot.vl_lanceinicial) || secondRoundMinimumValue || firstRoundMinimumValue;
  const coordinates = coordinatesFromIframe(lot.iframe_streetview);
  const area = extractArea(`${title} ${description}`);
  const documents = (lot.anexos ?? []).filter((item) => item.nm_path_completo).map((item) => ({
    url: item.nm_path_completo,
    label: plainText(item.nm) || 'Documento',
    documentType: documentType(item.nm),
  }));
  return {
    title,
    currentBid,
    nextBid: Number.isFinite(nextBid) ? nextBid : 0,
    auctionEnd: new Date(lot.dt_fechamento),
    city: plainText(lot.nm_cidade ?? ''),
    state: lot.nm_estado ?? '',
    address: [plainText(lot.nm_cidade ?? ''), lot.nm_estado ?? ''].filter(Boolean).join(' / '),
    propertyType: normalizePropertyType(`${lot.nm_subcategoria ?? ''} ${title}`),
    ...(firstRoundMinimumValue ? { firstRoundMinimumValue } : {}),
    ...(secondRoundMinimumValue ? { secondRoundMinimumValue } : {}),
    ...(area ? { totalAreaM2: area } : {}),
    ...(coordinates ? { latitude: coordinates[0], longitude: coordinates[1] } : {}),
    ...(description ? { observations: description } : {}),
    lotNumber: String(lot.nu),
    externalCode: String(lot.lote_id),
    sourceAnnouncementId: String(lot.lote_id),
    ...(lot.nm_leiloeiro ? { consignor: plainText(lot.nm_leiloeiro) } : {}),
    saleStatus: plainText(lot.nm_statuslote),
    displayStatus: plainText(lot.nm_statuslote),
    classification: 'Imóveis',
    assetType: 'real_estate',
    bidCount: lot.nu_qtdelances ?? 0,
    eventName: plainText(lot.nm_titulo_leilao),
    eventExternalCode: String(lot.leilao_id),
    eventUrl: `${baseUrl}/leilao/index/leilao_id/${lot.leilao_id}`,
    imageUrls: (lot.fotos ?? []).map((photo) => photo.nm_path_completo.replace('/196x146/', '/640x480/')),
    documents,
    additionalDetails: {
      leiloeiro: plainText(lot.nm_leiloeiro ?? 'Alessandro de Assis Teixeira'),
      avaliacao: String(money(lot.vl_lanceminimo)),
      parcelas: String(lot.nu_parcelas ?? 0),
      percentualEntrada: String(lot.vl_percentualentrada ?? 0),
    },
  };
}

function plainText(html: string): string {
  return cheerio.load(`<div>${html}</div>`)('div').text().replace(/\s+/g, ' ').trim();
}
function money(value: string | null | undefined): number { const parsed = Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0; }
function normalize(value: string): string { return plainText(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
function normalizePropertyType(value: string): string {
  const normalized = normalize(value);
  if (/apartamento|apto\b/.test(normalized)) return 'apartamento';
  if (/casa|sobrado|residencia/.test(normalized)) return 'casa';
  if (/terreno|lote\b|urbano/.test(normalized)) return 'terreno';
  if (/loja|sala|conjunto|comercial|industrial/.test(normalized)) return 'comercial';
  if (/sitio|fazenda|chacara|rural/.test(normalized)) return 'rural';
  if (/galpao|barracao/.test(normalized)) return 'galpao';
  return 'outro';
}
function extractArea(value: string): number | undefined {
  const match = /(?:area(?:\s+(?:total|privativa|construida))?\s*(?:de|:)?|com)\s*([\d.,]+)\s*m[²2]/i.exec(normalize(value));
  if (!match?.[1]) return undefined;
  const parsed = Number(match[1].replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : undefined;
}
function coordinatesFromIframe(value: string | null | undefined): [number, number] | undefined {
  if (!value) return undefined;
  const match = /!1d(-?[\d.]+)!2d(-?[\d.]+)/.exec(value);
  if (!match?.[1] || !match[2]) return undefined;
  return [Number(match[1]), Number(match[2])];
}
function documentType(label: string): string {
  const value = normalize(label);
  if (value.includes('matricula')) return 'matricula';
  if (value.includes('edital')) return 'edital';
  if (value.includes('avaliacao') || value.includes('laudo')) return 'laudo';
  return 'outro';
}
function isTestLot(lot: ApiLot): boolean {
  return /\b(?:teste|simulacao)\b/.test(normalize(`${lot.nm_titulo_lote} ${lot.nm_titulo_leilao}`));
}
function sleep(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }
