import * as cheerio from 'cheerio';
import type { CatalogPage, CatalogProvider } from '../base/catalogProvider.js';
import type { LotData } from '../../types/lot.js';
import { TerminalLotUnavailableError } from '../../errors/terminalLotUnavailableError.js';

const BASE_URL = 'https://www.leiloeiropublico.com.br';
const API_URL = 'https://api-lances.leiloeiropublico.com.br';
const PAGE_SIZE = 40;

interface PublicLot {
  capa?: string;
  Leilao: string;
  Lt: string;
  Slt: string;
  Desc?: string;
  VlrAv?: string;
  St?: string;
  LanceMinimo?: string;
  ValorLanceAtual?: string;
  NumeroLances?: string;
  PrevisaoEncerramento?: string;
}
interface PublicEntry {
  lot: PublicLot;
  eventName: string;
  eventEnd: Date;
}

export class LeiloeiroPublicoRealEstateCatalogProvider implements CatalogProvider {
  public readonly site = 'leiloeiropublico';
  public readonly source = BASE_URL;
  private entriesPromise?: Promise<PublicEntry[]>;

  public constructor(private readonly requestIntervalMs = 750) {}

  public async scrapePage(page: number): Promise<CatalogPage> {
    const entries = await (this.entriesPromise ??= this.discover());
    const start = (page - 1) * PAGE_SIZE;
    const selected = entries.slice(start, start + PAGE_SIZE);
    return {
      page,
      pageSize: PAGE_SIZE,
      total: entries.length,
      hasNext: start + PAGE_SIZE < entries.length,
      lots: selected.map((entry) => ({
        url: lotUrl(entry.lot),
        data: mapLot(entry),
        classification: 'Imóveis',
        assetType: 'real_estate' as const,
      })),
    };
  }

  public async scrapeLot(url: string): Promise<LotData> {
    const ids = idsFromUrl(url);
    const entries = await (this.entriesPromise ??= this.discover());
    const entry = entries.find(({ lot }) =>
      lot.Leilao === ids.event && Number(lot.Lt) === Number(ids.lot) && Number(lot.Slt) === Number(ids.sublot));
    if (!entry) throw new TerminalLotUnavailableError('Leiloeiro Público lot is no longer in an active catalog');
    const response = await fetch(url, {
      headers: requestHeaders('text/html,application/xhtml+xml'),
      signal: AbortSignal.timeout(45_000),
    });
    if (response.status === 404 || response.status === 410) {
      throw new TerminalLotUnavailableError(`Leiloeiro Público lot returned HTTP ${response.status}`);
    }
    if (!response.ok) throw new Error(`Leiloeiro Público detail failed: HTTP ${response.status}`);
    return augmentFromDetail(mapLot(entry), await response.text(), url);
  }

  private async discover(): Promise<PublicEntry[]> {
    const home = await fetch(BASE_URL, {
      headers: requestHeaders('text/html,application/xhtml+xml'),
      signal: AbortSignal.timeout(45_000),
    });
    if (!home.ok) throw new Error(`Leiloeiro Público home failed: HTTP ${home.status}`);
    const $ = cheerio.load(await home.text());
    const events = unique($('a[href*="ListagemLote.aspx?Leilao="]').map((_, element) => {
      const href = $(element).attr('href') ?? '';
      return new URL(href, BASE_URL).searchParams.get('Leilao') ?? '';
    }).get().filter(Boolean));
    const entries: PublicEntry[] = [];
    for (const event of events) {
      const metadata = await eventMetadata(event);
      const response = await fetch(`${API_URL}/sublote/listagemlote/${encodeURIComponent(event)}/`, {
        headers: requestHeaders('application/json'),
        signal: AbortSignal.timeout(45_000),
      });
      if (!response.ok) throw new Error(`Leiloeiro Público API ${event} failed: HTTP ${response.status}`);
      const lots = await response.json() as PublicLot[];
      entries.push(...lots.filter((lot) => looksLikeRealEstate(lot.Desc ?? ''))
        .map((lot) => ({ lot, ...metadata })));
      if (this.requestIntervalMs > 0) await sleep(this.requestIntervalMs);
    }
    return entries;
  }
}

