import * as cheerio from 'cheerio';
import initCycleTLS from 'cycletls';
import type { CatalogPage, CatalogProvider } from '../base/catalogProvider.js';
import type { LotData } from '../../types/lot.js';
import { TerminalLotUnavailableError } from '../../errors/terminalLotUnavailableError.js';

const BASE_URL = 'https://milanleiloes.com.br';
const CATALOG_URL = `${BASE_URL}/pesquisa/imoveis`;
const PAGE_SIZE = 24;

export interface MilanPage {
  url: string;
  html: string;
  status: number;
}

export interface MilanBinaryResource {
  body: Buffer;
  contentType: string;
}

interface FlareSolverrResponse {
  status?: string;
  message?: string;
  solution?: {
    url?: string;
    status?: number;
    response?: string;
    userAgent?: string;
    cookies?: Array<{
      name?: string;
      value?: string;
      domain?: string;
      expires?: number;
    }>;
  };
}

export class MilanPageClient {
  private readonly sessionName = `auction-monitor-milan-${process.pid}`;
  private sessionPromise: Promise<void> | undefined;
  private cookieHeader = '';
  private userAgent = browserHeaders()['User-Agent'] ?? '';
  private directClearanceSupported: boolean | undefined;

  public constructor(private readonly flareSolverrUrl?: string) {}

  public async get(url: string): Promise<MilanPage> {
    let directPage: MilanPage | undefined;
    if (this.directClearanceSupported !== false || !this.flareSolverrUrl) {
      try {
        const usedClearance = Boolean(this.cookieHeader);
        directPage = usedClearance
          ? await this.getWithBrowserTls(url)
          : await this.getNative(url);
        const incomplete = directPage.status >= 200 && directPage.status < 300
          && !isMilanPageComplete(url, directPage.html);
        if (directPage.status >= 200 && directPage.status < 300
          && !isCloudflareChallenge(directPage.html) && !incomplete) {
          if (usedClearance) this.directClearanceSupported = true;
          return directPage;
        }
        if (usedClearance && (isCloudflareBlocked(directPage) || incomplete)) {
          this.directClearanceSupported = false;
        }
        if (!isCloudflareBlocked(directPage) && !incomplete) return directPage;
      } catch (error) {
        if (!this.flareSolverrUrl) throw error;
        if (this.cookieHeader) this.directClearanceSupported = false;
      }
    }

    if (!this.flareSolverrUrl) {
      return directPage ?? { url, html: '', status: 503 };
    }

    await (this.sessionPromise ??= this.ensureSession());
    let result = await this.flareRequest(url);
    if (result.status !== 'ok' || !result.solution?.response) {
      this.sessionPromise = undefined;
      await (this.sessionPromise = this.ensureSession());
      result = await this.flareRequest(url);
    }
    if (result.status !== 'ok' || !result.solution?.response) {
      throw new Error(`FlareSolverr failed for Milan: ${result.message || 'empty response'}`);
    }
    this.updateClearance(result);

    return {
      url: result.solution.url ?? url,
      html: result.solution.response,
      status: result.solution.status ?? 200,
    };
  }

