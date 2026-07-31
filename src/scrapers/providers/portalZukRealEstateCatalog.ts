import * as cheerio from 'cheerio';
import { TerminalLotUnavailableError } from '../../errors/terminalLotUnavailableError.js';
import type { LotData } from '../../types/lot.js';
import type { CatalogPage, CatalogProvider } from '../base/catalogProvider.js';

const BASE_URL = 'https://www.portalzuk.com.br';
const CATALOG_URL = `${BASE_URL}/leilao-de-imoveis`;
const PAGE_SIZE = 30;

interface PortalPage {
  url: string;
  html: string;
  status: number;
}

interface FlareResponse {
  status?: string;
  message?: string;
  solution?: {
    url?: string;
    status?: number;
    response?: string;
    userAgent?: string;
    cookies?: Array<{ name?: string; value?: string; domain?: string; expires?: number }>;
  };
}

export class PortalZukClient {
  private readonly sessionName = `auction-monitor-portal-zuk-${process.pid}`;
  private readonly cookies = new Map<string, string>();
  private userAgent = browserHeaders()['User-Agent'] ?? '';
  private csrfToken = '';
  private sessionPromise: Promise<void> | undefined;

  public constructor(
    private readonly flareSolverrUrl?: string,
    private readonly rateLimitBaseMs = 30_000,
  ) {}

  public async get(url: string): Promise<PortalPage> {
    return this.requestDirect('GET', url);
  }

  public async loadMore(input: {
    limit: number;
    ownCount: number;
    partnerDivCount: number;
    order?: string;
  }): Promise<PortalPage> {
    if (!this.csrfToken) await this.refreshCatalogSession();
    const body = new URLSearchParams({
      limit: String(input.limit),
      count_imovel_zuk: String(input.ownCount),
      path: CATALOG_URL,
      bounds: '',
      order: input.order ?? 'data_leilao',
      div_parceiro_count: String(input.partnerDivCount),
      _token: this.csrfToken,
    });
    let page = await this.requestDirect('POST', `${CATALOG_URL}/mais`, body);
    if (page.status === 419) {
      await this.refreshCatalogSession();
      body.set('_token', this.csrfToken);
      page = await this.requestDirect('POST', `${CATALOG_URL}/mais`, body);
    }
    return page;
  }

  private async refreshCatalogSession(): Promise<void> {
    const page = await this.requestDirect('GET', CATALOG_URL);
    if (page.status < 200 || page.status >= 300) {
      throw new Error(`Portal Zuk catalog session failed: HTTP ${page.status}`);
    }
    this.captureCsrf(page.html);
  }

