import * as cheerio from 'cheerio';
import type { CatalogPage, CatalogProvider } from '../base/catalogProvider.js';
import type { LotData } from '../../types/lot.js';
import { TerminalLotUnavailableError } from '../../errors/terminalLotUnavailableError.js';

const PAGE_SIZE = 24;

export interface SuporteLeiloesDefinition {
  site: string;
  baseUrl: string;
  catalogPath?: string;
}

interface EmbeddedDate { date?: string }
interface EmbeddedDocument {
  url?: string;
  nome?: string;
  originalFilename?: string;
  tipo?: { nome?: string };
}
interface EmbeddedLot {
  id: number;
  active?: boolean;
  deleted?: boolean;
  slug?: string;
  numero?: number;
  numeroString?: string | null;
  descricao?: string;
  observacao?: string | null;
  status?: number;
  valorLanceAtual?: number | null;
  valorArremate?: number | null;
  valorAvaliacao?: number | null;
  valorIncremento?: number | null;
  valorInicial?: number | null;
  valorInicial2?: number | null;
  valorInicial3?: number | null;
  valorMinimo?: number | null;
  dataFechamento?: EmbeddedDate | null;
  totalLances?: number | null;
  leilao?: {
    id?: number;
    slug?: string;
    codigo?: string;
    titulo?: string;
    dataAbertura?: EmbeddedDate | null;
    data1?: EmbeddedDate | null;
    data2?: EmbeddedDate | null;
    data3?: EmbeddedDate | null;
    judicial?: boolean;
    documentos?: EmbeddedDocument[];
    leiloeiro?: { nome?: string; matricula?: string };
    stats?: {
      lote?: {
        bem?: {
          cidade?: string;
          uf?: string;
          siteTitulo?: string;
          siteSubtitulo?: string;
          imovel?: { ocupado?: number };
        };
      };
    };
  };
}

export class SuporteLeiloesRealEstateCatalogProvider implements CatalogProvider {
  public readonly site: string;
  public readonly source: string;
  private readonly baseUrl: string;
  private lotUrlsPromise?: Promise<string[]>;

  public constructor(
    definition: SuporteLeiloesDefinition,
    private readonly requestIntervalMs = 750,
  ) {
    this.site = definition.site;
    this.baseUrl = definition.baseUrl.replace(/\/$/, '');
    this.source = `${this.baseUrl}${definition.catalogPath ?? '/leiloes'}`;
  }

  public async scrapePage(page: number): Promise<CatalogPage> {
    const urls = await (this.lotUrlsPromise ??= this.discoverLotUrls());
    const start = (page - 1) * PAGE_SIZE;
    const selected = urls.slice(start, start + PAGE_SIZE);
    const collected = await mapConcurrent(selected, 4, async (url) => {
      try {
        const data = await this.scrapeLot(url);
        return { url, data, classification: 'Imóveis', assetType: 'real_estate' as const };
      } catch (error) {
        if (error instanceof TerminalLotUnavailableError) return undefined;
        throw error;
      } finally {
        if (this.requestIntervalMs > 0) await sleep(this.requestIntervalMs);
      }
    });
    const lots = collected.filter((lot): lot is NonNullable<typeof lot> => Boolean(lot));
    return {
      page,
      pageSize: PAGE_SIZE,
      total: urls.length,
      hasNext: start + PAGE_SIZE < urls.length,
      lots,
    };
  }

  public async scrapeLot(url: string): Promise<LotData> {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AuctionMonitor/1.0)' },
      signal: AbortSignal.timeout(45_000),
    });
    if (response.status === 404 || response.status === 410) {
      throw new TerminalLotUnavailableError(`${this.site} lot is no longer available (HTTP ${response.status})`);
    }
    if (!response.ok) throw new Error(`${this.site} lot failed: HTTP ${response.status}`);
    const html = await response.text();
    const lot = embeddedLot(html);
    if (!lot) throw new TerminalLotUnavailableError(`${this.site} page no longer contains lot data`);
    if (!isRealEstateLot(lot)) {
      throw new TerminalLotUnavailableError(`${this.site} lot ${lot.id} is not a real-estate lot`);
    }
    return mapLot(lot, html, response.url, this.baseUrl);
  }

  private async discoverLotUrls(): Promise<string[]> {
    const catalog = await this.fetchHtml(this.source);
    const eventUrls = eventLinks(catalog.html, catalog.url, this.baseUrl);
    const lots = new Set<string>();
    await mapConcurrent(eventUrls, 4, async (eventUrl) => {
      let event: { html: string; url: string };
      try {
        event = await this.fetchHtml(eventUrl);
      } catch {
        return;
      }
      if (/\/leiloes\/?(?:\?|$)/i.test(new URL(event.url).pathname)) return;
      const directLot = embeddedLot(event.html);
      if (directLot) lots.add(canonicalLotUrl(event.html, event.url, directLot.id));
      for (const url of lotLinks(event.html, event.url)) lots.add(url);
      const pages = paginationCount(event.html);
      for (let page = 2; page <= pages; page += 1) {
        if (this.requestIntervalMs > 0) await sleep(this.requestIntervalMs);
        const separator = event.url.includes('?') ? '&' : '?';
        const result = await this.fetchHtml(`${event.url}${separator}page=${page}`);
        for (const url of lotLinks(result.html, result.url)) lots.add(url);
      }
    });
    return [...lots];
  }

  private async fetchHtml(url: string): Promise<{ html: string; url: string }> {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AuctionMonitor/1.0)' },
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) throw new Error(`${this.site} catalog failed: HTTP ${response.status}`);
    return { html: await response.text(), url: response.url };
  }
}

function embeddedLot(html: string): EmbeddedLot | undefined {
  const match = /var\s+lote\s*=\s*(\{[\s\S]*?\});\s*(?:var|const|let|\r?\n)/.exec(html);
  if (!match?.[1]) return undefined;
  try {
    return JSON.parse(match[1]) as EmbeddedLot;
  } catch {
    return undefined;
  }
}

function eventLinks(html: string, pageUrl: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const host = new URL(baseUrl).hostname.replace(/^www\./, '');
  const urls = new Set<string>();
  $('a[href*="/eventos/leilao/"]').each((_, element) => {
    const href = $(element).attr('href');
    if (!href || /\/lote\/\d+/i.test(href)) return;
    try {
      const url = new URL(href, pageUrl);
      if (url.hostname.replace(/^www\./, '') !== host) return;
      if (!/\/eventos\/leilao\/(?:\d+\/[^/?#]+|[^/?#]+\/lote)\/?$/i.test(url.pathname)) return;
      url.hash = '';
      url.search = '';
      urls.add(url.toString());
    } catch {
      // Ignore malformed social/share links.
    }
  });
  return [...urls];
}

function lotLinks(html: string, pageUrl: string): string[] {
  const $ = cheerio.load(html);
  const host = new URL(pageUrl).hostname.replace(/^www\./, '');
  const urls = new Set<string>();
  $('a[href*="/lote/"]').each((_, element) => {
    const href = $(element).attr('href');
    if (!href || !/\/eventos\/leilao\/[^/?#]+\/lote\/\d+(?:\/[^/?#]+)?/i.test(href)) return;
    try {
      const url = new URL(href, pageUrl);
      if (url.hostname.replace(/^www\./, '') !== host) return;
      url.hash = '';
      url.search = '';
      urls.add(url.toString());
    } catch {
      // Ignore malformed social/share links.
    }
  });
  return [...urls];
}

function paginationCount(html: string): number {
  const pages = [...html.matchAll(/[?&]page=(\d+)/gi)].map((match) => Number(match[1]));
  return Math.max(1, ...pages.filter(Number.isFinite));
}

function canonicalLotUrl(html: string, fallbackUrl: string, lotId: number): string {
  const links = lotLinks(html, fallbackUrl);
  return links.find((url) => new RegExp(`/lote/${lotId}(?:/|$)`).test(new URL(url).pathname)) ?? fallbackUrl;
}

function mapLot(lot: EmbeddedLot, html: string, url: string, baseUrl: string): LotData {
  const $ = cheerio.load(html);
  const bem = lot.leilao?.stats?.lote?.bem;
  const title = plainText(lot.descricao ?? bem?.siteTitulo ?? $('h1').last().text());
  const description = plainText(
    $('h6').filter((_, element) => normalize($(element).text()) === 'descricao').first().next('p').text()
      || bem?.siteSubtitulo
      || lot.observacao
      || '',
  );
  const images = unique($('img').map((_, element) => $(element).attr('src')).get()
    .filter((source): source is string => Boolean(source && /static\.suporteleiloes\.com\.br\/.+\/bens\//i.test(source)))
    .map((source) => new URL(source, url).toString()));
  const documents = documentLinks($, url, lot.leilao?.documentos ?? []);
  const city = plainText(bem?.cidade ?? '');
  const state = plainText(bem?.uf ?? '');
  const auctionEnd = dateValue(lot.dataFechamento) ?? dateValue(lot.leilao?.data3)
    ?? dateValue(lot.leilao?.data2) ?? dateValue(lot.leilao?.data1) ?? new Date();
  const auctionStart = dateValue(lot.leilao?.dataAbertura);
  const currentBid = numberValue(lot.valorLanceAtual ?? lot.valorArremate);
  const firstRound = numberValue(lot.valorInicial ?? lot.valorMinimo);
  const secondRound = numberValue(lot.valorInicial2);
  const thirdRound = numberValue(lot.valorInicial3);
  const eventId = lot.leilao?.id;
  const eventSlug = lot.leilao?.slug;
  return {
    title,
    currentBid,
    nextBid: currentBid || firstRound || secondRound || thirdRound,
    auctionEnd,
    ...(auctionStart ? { auctionStart } : {}),
    city,
    state,
    address: [city, state].filter(Boolean).join(' / '),
    propertyType: normalizePropertyType(`${title} ${description}`),
    ...(firstRound ? { firstRoundMinimumValue: firstRound } : {}),
    ...(secondRound ? { secondRoundMinimumValue: secondRound } : {}),
    ...(thirdRound ? { thirdRoundMinimumValue: thirdRound } : {}),
    ...(description ? { observations: description } : {}),
    lotNumber: String(lot.numeroString ?? lot.numero ?? lot.id),
    externalCode: String(lot.id),
    sourceAnnouncementId: String(lot.id),
    ...(lot.leilao?.leiloeiro?.nome ? { consignor: plainText(lot.leilao.leiloeiro.nome) } : {}),
    saleStatus: lotStatus(lot),
    displayStatus: lotStatus(lot),
    classification: 'Imóveis',
    assetType: 'real_estate',
    bidCount: Number(lot.totalLances ?? 0),
    eventName: plainText(lot.leilao?.titulo ?? ''),
    ...(eventId ? { eventExternalCode: String(eventId) } : {}),
    ...(eventId && eventSlug ? { eventUrl: `${baseUrl}/eventos/leilao/${eventId}/${eventSlug}` } : {}),
    imageUrls: images,
    documents,
    additionalDetails: {
      leiloeiro: plainText(lot.leilao?.leiloeiro?.nome ?? ''),
      registroLeiloeiro: plainText(lot.leilao?.leiloeiro?.matricula ?? ''),
      avaliacao: String(numberValue(lot.valorAvaliacao)),
      incremento: String(numberValue(lot.valorIncremento)),
      urlOriginal: url,
    },
  };
}

function documentLinks(
  $: cheerio.CheerioAPI,
  pageUrl: string,
  eventDocuments: EmbeddedDocument[],
): NonNullable<LotData['documents']> {
  const documents = new Map<string, { url: string; label: string; documentType: string }>();
  for (const document of eventDocuments) {
    if (!document.url) continue;
    const label = plainText(document.nome ?? document.tipo?.nome ?? document.originalFilename ?? 'Documento');
    documents.set(document.url, { url: document.url, label, documentType: documentType(label) });
  }
  $('a[href]').each((_, element) => {
    const href = $(element).attr('href');
    if (!href) return;
    let documentUrl: string | undefined;
    try {
      const resolved = new URL(href, pageUrl);
      documentUrl = resolved.pathname === '/documentos/download'
        ? resolved.searchParams.get('url') ?? undefined
        : /\.pdf(?:$|\?)/i.test(resolved.toString()) ? resolved.toString() : undefined;
    } catch {
      return;
    }
    if (!documentUrl) return;
    const label = plainText($(element).text()) || 'Documento';
    documents.set(documentUrl, { url: documentUrl, label, documentType: documentType(label) });
  });
  return [...documents.values()];
}

function lotStatus(lot: EmbeddedLot): string {
  if (lot.deleted || lot.active === false) return 'Retirado';
  if (numberValue(lot.valorArremate) > 0) return 'Arrematado';
  if (lot.status === 1) return 'Aberto para Lances';
  if (lot.status === 2) return 'Em Disputa';
  if (lot.status === 5) return 'Condicional';
  return String(lot.status ?? 'open');
}

function isRealEstateLot(lot: EmbeddedLot): boolean {
  const bem = lot.leilao?.stats?.lote?.bem;
  return bem?.imovel !== null && bem?.imovel !== undefined;
}

function dateValue(value: EmbeddedDate | null | undefined): Date | undefined {
  if (!value?.date) return undefined;
  const date = new Date(`${value.date.replace(' ', 'T').replace(/\.\d+$/, '')}-03:00`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function normalizePropertyType(value: string): string {
  const normalized = normalize(value);
  if (/apartamento|apto\b/.test(normalized)) return 'apartamento';
  if (/casa|sobrado|residencia/.test(normalized)) return 'casa';
  if (/terreno|lote\b|urbano/.test(normalized)) return 'terreno';
  if (/loja|sala|conjunto|comercial|industrial/.test(normalized)) return 'comercial';
  if (/sitio|fazenda|chacara|rural|gleba/.test(normalized)) return 'rural';
  if (/galpao|barracao/.test(normalized)) return 'galpao';
  return 'outro';
}

function documentType(label: string): string {
  const value = normalize(label);
  if (value.includes('matricula')) return 'matricula';
  if (value.includes('edital')) return 'edital';
  if (value.includes('avaliacao') || value.includes('laudo')) return 'laudo';
  return 'outro';
}

function plainText(value: string): string {
  return cheerio.load(`<div>${value}</div>`)('div').text().replace(/\s+/g, ' ').trim();
}
function normalize(value: string): string {
  return plainText(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
function numberValue(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
function unique<T>(values: T[]): T[] { return [...new Set(values)]; }
function sleep(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const result = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length || 1) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      const item = items[index];
      if (item !== undefined) result[index] = await mapper(item);
    }
  });
  await Promise.all(workers);
  return result;
}