async function eventMetadata(event: string): Promise<{ eventName: string; eventEnd: Date }> {
  const response = await fetch(`${BASE_URL}/ListagemLote.aspx?Leilao=${encodeURIComponent(event)}`, {
    headers: requestHeaders('text/html,application/xhtml+xml'),
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error(`Leiloeiro Público event ${event} failed: HTTP ${response.status}`);
  const $ = cheerio.load(await response.text());
  const eventName = plainText($('#ctl00_SectionConteudo_CabecalhoLeilao1_TituloLeilao').text())
    || plainText($('title').text());
  const dateRows = $('#informacoes-leilao tr').map((_, row) => plainText($(row).text()))
    .get().filter((value) => /^Data:/i.test(value));
  const dates = dateRows.map(brDate).filter(isDate);
  return { eventName, eventEnd: dates.at(-1) ?? new Date() };
}

function mapLot(entry: PublicEntry): LotData {
  const lot = entry.lot;
  const description = plainText(lot.Desc ?? '');
  const location = parseLocation(description);
  const currentBid = money(lot.ValorLanceAtual);
  const minimum = money(lot.LanceMinimo);
  const end = isoDate(lot.PrevisaoEncerramento) ?? entry.eventEnd;
  const edital = `https://arquivos.leiloeiropublico.com.br/Edital/${eventYear(lot.Leilao)}/${lot.Leilao}/Lote.${Number(lot.Lt)}/edital.pdf`;
  return {
    title: description,
    currentBid,
    nextBid: currentBid || minimum,
    auctionEnd: end,
    city: location.city,
    state: location.state,
    address: [location.city, location.state].filter(Boolean).join(' / '),
    ...(description ? { observations: description } : {}),
    propertyType: propertyType(description),
    ...(minimum ? { firstRoundMinimumValue: minimum } : {}),
    lotNumber: `${lot.Lt}.${lot.Slt}`,
    externalCode: `${lot.Leilao}-${lot.Lt}-${lot.Slt}`,
    sourceAnnouncementId: `${lot.Leilao}-${lot.Lt}-${lot.Slt}`,
    saleStatus: plainText(lot.St ?? ''),
    displayStatus: plainText(lot.St ?? ''),
    classification: 'Imóveis',
    assetType: 'real_estate',
    bidCount: Number(lot.NumeroLances ?? 0),
    eventName: entry.eventName,
    eventExternalCode: lot.Leilao,
    eventUrl: `${BASE_URL}/ListagemLote.aspx?Leilao=${encodeURIComponent(lot.Leilao)}`,
    imageUrls: lot.capa ? [lot.capa.replace('/Foto//', '/Foto/')] : [],
    documents: [{ url: edital, label: `Edital do lote ${Number(lot.Lt)}`, documentType: 'edital' }],
    additionalDetails: { avaliacao: String(money(lot.VlrAv)), leiloeiro: 'Rodolfo da Rosa Schöntag' },
  };
}

function augmentFromDetail(data: LotData, html: string, pageUrl: string): LotData {
  const $ = cheerio.load(html);
  const documents = unique($('a[href]').map((_, element) => {
    const href = $(element).attr('href') ?? '';
    return /\.pdf(?:\?|$)/i.test(href) ? new URL(href, pageUrl).toString() : '';
  }).get().filter(Boolean)).map((url) => ({
    url,
    label: decodeURIComponent(new URL(url).pathname.split('/').at(-1) ?? 'Documento'),
    documentType: documentType(url),
  }));
  const images = unique($('img[src]').map((_, element) => {
    const src = $(element).attr('src') ?? '';
    return /arquivos\.leiloeiropublico\.com\.br\/Foto\//i.test(src) ? new URL(src, pageUrl).toString() : '';
  }).get().filter(Boolean));
  const description = plainText($('meta[name="description"]').attr('content') ?? '') || data.observations;
  return {
    ...data,
    ...(description ? { observations: description } : {}),
    imageUrls: images.length ? images : (data.imageUrls ?? []),
    documents: documents.length ? documents : (data.documents ?? []),
  };
}

function lotUrl(lot: PublicLot): string {
  return `${BASE_URL}/DetalheLote.aspx?Leilao=${encodeURIComponent(lot.Leilao)}&Lote=${Number(lot.Lt)}&Sublote=${Number(lot.Slt)}`;
}
function idsFromUrl(url: string): { event: string; lot: string; sublot: string } {
  const parsed = new URL(url);
  const event = parsed.searchParams.get('Leilao') ?? '';
  const lot = parsed.searchParams.get('Lote') ?? '';
  const sublot = parsed.searchParams.get('Sublote') ?? '1';
  if (!event || !lot) throw new Error(`Invalid Leiloeiro Público lot URL: ${url}`);
  return { event, lot, sublot };
}
function parseLocation(value: string): { city: string; state: string } {
  const match = /^(.+?)\s*\(([A-Z]{2})\)/i.exec(value) ?? /\b([^|,]+?)\/([A-Z]{2})\b/i.exec(value);
  return { city: plainText(match?.[1] ?? ''), state: (match?.[2] ?? '').toUpperCase() };
}
function propertyType(value: string): string {
  const normalized = normalize(value);
  if (/apartamento|apto/.test(normalized)) return 'apartamento';
  if (/casa|sobrado|residencia/.test(normalized)) return 'casa';
  if (/terreno|lote|gleba/.test(normalized)) return 'terreno';
  if (/fazenda|sitio|chacara|rural/.test(normalized)) return 'rural';
  if (/galpao|industrial/.test(normalized)) return 'galpao';
  if (/comercial|loja|sala|predio/.test(normalized)) return 'comercial';
  return 'outro';
}
function looksLikeRealEstate(value: string): boolean {
  return /\b(?:im[oó]vel|apartamento|apto|casa|sobrado|resid[eê]ncia|terreno|lote(?:amento)?|gleba|fazenda|s[ií]tio|ch[aá]cara|rural|galp[aã]o|pr[eé]dio|sala|loja|garagem|dom[ií]nio [uú]til)\b/i.test(value);
}
function documentType(value: string): string {
  const normalized = normalize(value);
  if (normalized.includes('matricula')) return 'matricula';
  if (normalized.includes('edital')) return 'edital';
  if (normalized.includes('laudo') || normalized.includes('avaliacao')) return 'laudo';
  return 'outro';
}
function money(value: string | undefined): number {
  const parsed = Number((value ?? '').replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}
function brDate(value: string): Date | undefined {
  const match = /(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/.exec(value);
  if (!match?.[1] || !match[2] || !match[3]) return undefined;
  const parsed = new Date(`${match[3]}-${match[2]}-${match[1]}T${match[4] ?? '23'}:${match[5] ?? '59'}:00-03:00`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}
function isoDate(value: string | undefined): Date | undefined {
  if (!value || /^0001-/.test(value)) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}
function isDate(value: Date | undefined): value is Date { return Boolean(value); }
function eventYear(event: string): string { return `20${event.slice(0, 2)}`; }
function requestHeaders(accept: string): Record<string, string> { return { accept, 'user-agent': 'Mozilla/5.0 (compatible; AuctionMonitor/1.0)' }; }
function plainText(value: string): string { return cheerio.load(`<div>${value}</div>`)('div').text().replace(/\s+/g, ' ').trim(); }
function normalize(value: string): string { return plainText(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
function unique<T>(values: T[]): T[] { return [...new Set(values)]; }
function sleep(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }
