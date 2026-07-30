import * as cheerio from 'cheerio';
import { TerminalLotUnavailableError } from '../../errors/terminalLotUnavailableError.js';
import type { LotData } from '../../types/lot.js';
import type { CatalogPage, CatalogProvider } from '../base/catalogProvider.js';

const BASE_URL = 'https://www.megaleiloes.com.br';
const CATALOG_URL = `${BASE_URL}/imoveis`;
const PAGE_SIZE = 48;

export class MegaRealEstateCatalogProvider implements CatalogProvider {
  public readonly site = 'megaleiloes';
  public readonly source = CATALOG_URL;

  public constructor(private readonly requestIntervalMs = 750) {}

  public async scrapePage(page: number): Promise<CatalogPage> {
    const url = page > 1 ? `${CATALOG_URL}?pagina=${page}` : CATALOG_URL;
    const response = await request(url);
    if (!response.ok) throw new Error(`Mega Leilões catalog failed: HTTP ${response.status}`);
    const $ = cheerio.load(await response.text());
    const bodyText = compact($('body').text());
    const total = integer(firstMatch(bodyText, /Exibindo\s+\d+\s*-\s*\d+\s+de\s+([\d.]+)\s+itens/i));
    const detailUrls = unique($('.card a.card-title[href]').map((_, element) =>
      canonicalUrl($(element).attr('href') ?? '')).get().filter(Boolean));
    if (!detailUrls.length && total > 0) {
      throw new Error(`Mega Leilões catalog page ${page} returned no lot links`);
    }

    const lots = [];
    for (const detailUrl of detailUrls) {
      try {
        lots.push({
          url: detailUrl,
          data: await this.scrapeLot(detailUrl),
          classification: 'Imóveis',
          assetType: 'real_estate' as const,
        });
      } catch (error) {
        if (!(error instanceof TerminalLotUnavailableError)) throw error;
      }
      if (this.requestIntervalMs > 0) await sleep(this.requestIntervalMs);
    }

    return {
      page,
      pageSize: PAGE_SIZE,
      total,
      hasNext: page * PAGE_SIZE < total,
      lots,
    };
  }

  public async scrapeLot(url: string): Promise<LotData> {
    const response = await request(url);
    if (response.status === 404 || response.status === 410) {
      throw new TerminalLotUnavailableError(`Mega Leilões lot is no longer available (HTTP ${response.status})`);
    }
    if (!response.ok) throw new Error(`Mega Leilões lot detail failed: HTTP ${response.status}`);
    return parseMegaLot(await response.text(), canonicalUrl(response.url || url));
  }
}

