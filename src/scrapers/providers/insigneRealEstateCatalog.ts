import * as cheerio from 'cheerio';
import type { CatalogPage, CatalogProvider } from '../base/catalogProvider.js';
import type { LotData } from '../../types/lot.js';
import { TerminalLotUnavailableError } from '../../errors/terminalLotUnavailableError.js';

const BASE_URL = 'https://www.insigneleiloes.com.br';
const PAGE_SIZE = 24;

interface InsignePhoto {
  Foto?: string;
}

interface InsigneRealTime {
  ValorLanceAtual?: number;
  ProximoLance?: number;
  StatusLote?: string;
  Lote_SubStatus_Label?: string;
  DataInicio?: string;
  DataTermino?: string;
  DataHoraAberturaPrimeiraPraca?: string;
  DataHoraEncerramentoPrimeiraPraca?: string;
  DataHoraAberturaSegundaPraca?: string;
  DataHoraEncerramentoSegundaPraca?: string;
  DataHoraAberturaTerceiraPraca?: string;
  DataHoraEncerramentoTerceiraPraca?: string;
  ValorMinimoLancePrimeiraPraca?: number;
  ValorMinimoLanceSegundaPraca?: number;
  ValorMinimoLanceTerceiraPraca?: number;
  QtdPracas?: number;
}

interface InsigneLot {
  ID_Leilao: number;
  ID_Leiloes_Lote: number;
  LoteNumero?: string;
  Lote: string;
  Leilao?: string;
  Categoria?: string;
  IconeCategoria?: string;
  ValorAvaliacao?: number;
  Comitente?: string;
  Lances?: number;
  LoteComissao?: number;
  IsAceitaFinanciamento?: boolean;
  URLlote: string;
  URLleilao?: string;
  Fotos?: InsignePhoto[];
  GetLoteRealTime?: InsigneRealTime[];
  CFGForms?: Array<{ Label?: string; Value?: string; URL?: string }>;
}

interface InsigneResponse {
  CountTotal?: number;
  Lotes?: InsigneLot[];
  PageCount?: number;
  Pagina?: number;
}

export class InsigneRealEstateCatalogProvider implements CatalogProvider {
  public readonly site = 'insigneleiloes';
  public readonly source = `${BASE_URL}/`;

  public constructor(private readonly requestIntervalMs = 750) {}

  public async scrapePage(page: number): Promise<CatalogPage> {
    const payload = await fetchCatalog(page);
    const lots: CatalogPage['lots'] = [];
    for (const [index, lot] of (payload.Lotes ?? []).entries()) {
      if (index > 0 || page > 1) await sleep(this.requestIntervalMs);
      const url = absoluteUrl(lot.URLlote);
      const detail = await fetchDetail(url);
      lots.push({
        url,
        data: mapLot(lot, detail),
        classification: 'Imóveis',
        assetType: 'real_estate',
      });
    }
    return {
      page,
      pageSize: PAGE_SIZE,
      total: payload.CountTotal ?? lots.length,
      hasNext: page < (payload.PageCount ?? 1),
      lots,
    };
  }

  public async scrapeLot(url: string): Promise<LotData> {
    const lotId = Number(/\/(\d+)\/?$/.exec(new URL(url).pathname)?.[1]);
    if (!Number.isInteger(lotId) || lotId <= 0) {
      throw new Error(`Insigne lot id not found in URL: ${url}`);
    }
    let page = 1;
    while (page <= 100) {
      const payload = await fetchCatalog(page);
      const lot = (payload.Lotes ?? []).find((candidate) => candidate.ID_Leiloes_Lote === lotId);
      if (lot) return mapLot(lot, await fetchDetail(url));
      if (page >= (payload.PageCount ?? 1)) break;
      page += 1;
      await sleep(this.requestIntervalMs);
    }
    throw new TerminalLotUnavailableError(`Insigne lot ${lotId} is no longer available in the catalog`);
  }
}

async function fetchCatalog(page: number): Promise<InsigneResponse> {
  const response = await fetch(`${BASE_URL}/ApiEngine/GetLotes/${page}/${PAGE_SIZE}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'User-Agent': 'Mozilla/5.0 (compatible; AuctionMonitor/1.0)',
      Referer: `${BASE_URL}/`,
    },
    body: '{}',
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Insigne catalog API failed: HTTP ${response.status}`);
  return response.json() as Promise<InsigneResponse>;
}

async function fetchDetail(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AuctionMonitor/1.0)' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Insigne lot page failed: HTTP ${response.status}`);
  return response.text();
}

function mapLot(lot: InsigneLot, html: string): LotData {
  const $ = cheerio.load(html);
  const realtime = lot.GetLoteRealTime?.[0] ?? {};
  const description = cleanText($('.dg-lote-descricao-txt').text());
  const information = cleanText($('#dg-lote-informacoes').text());
  const location = cleanText($('#dg-lote-local').text());
  const combined = `${lot.Lote} ${description} ${information} ${location}`;
  const place = extractPlace(combined);
  const imageUrls = unique([
    ...$('a[href*="/imagens/1300x1300/"]').map((_, item) => absoluteUrl($(item).attr('href') ?? '')).get(),
    ...(lot.Fotos ?? []).map((photo) => photo.Foto
      ? `${BASE_URL}/imagens/1300x1300/${photo.Foto}`
      : ''),
  ].filter(Boolean));
  const documents = $('.dg-lote-documentos-downloads__item').map((_, item) => {
    const label = cleanText($(item).find('span').first().text()) || 'Documento';
    const href = $(item).find('a[href]').map((__, link) => $(link).attr('href') ?? '').get()
      .find((candidate) => !/\/(?:preview|download)\/?$/i.test(candidate));
    return href ? { url: absoluteUrl(href), label, documentType: documentType(label) } : null;
  }).get().filter((item): item is { url: string; label: string; documentType: string } => item !== null);
  const currentBid = number(realtime.ValorLanceAtual);
  const nextBid = number(realtime.ProximoLance)
    || number(realtime.ValorMinimoLancePrimeiraPraca)
    || number(lot.ValorAvaliacao);
  const end = validDate(realtime.DataTermino)
    ?? validDate(realtime.DataHoraEncerramentoTerceiraPraca)
    ?? validDate(realtime.DataHoraEncerramentoSegundaPraca)
    ?? validDate(realtime.DataHoraEncerramentoPrimeiraPraca)
    ?? new Date();
  const process = lot.CFGForms?.find((field) => /processo/i.test(field.Label ?? ''));
  const auctionStart = validDate(realtime.DataInicio) ?? validDate(realtime.DataHoraAberturaPrimeiraPraca);
  const totalAreaM2 = extractArea(combined);
  return {
    title: cleanText(lot.Lote),
    currentBid,
    nextBid,
    auctionEnd: end,
    city: place.city,
    state: place.state,
    address: place.address,
    observations: description,
    lotNumber: cleanText(lot.LoteNumero ?? ''),
    externalCode: String(lot.ID_Leiloes_Lote),
    sourceAnnouncementId: String(lot.ID_Leiloes_Lote),
    origin: 'Insigne Leilões',
    consignor: cleanText(lot.Comitente ?? ''),
    saleStatus: cleanText(realtime.StatusLote ?? ''),
    displayStatus: cleanText(realtime.Lote_SubStatus_Label ?? realtime.StatusLote ?? ''),
    classification: 'Imóveis',
    assetType: 'real_estate',
    bidCount: number(lot.Lances),
    commissionFee: number(lot.LoteComissao),
    eventName: cleanText(lot.Leilao ?? ''),
    eventExternalCode: String(lot.ID_Leilao),
    ...(lot.URLleilao ? { eventUrl: absoluteUrl(lot.URLleilao) } : {}),
    ...(auctionStart ? { auctionStart } : {}),
    imageUrls,
    documents,
    propertyType: propertyType(lot.IconeCategoria ?? lot.Categoria ?? lot.Lote),
    ...(totalAreaM2 ? { totalAreaM2 } : {}),
    acceptsFinancing: lot.IsAceitaFinanciamento ?? false,
    firstRoundMinimumValue: number(realtime.ValorMinimoLancePrimeiraPraca),
    secondRoundMinimumValue: number(realtime.ValorMinimoLanceSegundaPraca),
    thirdRoundMinimumValue: number(realtime.ValorMinimoLanceTerceiraPraca),
    additionalDetails: {
      avaliacao: String(number(lot.ValorAvaliacao)),
      ...(process?.Value ? { processo: cleanText(process.Value) } : {}),
      ...(process?.URL ? { processoUrl: process.URL } : {}),
      ...(realtime.QtdPracas ? { quantidadePracas: String(realtime.QtdPracas) } : {}),
    },
  };
}

function extractPlace(text: string): { city: string; state: string; address: string } {
  const normalized = cleanText(text);
  const match = /(?:em|no município de|localizad[oa]\s+(?:em|na cidade de))\s+([A-ZÀ-Ü][A-Za-zÀ-ÿ' -]{2,50})\s*\/\s*([A-Z]{2})\b/i.exec(normalized)
    ?? /\b([A-ZÀ-Ü][A-Za-zÀ-ÿ' -]{2,50})\s*[-/]\s*([A-Z]{2})\b/.exec(normalized);
  const city = cleanText(match?.[1] ?? '');
  const state = (match?.[2] ?? '').toUpperCase();
  const addressMatch = /(?:endere[cç]o|localiza[cç][aã]o)\s*:?\s*(.{5,160}?)(?=\s(?:descri[cç][aã]o|matr[ií]cula|avalia[cç][aã]o|$))/i.exec(normalized);
  return { city, state, address: cleanText(addressMatch?.[1] ?? [city, state].filter(Boolean).join(' / ')) };
}

function propertyType(value: string): string {
  const text = cleanText(value).toLowerCase();
  if (/apartamento/.test(text)) return 'Apartamento';
  if (/terreno|lote/.test(text)) return 'Terreno';
  if (/fazenda|s[ií]tio|ch[aá]cara|rural/.test(text)) return 'Rural';
  if (/comercial|galp[aã]o|sala|loja/.test(text)) return 'Comercial';
  if (/casa|resid/.test(text)) return 'Casa';
  return cleanText(value);
}

function documentType(label: string): string {
  if (/edital/i.test(label)) return 'edital';
  if (/matr[ií]cula/i.test(label)) return 'matricula';
  if (/avalia[cç][aã]o/i.test(label)) return 'avaliacao';
  return 'outro';
}

function extractArea(text: string): number | undefined {
  const values = [...text.matchAll(/(\d[\d.]*(?:,\d+)?)\s*m[²2]\b/gi)]
    .map((match) => number(match[1])).filter((value) => value > 0);
  return values.length ? Math.max(...values) : undefined;
}

function number(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value ?? '').replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function validDate(value?: string): Date | undefined {
  if (!value || /^1900-01-01/.test(value)) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function absoluteUrl(value: string): string {
  return new URL(value, `${BASE_URL}/`).toString();
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