  public async downloadBinary(url: string): Promise<MilanBinaryResource> {
    const target = new URL(url);
    if (target.hostname !== 'adm.milanleiloes.com.br') {
      throw new Error(`Unsupported Milan media host: ${target.hostname}`);
    }
    if (!this.flareSolverrUrl) throw new Error('MILAN_FLARESOLVERR_URL is not configured');
    await (this.sessionPromise ??= this.ensureSession());
    if (!this.cookieHeader) await this.refreshClearance(url);

    let response = await this.getBinaryWithBrowserTls(url);
    if (isBlockedStatus(response.status)) {
      await this.refreshClearance(url);
      response = await this.getBinaryWithBrowserTls(url);
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Milan protected media failed: HTTP ${response.status}`);
    }
    return { body: response.body, contentType: response.contentType };
  }

  private async getNative(url: string): Promise<MilanPage> {
    const response = await fetch(url, {
      headers: this.requestHeaders(),
      redirect: 'follow',
      signal: AbortSignal.timeout(45_000),
    });
    return {
      url: response.url || url,
      html: await response.text(),
      status: response.status,
    };
  }

  private async getWithBrowserTls(url: string): Promise<MilanPage> {
    const cycleTLS = await initCycleTLS();
    try {
      const response = await cycleTLS(url, {
        body: '',
        ja3: '771,4865-4866-4867-49195-49199-49196-49200-52393-52392,0-23-65281-10-11-35-16-5-13-18-51-45-43-27-17513,29-23-24,0',
        userAgent: this.userAgent,
        headers: this.requestHeaders(),
        timeout: 45_000,
        insecureSkipVerify: true,
      }, 'get');
      return {
        url: response.finalUrl || url,
        html: response.body ?? await response.text(),
        status: response.status,
      };
    } finally {
      await cycleTLS.exit();
    }
  }

  private async getBinaryWithBrowserTls(url: string): Promise<{
    status: number;
    body: Buffer;
    contentType: string;
  }> {
    const cycleTLS = await initCycleTLS();
    try {
      const response = await cycleTLS(url, {
        body: '',
        userAgent: this.userAgent,
        headers: {
          ...this.requestHeaders(),
          Accept: 'application/pdf,image/avif,image/webp,image/*,*/*;q=0.8',
          Referer: `${BASE_URL}/`,
        },
        timeout: 60_000,
        insecureSkipVerify: true,
        responseType: 'arraybuffer',
      }, 'get');
      return {
        status: response.status,
        body: binaryBuffer(response.data),
        contentType: responseHeader(response.headers, 'content-type'),
      };
    } finally {
      await cycleTLS.exit();
    }
  }

  private requestHeaders(): Record<string, string> {
    return {
      ...browserHeaders(),
      'User-Agent': this.userAgent,
      ...(this.cookieHeader ? { Cookie: this.cookieHeader } : {}),
    };
  }

  private updateClearance(result: FlareSolverrResponse): void {
    const solution = result.solution;
    if (!solution) return;
    if (solution.userAgent) this.userAgent = solution.userAgent;
    const now = Date.now() / 1000;
    const cookies = (solution.cookies ?? []).filter((cookie) =>
      cookie.name && cookie.value
      && (!cookie.domain || cookie.domain === 'milanleiloes.com.br'
        || cookie.domain.endsWith('.milanleiloes.com.br'))
      && (!cookie.expires || cookie.expires > now));
    if (cookies.length) {
      this.cookieHeader = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
    }
  }

  private async ensureSession(): Promise<void> {
    const listed = await this.flareCommand({ cmd: 'sessions.list' }) as {
      sessions?: string[];
    };
    if (listed.sessions?.includes(this.sessionName)) return;
    const created = await this.flareCommand({
      cmd: 'sessions.create',
      session: this.sessionName,
    }) as FlareSolverrResponse;
    if (created.status !== 'ok') {
      throw new Error(`Unable to create Milan FlareSolverr session: ${created.message || 'unknown error'}`);
    }
  }

  private async flareRequest(url: string): Promise<FlareSolverrResponse> {
    return this.flareCommand({
      cmd: 'request.get',
      url,
      session: this.sessionName,
      session_ttl_minutes: 30,
      maxTimeout: 60_000,
    }) as Promise<FlareSolverrResponse>;
  }

  private async refreshClearance(url: string): Promise<void> {
    const result = await this.flareRequest(url);
    if (result.status !== 'ok') {
      throw new Error(`FlareSolverr failed to authorize Milan media: ${result.message || 'unknown error'}`);
    }
    this.updateClearance(result);
  }

  private async flareCommand(payload: Record<string, unknown>): Promise<unknown> {
    const response = await fetch(this.flareSolverrUrl!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(75_000),
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(`FlareSolverr HTTP ${response.status}: ${body.slice(0, 300)}`);
    }
    return JSON.parse(body) as unknown;
  }
}

interface CatalogEntry {
  url: string;
  eventDate?: Date;
}

export class MilanRealEstateCatalogProvider implements CatalogProvider {
  public readonly site = 'milanleiloes';
  public readonly source = CATALOG_URL;
  private entriesPromise?: Promise<CatalogEntry[]>;
  private readonly eventDateCache = new Map<string, Promise<Date | undefined>>();

  public constructor(
    private readonly requestIntervalMs = 750,
    private readonly client = new MilanPageClient(),
  ) {}

  public async scrapePage(page: number): Promise<CatalogPage> {
    const entries = await (this.entriesPromise ??= this.discover());
    const start = (page - 1) * PAGE_SIZE;
    const selected = entries.slice(start, start + PAGE_SIZE);
    const lots = [];
    for (const entry of selected) {
      const data = await this.scrapeEntry(entry);
      if (!data) continue;
      lots.push({
        url: entry.url,
        data,
        classification: 'Imóveis',
        assetType: 'real_estate' as const,
      });
      if (this.requestIntervalMs > 0) await sleep(this.requestIntervalMs);
    }
    return {
      page,
      pageSize: PAGE_SIZE,
      total: entries.length,
      hasNext: start + PAGE_SIZE < entries.length,
      lots,
    };
  }

  public async scrapeLot(url: string): Promise<LotData> {
    const data = await this.scrapeEntry({ url }, false);
    if (!data) {
      throw new TerminalLotUnavailableError('Milan lot is no longer available');
    }
    return data;
  }

  private async scrapeEntry(entry: CatalogEntry, skipUnavailable = true): Promise<LotData | undefined> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const result = await this.client.get(entry.url);
      if (result.status === 404 || result.status === 410) {
        if (skipUnavailable) return undefined;
        throw new TerminalLotUnavailableError(`Milan lot is no longer available (HTTP ${result.status})`);
      }
      if (result.status < 200 || result.status >= 300) throw accessError('detail', result.status);
      try {
        return await this.parseLotWithEvent(result, entry.eventDate);
      } catch (error) {
        lastError = error;
        if (!(error instanceof TerminalLotUnavailableError) || attempt === 2) throw error;
        await sleep(500);
      }
    }
    throw lastError;
  }

  private async parseLotWithEvent(result: MilanPage, knownEventDate?: Date): Promise<LotData> {
    const eventId = eventIdFromUrl(result.url);
    let eventDate = knownEventDate;
    if (!eventDate && eventId) {
      eventDate = await this.eventDate(eventId);
    }
    return parseMilanLot(result.html, result.url, eventDate);
  }

  private async eventDate(eventId: string): Promise<Date | undefined> {
    const cached = this.eventDateCache.get(eventId);
    if (cached) return cached;
    const pending = this.loadEventDate(eventId);
    this.eventDateCache.set(eventId, pending);
    try {
      return await pending;
    } catch (error) {
      this.eventDateCache.delete(eventId);
      throw error;
    }
  }

  private async loadEventDate(eventId: string): Promise<Date | undefined> {
    const event = await this.client.get(`${BASE_URL}/leilao/${eventId}`);
    if (event.status < 200 || event.status >= 300) return undefined;
    return eventDateFromHtml(event.html, eventId);
  }

  private async discover(): Promise<CatalogEntry[]> {
    const response = await this.client.get(CATALOG_URL);
    if (response.status < 200 || response.status >= 300) throw accessError('catalog', response.status);
    const $ = cheerio.load(response.html);
    const eventDates = eventDatesFromHtml(response.html);
    const entries = new Map<string, CatalogEntry>();
    $('a[href*="/leilao/"][href*="/lote/"]').each((_, element) => {
      const href = $(element).attr('href')?.trim();
      if (!href || !/\/leilao\/\d+\/lote\/[^/?#]+/i.test(href)) return;
      const url = canonicalUrl(href, response.url);
      const eventId = eventIdFromUrl(url);
      const eventDate = eventId ? eventDates.get(eventId) : undefined;
      entries.set(url, { url, ...(eventDate ? { eventDate } : {}) });
    });
    if (!entries.size) throw new Error('Milan catalog returned no real-estate lot links');
    return [...entries.values()];
  }
}

export function parseMilanLot(html: string, pageUrl: string, eventDate?: Date): LotData {
  const $ = cheerio.load(html);
  const headings = $('h1').map((_, element) => plainText($(element).text())).get()
    .filter((value) => value && !/^Milan Leilões$/i.test(value) && !/^Leilão de Imóveis$/i.test(value));
  const title = headings.sort((left, right) => right.length - left.length)[0] ?? '';
  if (!title) throw new TerminalLotUnavailableError('Milan page no longer contains an active lot');

  const descriptionLabel = $('label').filter((_, element) => normalize($(element).text()) === 'descricao').first();
  const description = plainText(descriptionLabel.parent().find('div').last().text());
  const titleWrapper = $('h1').filter((_, element) => plainText($(element).text()) === title).first().parent().parent();
  const currentBid = money(titleWrapper.find('h4').text());
  const initialBid = money(titleWrapper.find('p').filter((_, element) => /lance inicial/i.test($(element).text())).text());
  const status = plainText(titleWrapper.find('[id*="estadoLote"]').first().text()) || 'open';
  const ids = idsFromUrl(pageUrl);
  const location = parseLocation(title, description);
  const images = imageUrls(html, $, pageUrl);
  const documents = documentUrls(html, pageUrl);
  const dates = isoDates(html);
  const auctionEnd = eventDate ?? dates.at(-1) ?? new Date();
  const area = areaValues(`${title} ${description}`);
  const consignor = plainText($('img[alt]').filter((_, element) => {
    const alt = normalize($(element).attr('alt') ?? '');
    return Boolean(alt) && !/foto|logo|icone|mapa/.test(alt);
  }).first().attr('alt') ?? '');

  return {
    title,
    currentBid,
    nextBid: currentBid || initialBid,
    auctionEnd,
    city: location.city,
    state: location.state,
    address: location.address,
    ...(location.neighborhood ? {
      neighborhood: location.neighborhood,
      neighborhoodNormalized: normalizeLocation(location.neighborhood),
    } : {}),
    propertyType: normalizePropertyType(`${title} ${description}`),
    ...(/desocupad/i.test(description)
      ? { occupancyStatus: 'desocupado' }
      : /ocupad/i.test(description) ? { occupancyStatus: 'ocupado' } : {}),
    ...(area.total ? { totalAreaM2: area.total } : {}),
    ...(area.private ? { privateAreaM2: area.private } : {}),
    ...(description ? { observations: description } : {}),
    ...(initialBid ? { firstRoundMinimumValue: initialBid } : {}),
    lotNumber: ids.lot,
    externalCode: `${ids.event}-${ids.lot}`,
    sourceAnnouncementId: `${ids.event}-${ids.lot}`,
    ...(consignor ? { consignor } : {}),
    saleStatus: status,
    displayStatus: status,
    classification: 'Imóveis',
    assetType: 'real_estate',
    eventName: 'Leilão de Imóveis',
    eventExternalCode: ids.event,
    eventUrl: `${BASE_URL}/leilao/${ids.event}`,
    imageUrls: images,
    documents,
    additionalDetails: { urlOriginal: pageUrl, lanceInicial: String(initialBid) },
  };
}

function eventDatesFromHtml(html: string): Map<string, Date> {
  const decoded = decodeNextFlight(html);
  const dates = new Map<string, Date>();
  const pattern = /"codLeilao":(\d+),"dataInicio":"([^"]+)"/g;
  for (const match of decoded.matchAll(pattern)) {
    const date = new Date(match[2] ?? '');
    if (match[1] && !Number.isNaN(date.getTime())) dates.set(match[1], date);
  }
  return dates;
}

function eventDateFromHtml(html: string, eventId: string): Date | undefined {
  return eventDatesFromHtml(html).get(eventId) ?? isoDates(html).at(-1);
}

function decodeNextFlight(html: string): string {
  const $ = cheerio.load(html);
  const decoded: string[] = [];
  $('script:not([src])').each((_, element) => {
    const source = $(element).text();
    for (const match of source.matchAll(/self\.__next_f\.push\(\[1,"((?:\\.|[^"\\])*)"\]\)/g)) {
      try {
        decoded.push(JSON.parse(`"${match[1]}"`) as string);
      } catch {
        // Ignore unrelated or truncated RSC chunks.
      }
    }
  });
  return decoded.join('\n');
}

function documentUrls(html: string, pageUrl: string): NonNullable<LotData['documents']> {
  const decoded = `${html}\n${decodeNextFlight(html)}`.replace(/\\u0026/g, '&').replace(/\\\//g, '/');
  const urls = decoded.match(/https?:\/\/[^"'\\\s<>]+\.pdf(?:\?[^"'\\\s<>]*)?/gi) ?? [];
  return unique(urls.map((url) => decodeEntities(url)).map((url) => canonicalUrl(url, pageUrl)))
    .map((url) => {
      const label = decodeURIComponent(new URL(url).pathname.split('/').at(-1) ?? 'Documento');
      return { url, label, documentType: documentType(label) };
    });
}

function imageUrls(html: string, $: cheerio.CheerioAPI, pageUrl: string): string[] {
  const rendered = $('img[alt^="Foto"]').map((_, element) => {
    const source = $(element).attr('src')
      ?? $(element).attr('srcset')?.split(/\s*,\s*/).at(-1)?.split(/\s+/)[0] ?? '';
    if (!source) return '';
    const resolved = new URL(decodeEntities(source), pageUrl);
    return resolved.pathname === '/_next/image'
      ? resolved.searchParams.get('url') ?? resolved.toString()
      : resolved.toString();
  }).get();
  const decoded = `${html}\n${decodeNextFlight(html)}`.replace(/\\u0026/g, '&').replace(/\\\//g, '/');
  const originals = decoded.match(
    /https?:\/\/[^"'\\\s<>]+\/Fotos\/[^"'\\\s<>]+\.(?:jpe?g|png|webp)(?:\?[^"'\\\s<>]*)?/gi,
  ) ?? [];
  const optimized = [...decoded.matchAll(/(?:[?&]|&amp;)url=([^&"'\\\s<>]+)/gi)]
    .map((match) => {
      try {
        return decodeURIComponent(decodeEntities(match[1] ?? ''));
      } catch {
        return '';
      }
    });
  return unique([...rendered, ...originals, ...optimized]
    .filter(Boolean)
    .map((url) => canonicalUrl(decodeEntities(url), pageUrl))
    .filter((url) => /\.(?:jpe?g|png|webp)(?:\?|$)/i.test(url))
    .filter((url) => !/fotoNaoEncontrada|sem[-_]?foto|placeholder/i.test(url)));
}

function idsFromUrl(url: string): { event: string; lot: string } {
  const match = /\/leilao\/(\d+)\/lote\/([^/?#]+)/i.exec(new URL(url).pathname);
  if (!match?.[1] || !match[2]) throw new Error(`Invalid Milan lot URL: ${url}`);
  return { event: match[1], lot: match[2].trim() };
}

function eventIdFromUrl(url: string): string | undefined {
  return /\/leilao\/(\d+)/i.exec(new URL(url).pathname)?.[1];
}

function parseLocation(title: string, description: string): {
  city: string; state: string; address: string; neighborhood?: string;
} {
  const location = /^(.+?)\s*[-–]\s*([A-Z]{2})\b/.exec(title);
  const city = plainText(location?.[1] ?? '');
  const state = location?.[2] ?? '';
  const neighborhood = /\bBairro\s+(.+?)(?:\.|,|$)/i.exec(title)?.[1]?.trim();
  const address = description.split(/(?<=\.)\s+/).slice(0, 2).join(' ').trim()
    || [city, state].filter(Boolean).join(' / ');
  return { city, state, address, ...(neighborhood ? { neighborhood } : {}) };
}

function areaValues(value: string): { total?: number; private?: number } {
  const privateArea = firstNumber(value, /(?:área\s+priv(?:ativa)?|área\s+útil)[^0-9]*([\d.,]+)\s*m[²2]/i);
  const total = firstNumber(value, /(?:terr(?:eno)?\.?|área\s+total)[^0-9]*([\d.,]+)\s*m[²2]/i);
  return { ...(total ? { total } : {}), ...(privateArea ? { private: privateArea } : {}) };
}

function isoDates(value: string): Date[] {
  return unique([...value.matchAll(/20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})/g)]
    .map((match) => match[0] ?? '')).map((value) => new Date(value))
    .filter((date) => !Number.isNaN(date.getTime()));
}

function normalizePropertyType(value: string): string {
  const normalized = normalize(value);
  if (/apartamento|apto\b/.test(normalized)) return 'apartamento';
  if (/casa|sobrado|residencia/.test(normalized)) return 'casa';
  if (/terreno|lote\b|urbano/.test(normalized)) return 'terreno';
  if (/loja|sala|conjunto|comercial|predio/.test(normalized)) return 'comercial';
  if (/sitio|fazenda|chacara|rural|gleba/.test(normalized)) return 'rural';
  if (/galpao|barracao/.test(normalized)) return 'galpao';
  return 'outro';
}

function documentType(label: string): string {
  const normalized = normalize(label);
  if (normalized.includes('matricula')) return 'matricula';
  if (normalized.includes('edital') || normalized.includes('condicoes')) return 'edital';
  if (normalized.includes('laudo') || normalized.includes('avaliacao')) return 'laudo';
  return 'outro';
}

function money(value: string): number {
  return firstNumber(value, /R\$\s*([\d.,]+)/i) ?? 0;
}

function firstNumber(text: string, pattern: RegExp): number | undefined {
  const raw = pattern.exec(text)?.[1];
  if (!raw) return undefined;
  const parsed = Number(raw.replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function accessError(surface: string, status: number): Error {
  const suffix = status === 403
    ? ' Configure MILAN_FLARESOLVERR_URL or request an allowlist/API credential from Milan.'
    : '';
  return new Error(`Milan ${surface} failed: HTTP ${status}.${suffix}`);
}

function isCloudflareBlocked(page: MilanPage): boolean {
  return isBlockedStatus(page.status)
    || isCloudflareChallenge(page.html);
}

function isBlockedStatus(status: number): boolean {
  return status === 403 || status === 429 || status === 495 || status === 503;
}

function isCloudflareChallenge(html: string): boolean {
  return /cf-chl-|challenge-platform|just a moment|checking your browser/i.test(html);
}

function isMilanPageComplete(url: string, html: string): boolean {
  const pathname = new URL(url).pathname;
  if (pathname === '/pesquisa/imoveis') {
    return /\/leilao\/\d+\/lote\/[^"'\\<]+/i.test(html);
  }
  if (/\/leilao\/\d+\/lote\//i.test(pathname)) {
    const $ = cheerio.load(html);
    return $('h1').toArray().some((element) => {
      const title = plainText($(element).text());
      return Boolean(title) && !/^Milan Leilões$/i.test(title);
    });
  }
  if (/\/leilao\/\d+\/?$/i.test(pathname)) {
    return /"codLeilao":\d+/i.test(decodeNextFlight(html)) || /dataInicio/i.test(html);
  }
  return html.length > 1_000;
}

function browserHeaders(): Record<string, string> {
  return {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8',
    'User-Agent': 'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  };
}

function canonicalUrl(path: string, base: string): string {
  const url = new URL(decodeEntities(path.trim()), base);
  url.hash = '';
  return url.toString();
}
function decodeEntities(value: string): string {
  return value.replace(/&amp;/g, '&').replace(/\\u0026/g, '&');
}
function plainText(value: string): string {
  return cheerio.load(`<div>${value}</div>`)('div').text().replace(/\s+/g, ' ').trim();
}
function normalize(value: string): string {
  return plainText(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
function normalizeLocation(value: string): string {
  return normalize(value).replace(/[^a-z0-9]+/g, ' ').trim();
}
function unique<T>(values: T[]): T[] { return [...new Set(values)]; }
function sleep(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }

function binaryBuffer(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (Array.isArray(value)) return Buffer.from(value);
  if (typeof value === 'string') return Buffer.from(value, 'base64');
  throw new Error('Milan protected media returned an unsupported body');
}

function responseHeader(headers: Record<string, unknown> | undefined, name: string): string {
  const entry = Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
  if (Array.isArray(entry)) return String(entry[0] ?? '');
  return entry === undefined ? '' : String(entry);
}