export function parseMegaLot(html: string, pageUrl: string): LotData {
  const $ = cheerio.load(html);
  const title = compact($('h1.section-header').first().text());
  if (!title) throw new TerminalLotUnavailableError('Mega Leilões page no longer contains an active lot');

  const code = labeledValue($, '.auction-id', 'Código Lote')
    || /-([JXV]\d+)$/i.exec(new URL(pageUrl).pathname)?.[1] || '';
  const lotNumberLabel = labeledValue($, '.auction-id', 'Número Lote');
  const lotNumber = firstMatch(lotNumberLabel, /(\d+)/) ?? (lotNumberLabel || code);
  const eventCode = labeledValue($, '.auction-id', 'Leilão');
  const eventUrl = canonicalUrl($('.auction-id').filter((_, element) =>
    normalize($(element).find('.header').first().text()) === 'leilao').find('.value a[href]').attr('href')
      ?? (eventCode ? `${BASE_URL}/${eventCode}` : pageUrl));
  const address = labeledValue($, '.main-info .item', 'Localização');
  const breadcrumb = $('.breadcrumb [itemprop="name"]').map((_, element) => compact($(element).text())).get();
  const city = breadcrumb.at(-1) ?? cityFromAddress(address);
  const path = new URL(pageUrl).pathname.split('/').filter(Boolean);
  const state = /^[a-z]{2}$/i.test(path[2] ?? '') ? (path[2] ?? '').toUpperCase() : stateFromAddress(address);
  const description = compact($('#tab-description').text());
  const status = compact($('.instance-text').first().text()) || 'Aberto para lances';
  const bidCount = integer($('.bids-count .value').first().text());
  const currentBid = money($('.last-bid .value').first().text());
  const displayedMinimum = money($('.batch-price .value, .price .value').first().text())
    || money($('.main-sidebar .wrap').filter((_, element) =>
      normalize($(element).find('.header').text()) === 'valor inicial').find('.value').text());
  const instances = $('.summary-info .instance').map((_, element) => {
    const text = compact($(element).text());
    return {
      active: $(element).hasClass('active'),
      date: brazilianDates(text).at(-1),
      value: money(text),
    };
  }).get();
  const activeInstance = instances.find((instance) => instance.active) ?? instances.at(-1);
  const imageUrls = unique($('img[alt^="Foto"][src]').map((_, element) =>
    largerImage($(element).attr('src') ?? '')).get().filter(Boolean));
  const documents = $('a[href]').map((_, element) => {
    const label = compact($(element).text());
    if (!/^(edital|laudo(?: de avaliação)?|matr[ií]cula)$/i.test(label)) return undefined;
    const documentUrl = absoluteUrl($(element).attr('href') ?? '');
    if (!documentUrl) return undefined;
    return { url: documentUrl, label, documentType: documentType(label) };
  }).get().filter((document): document is { url: string; label: string; documentType: string } => Boolean(document));
  const leiloeiro = labeledValue($, '.main-info .item', 'Leiloeiro');
  const process = labeledValue($, '.main-info .item', 'Processo');
  const court = labeledValue($, '.main-info .item', 'Vara');
  const consignor = labeledValue($, '.main-info .item', 'Autor');
  const defendant = labeledValue($, '.main-info .item', 'Réu');
  const appraisal = labeledValue($, '.main-info .item', 'Valor de Avaliação');
  const fullText = `${title} ${description}`;
  const area = areaValues(fullText);
  const type = auctionType($);

  return {
    title,
    currentBid,
    nextBid: currentBid || activeInstance?.value || displayedMinimum,
    auctionEnd: activeInstance?.date ?? instances.at(-1)?.date ?? new Date(),
    city,
    state,
    address,
    propertyType: normalizePropertyType(path[1] ?? title),
    ...(occupancyStatus($('body').text()) ? { occupancyStatus: occupancyStatus($('body').text()) } : {}),
    ...(area.total ? { totalAreaM2: area.total } : {}),
    ...(area.private ? { privateAreaM2: area.private } : {}),
    ...(description ? { observations: description } : {}),
    ...(instances[0]?.value ? { firstRoundMinimumValue: instances[0].value } : {}),
    ...(instances[1]?.value ? { secondRoundMinimumValue: instances[1].value } : {}),
    ...(instances[2]?.value ? { thirdRoundMinimumValue: instances[2].value } : {}),
    lotNumber,
    externalCode: code,
    sourceAnnouncementId: code,
    consignor,
    saleStatus: status,
    displayStatus: status,
    classification: 'Imóveis',
    assetType: 'real_estate',
    origin: type,
    bidCount,
    eventName: eventCode ? `Leilão ${eventCode}` : 'Mega Leilões',
    eventExternalCode: eventCode,
    eventUrl,
    imageUrls,
    documents,
    additionalDetails: compactDetails({
      leiloeiro,
      processo: process,
      vara: court,
      reu: defendant,
      avaliacao: appraisal,
      modalidade: type,
    }),
  };
}

function labeledValue($: cheerio.CheerioAPI, selector: string, label: string): string {
  const normalizedLabel = normalize(label);
  const container = $(selector).filter((_, element) =>
    normalize($(element).find('.header').first().text()) === normalizedLabel).first();
  return compact(container.find('.value').first().text());
}