  private async requestDirect(method: 'GET' | 'POST', url: string, body?: URLSearchParams): Promise<PortalPage> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await fetch(url, {
        method,
        headers: {
          ...browserHeaders(),
          'User-Agent': this.userAgent,
          ...(method === 'POST' ? {
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Requested-With': 'XMLHttpRequest',
            Referer: CATALOG_URL,
          } : {}),
          ...(this.cookies.size ? { Cookie: this.cookieHeader() } : {}),
        },
        ...(body ? { body } : {}),
        redirect: 'follow',
        signal: AbortSignal.timeout(60_000),
      });
      this.updateCookies(response);
      const html = await response.text();
      if (response.status === 429) {
        if (attempt === 3) return { url: response.url || url, html, status: response.status };
        await sleep(retryDelay(response.headers.get('retry-after'), this.rateLimitBaseMs, attempt));
        continue;
      }
      if (isCloudflareChallenge(response.status, html) && this.flareSolverrUrl) {
        await this.solveChallenge(url);
        continue;
      }
      if (method === 'GET' && response.ok) this.captureCsrf(html);
      return { url: response.url || url, html, status: response.status };
    }
    return { url, html: '', status: 503 };
  }

  private async solveChallenge(url: string): Promise<void> {
    await (this.sessionPromise ??= this.ensureSession());
    let result = await this.flareCommand({
      cmd: 'request.get',
      url,
      session: this.sessionName,
      session_ttl_minutes: 30,
      maxTimeout: 75_000,
    }) as FlareResponse;
    if (result.status !== 'ok' || !result.solution?.response) {
      this.sessionPromise = undefined;
      await (this.sessionPromise = this.ensureSession());
      result = await this.flareCommand({
        cmd: 'request.get',
        url,
        session: this.sessionName,
        session_ttl_minutes: 30,
        maxTimeout: 75_000,
      }) as FlareResponse;
    }
    if (result.status !== 'ok' || !result.solution?.response) {
      throw new Error(`FlareSolverr failed for Portal Zuk: ${result.message || 'empty response'}`);
    }
    if (result.solution.userAgent) this.userAgent = result.solution.userAgent;
    const now = Date.now() / 1000;
    for (const cookie of result.solution.cookies ?? []) {
      if (!cookie.name || !cookie.value || (cookie.expires && cookie.expires <= now)) continue;
      if (cookie.domain && cookie.domain !== 'portalzuk.com.br' && !cookie.domain.endsWith('.portalzuk.com.br')) continue;
      this.cookies.set(cookie.name, cookie.value);
    }
    this.captureCsrf(result.solution.response);
  }

  private async ensureSession(): Promise<void> {
    const listed = await this.flareCommand({ cmd: 'sessions.list' }) as { sessions?: string[] };
    if (listed.sessions?.includes(this.sessionName)) return;
    const created = await this.flareCommand({
      cmd: 'sessions.create',
      session: this.sessionName,
    }) as FlareResponse;
    if (created.status !== 'ok') {
      throw new Error(`Unable to create Portal Zuk FlareSolverr session: ${created.message || 'unknown error'}`);
    }
  }

  private async flareCommand(payload: Record<string, unknown>): Promise<unknown> {
    const response = await fetch(this.flareSolverrUrl!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(90_000),
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`FlareSolverr HTTP ${response.status}: ${body.slice(0, 300)}`);
    return JSON.parse(body) as unknown;
  }

  private captureCsrf(html: string): void {
    const token = cheerio.load(html)('input[name="_token"]').first().attr('value')?.trim();
    if (token) this.csrfToken = token;
  }

  private updateCookies(response: Response): void {
    const headers = response.headers as Headers & { getSetCookie?: () => string[] };
    const setCookies = headers.getSetCookie?.() ?? (headers.get('set-cookie') ? [headers.get('set-cookie')!] : []);
    for (const value of setCookies) {
      const pair = value.split(';', 1)[0];
      const separator = pair?.indexOf('=') ?? -1;
      if (!pair || separator <= 0) continue;
      this.cookies.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
    }
  }

  private cookieHeader(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  }
}

export class PortalZukRealEstateCatalogProvider implements CatalogProvider {
  public readonly site = 'portalzuk';
  public readonly source = CATALOG_URL;
  private entriesPromise?: Promise<string[]>;

  public constructor(
    private readonly detailIntervalMs = 1_000,
    private readonly pageIntervalMs = 3_000,
    private readonly client = new PortalZukClient(),
  ) {}