function auctionType($: cheerio.CheerioAPI): string {
  const type = normalize($('.batch-type').first().text());
  if (type.includes('extrajudicial')) return 'Extrajudicial';
  if (type.includes('judicial')) return 'Judicial';
  return '';
}

function areaValues(value: string): { total?: number; private?: number } {
  const privateArea = firstNumber(value, /([\d.,]+)\s*m[²2]\s+de\s+área\s+(?:útil|privativa)/i)
    ?? firstNumber(value, /área\s+(?:útil|privativa)[^0-9]*([\d.,]+)\s*m[²2]/i);
  const total = firstNumber(value, /([\d.,]+)\s*m[²2]\s+de\s+área\s+total/i)
    ?? firstNumber(value, /área\s+total[^0-9]*([\d.,]+)\s*m[²2]/i);
  return { ...(total ? { total } : {}), ...(privateArea ? { private: privateArea } : {}) };
}

function normalizePropertyType(value: string): string {
  const normalized = normalize(value);
  if (/apartamento/.test(normalized)) return 'apartamento';
  if (/casa|sobrado/.test(normalized)) return 'casa';
  if (/terreno|lote|gleba|incorporac/.test(normalized)) return 'terreno';
  if (/galpao|industrial|deposito/.test(normalized)) return 'galpao';
  if (/comercial|loja|sala|hospital|hotel|resort/.test(normalized)) return 'comercial';
  if (/rural|fazenda|sitio|chacara/.test(normalized)) return 'rural';
  if (/garagem/.test(normalized)) return 'garagem';
  return 'outro';
}

function occupancyStatus(value: string): string {
  const normalized = normalize(value);
  if (normalized.includes('imovel desocupado')) return 'desocupado';
  if (normalized.includes('imovel ocupado')) return 'ocupado';
  return '';
}

function documentType(label: string): string {
  const normalized = normalize(label);
  if (normalized.includes('matricula')) return 'matricula';
  if (normalized.includes('edital')) return 'edital';
  if (normalized.includes('laudo') || normalized.includes('avaliacao')) return 'laudo';
  return 'outro';
}

function compactDetails(values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => Boolean(value)));
}

function largerImage(url: string): string {
  return absoluteUrl(url).replace(/_\d+x\d+(?=\.[a-z]+(?:\?|$))/i, '_1024x768');
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

function cityFromAddress(value: string): string {
  return value.split(',').at(-2)?.trim() ?? '';
}

function stateFromAddress(value: string): string {
  return /\b([A-Z]{2})\s*$/.exec(value)?.[1] ?? '';
}

function request(url: string): Promise<Response> {
  return fetch(url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'pt-BR,pt;q=0.9',
      'User-Agent': 'Mozilla/5.0 (compatible; AuctionMonitor/1.0)',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(45_000),
  });
}

function parseBrazilianDate(value: string | undefined): Date | undefined {
  const match = value && /^(\d{2})\/(\d{2})\/(\d{4})\s+às\s+(\d{2}):(\d{2})$/i.exec(value);
  if (!match) return undefined;
  const date = new Date(`${match[3]}-${match[2]}-${match[1]}T${match[4]}:${match[5]}:00-03:00`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function brazilianDates(value: string): Date[] {
  return [...value.matchAll(/\d{2}\/\d{2}\/\d{4}\s+às\s+\d{2}:\d{2}/gi)]
    .map((match) => parseBrazilianDate(match[0]))
    .filter((date): date is Date => Boolean(date));
}

function money(value: string): number {
  const raw = /R\$\s*([\d.,]+)/i.exec(value)?.[1];
  if (!raw) return 0;
  const parsed = Number(raw.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function firstNumber(value: string, pattern: RegExp): number | undefined {
  const raw = pattern.exec(value)?.[1];
  if (!raw) return undefined;
  const parsed = Number(raw.replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function integer(value: string | undefined): number {
  const parsed = Number((value ?? '').replace(/\D/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function firstMatch(value: string, pattern: RegExp): string | undefined {
  return pattern.exec(value)?.[1]?.trim();
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