  public async scrapePage(page: number): Promise<CatalogPage> {
    const entries = await (this.entriesPromise ??= this.discover());
    const start = (page - 1) * PAGE_SIZE;
    const selected = entries.slice(start, start + PAGE_SIZE);
    const lots = [];
    for (const url of selected) {
      try {
        lots.push({
          url,
          data: await this.scrapeLot(url),
          classification: 'Imóveis',
          assetType: 'real_estate' as const,
        });
      } catch (error) {
        if (!(error instanceof TerminalLotUnavailableError)) throw error;
      }
      await jitterDelay(this.detailIntervalMs);
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
    const page = await this.client.get(url);
    if (page.status === 404 || page.status === 410) {
      throw new TerminalLotUnavailableError(`Portal Zuk lot is no longer available (HTTP ${page.status})`);
    }
    if (page.status < 200 || page.status >= 300) {
      throw new Error(`Portal Zuk lot detail failed: HTTP ${page.status}`);
    }
    return parsePortalZukLot(page.html, canonicalUrl(page.url || url));
  }

  private async discover(): Promise<string[]> {
    const first = await this.client.get(CATALOG_URL);
    if (first.status < 200 || first.status >= 300) {
      throw new Error(`Portal Zuk catalog failed: HTTP ${first.status}`);
    }
    const entries = new Set<string>();
    let totalCards = 0;
    let ownCount = 0;
    let partnerDivCount = 0;
    const expected = catalogCount(first.html);
    let parsed = parseCatalogFragment(first.html);
    for (const url of parsed.ownUrls) entries.add(url);
    totalCards += parsed.cardCount;
    ownCount += parsed.ownCount;
    partnerDivCount += parsed.partnerDivCount;

    while (parsed.cardCount > 0 && totalCards < expected) {
      await jitterDelay(this.pageIntervalMs);
      const next = await this.client.loadMore({ limit: totalCards, ownCount, partnerDivCount });
      if (next.status < 200 || next.status >= 300) {
        throw new Error(`Portal Zuk catalog pagination failed: HTTP ${next.status}`);
      }
      parsed = parseCatalogFragment(next.html);
      for (const url of parsed.ownUrls) entries.add(url);
      totalCards += parsed.cardCount;
      ownCount += parsed.ownCount;
      partnerDivCount += parsed.partnerDivCount;
    }
    if (!entries.size) throw new Error('Portal Zuk catalog returned no own real-estate lot links');
    return [...entries];
  }
}

export function parseCatalogFragment(html: string): {
  ownUrls: string[];
  cardCount: number;
  ownCount: number;
  partnerDivCount: number;
} {
  const $ = cheerio.load(html);
  const cards = $('.card_lotes_div');
  const ownCards = cards.filter((_, element) => ($(element).attr('data-parceiro') ?? '') === '0');
  const ownUrls = unique(ownCards.map((_, element) =>
    canonicalUrl($(element).find('.card-property-image-wrapper a[href*="/imovel/"]').attr('href') ?? '')).get()
    .filter(Boolean));
  return {
    ownUrls,
    cardCount: cards.length,
    ownCount: ownCards.length,
    partnerDivCount: $('#list-items-parceiro-carregar-mais').length,
  };
}

export function parsePortalZukLot(html: string, pageUrl: string): LotData {
  const $ = cheerio.load(html);
  const address = compact($('.property-address').first().text());
  if (!address) throw new TerminalLotUnavailableError('Portal Zuk page no longer contains an active lot');
  const titleMeta = compact($('title').text());
  const propertyType = normalizePropertyType(firstMatch(titleMeta, /^Leilão de (.+?)\s+-/i) ?? $('h1').text());
  const title = `${propertyTypeLabel(propertyType)} - ${address}`;
  const path = new URL(pageUrl).pathname.split('/').filter(Boolean);
  const ids = /\/(\d+)-(\d+)\/?$/.exec(new URL(pageUrl).pathname);
  const eventCode = ids?.[1] ?? '';
  const lotCode = ids?.[2] ?? '';
  const location = parseLocation(address, path);
  const descriptionSection = infoSection($, 'Descrição do imóvel');
  const description = compact(descriptionSection.find('.property-hide-show').first().clone().find('span').remove().end().text());
  const observationsSection = infoSection($, 'Observações');
  const observations = compact(observationsSection.find('.property-hide-show').first().clone().find('span').remove().end().text());
  const registration = compact($('#itens_matricula').first().text())
    || firstMatch(description, /matr[ií]cula\s*(?:n[º°.]*)?\s*([^.;]+)/i) || '';
  const auctionEnd = parseShortBrazilianDate($('.card-action-item-date').first().text())
    ?? parseShortBrazilianDate($('.card-action-header-title').first().text())
    ?? new Date();
  const firstRound = money($('.card-action-item-value').last().text());
  const currentBid = money($('#maior-lance-vlr').first().text());
  const status = saleStatus($('.card-action-header-title').text(), auctionEnd, currentBid);
  const features = featureValues($);
  const documents = $('.property-documents-item[href]').map((_, element) => {
    const url = absoluteUrl($(element).attr('href') ?? '');
    const label = compact($(element).find('.property-documents-item-label').text() || $(element).text());
    if (!url || !/^https?:/i.test(url)) return undefined;
    return { url, label, documentType: documentType(label) };
  }).get().filter((document): document is { url: string; label: string; documentType: string } => Boolean(document));
  const imageUrls = unique($('img[src*="imagens.portalzuk.com.br/detalhe/"]').map((_, element) =>
    absoluteUrl($(element).attr('src') ?? '')).get().filter(Boolean));
  const consignor = $('img[src*="/comitentes/"][alt]').first().attr('alt')?.trim() ?? '';
  const eventUrl = canonicalUrl($('.link_relacao_leilao a[href]').first().attr('href') ?? pageUrl);
  const occupancy = normalize($('.property-status-title').text()).includes('desocupado')
    ? 'desocupado'
    : normalize($('.property-status-title').text()).includes('ocupado') ? 'ocupado' : '';

  return {
    title,
    currentBid,
    nextBid: currentBid || firstRound,
    auctionEnd,
    city: location.city,
    state: location.state,
    address,
    neighborhood: location.neighborhood,
    neighborhoodNormalized: normalizeLocation(location.neighborhood),
    propertyType,
    ...(occupancy ? { occupancyStatus: occupancy } : {}),
    ...(features.total ? { totalAreaM2: features.total } : {}),
    ...(features.private ? { privateAreaM2: features.private } : {}),
    ...(description || observations ? { observations: [description, observations].filter(Boolean).join('\n\n') } : {}),
    ...(firstRound ? { firstRoundMinimumValue: firstRound } : {}),
    lotNumber: lotCode,
    externalCode: lotCode,
    sourceAnnouncementId: lotCode,
    consignor,
    saleStatus: status,
    displayStatus: status,
    classification: 'Imóveis',
    assetType: 'real_estate',
    eventName: `Portal Zuk ${eventCode}`,
    eventExternalCode: eventCode,
    eventUrl,
    imageUrls,
    documents,
    additionalDetails: compactDetails({
      matricula: registration,
      comitente: consignor,
      portalZukEventId: eventCode,
      portalZukLotId: lotCode,
    }),
  };
}

function infoSection($: cheerio.CheerioAPI, title: string) {
  const target = normalize(title);
  return $('.property-info').filter((_, element) =>
    normalize($(element).find('.property-info-title').first().text()) === target).first();
}

function featureValues($: cheerio.CheerioAPI): { total?: number; private?: number } {
  let total: number | undefined;
  let privateArea: number | undefined;
  $('.property-featured-item').each((_, element) => {
    const label = normalize($(element).find('.property-featured-item-label').text());
    const value = decimal($(element).find('.property-featured-item-value').text());
    if (!value) return;
    if (/terreno|total/.test(label)) total = value;
    if (/util|privativa|construida/.test(label)) privateArea = value;
  });
  return { ...(total ? { total } : {}), ...(privateArea ? { private: privateArea } : {}) };
}

function parseLocation(address: string, path: string[]): { city: string; state: string; neighborhood: string } {
  const state = /^[a-z]{2}$/i.test(path[1] ?? '') ? (path[1] ?? '').toUpperCase()
    : /\/\s*([A-Z]{2})\s*$/.exec(address)?.[1] ?? '';
  const city = titleCaseSlug(path[2] ?? '');
  const neighborhood = titleCaseSlug(path[3] ?? '');
  return { city, state, neighborhood };
}

function saleStatus(value: string, auctionEnd: Date, currentBid: number): string {
  const normalized = normalize(value);
  if (/cancelado|suspenso|retirado/.test(normalized)) return 'Retirado';
  if (/encerrado|finalizado/.test(normalized) || auctionEnd.getTime() < Date.now()) {
    return currentBid > 0 ? 'Arrematado' : 'Encerrado';
  }
  return 'Aberto para lances';
}

function catalogCount(html: string): number {
  return integer(firstMatch(html, /var\s+countLotes\s*=\s*["']([\d.]+)["']/i)
    ?? firstMatch(compact(cheerio.load(html)('body').text()), /([\d.]+)\s+resultados oportunidades/i));
}

function retryDelay(retryAfter: string | null, baseMs: number, attempt: number): number {
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1_000;
  return Math.min(300_000, baseMs * 2 ** attempt);
}

function isCloudflareChallenge(status: number, html: string): boolean {
  return (status === 403 || status === 503)
    && /cf-chl-|challenge-platform|just a moment|checking your browser|cloudflare/i.test(html);
}

function browserHeaders(): Record<string, string> {
  return {
    Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
    'Accept-Language': 'pt-BR,pt;q=0.9',
    'User-Agent': 'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
  };
}

function normalizePropertyType(value: string): string {
  const normalized = normalize(value);
  if (/apartamento/.test(normalized)) return 'apartamento';
  if (/casa|sobrado|residencial/.test(normalized)) return 'casa';
  if (/terreno|lote|gleba/.test(normalized)) return 'terreno';
  if (/rural|fazenda|sitio|chacara/.test(normalized)) return 'rural';
  if (/galpao|industrial/.test(normalized)) return 'galpao';
  if (/comercial|loja|sala|predio/.test(normalized)) return 'comercial';
  return 'outro';
}

function propertyTypeLabel(value: string): string {
  return ({ apartamento: 'Apartamento', casa: 'Casa', terreno: 'Terreno', rural: 'Imóvel rural',
    galpao: 'Galpão', comercial: 'Imóvel comercial', outro: 'Imóvel' } as Record<string, string>)[value] ?? 'Imóvel';
}

function documentType(label: string): string {
  const normalized = normalize(label);
  if (normalized.includes('matricula')) return 'matricula';
  if (normalized.includes('laudo') || normalized.includes('avaliacao')) return 'laudo';
  if (normalized.includes('edital')) return 'edital';
  return 'outro';
}

function parseShortBrazilianDate(value: string): Date | undefined {
  const match = /(\d{2})\/(\d{2})\/(\d{2,4})\s+às\s+(\d{2})h(\d{2})/i.exec(compact(value));
  if (!match) return undefined;
  const year = match[3]?.length === 2 ? `20${match[3]}` : match[3];
  const date = new Date(`${year}-${match[2]}-${match[1]}T${match[4]}:${match[5]}:00-03:00`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function money(value: string): number {
  const raw = /(?:R\$\s*)?([\d.]+,\d{2})/.exec(compact(value))?.[1];
  return raw ? decimal(raw) : 0;
}

function decimal(value: string): number {
  const raw = /[\d.,]+/.exec(value)?.[0] ?? '';
  const parsed = Number(raw.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function integer(value: string | undefined): number {
  const parsed = Number((value ?? '').replace(/\D/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function firstMatch(value: string, pattern: RegExp): string | undefined {
  return pattern.exec(value)?.[1]?.trim();
}

function titleCaseSlug(value: string): string {
  return value.split('-').filter(Boolean).map((part) =>
    part.length <= 2 ? part.toLowerCase() : `${part[0]?.toUpperCase()}${part.slice(1)}`).join(' ');
}

function canonicalUrl(value: string): string {
  if (!value) return '';
  const url = new URL(value, `${BASE_URL}/`);
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith('utm_')) url.searchParams.delete(key);
  }
  return url.toString();
}

function absoluteUrl(value: string): string {
  return value ? new URL(value, `${BASE_URL}/`).toString() : '';
}

function compactDetails(values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => Boolean(value)));
}

function normalizeLocation(value: string): string {
  return normalize(value).replace(/[^a-z0-9]+/g, ' ').trim();
}

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalize(value: string): string {
  return compact(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function jitterDelay(baseMs: number): Promise<void> {
  if (baseMs <= 0) return Promise.resolve();
  const jitter = Math.round(baseMs * (0.75 + Math.random() * 0.5));
  return sleep(jitter);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
