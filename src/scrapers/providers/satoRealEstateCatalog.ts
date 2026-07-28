import * as cheerio from 'cheerio';
import type { CatalogPage, CatalogProvider } from '../base/catalogProvider.js';
import type { LotData } from '../../types/lot.js';
import { TerminalLotUnavailableError } from '../../errors/terminalLotUnavailableError.js';

const BASE_URL = 'https://satoleiloes.com.br';
const API_URL = `${BASE_URL}/api-publica/stale/dados-home-lotes`;
const PAGE_SIZE = 15;

type JsonObject = Record<string, unknown>;

export class SatoRealEstateCatalogProvider implements CatalogProvider {
  public readonly site = 'satoleiloes';
  public readonly source = BASE_URL;
  private entriesPromise?: Promise<JsonObject[]>;

  public constructor(private readonly requestIntervalMs = 750) {}

  public async scrapePage(page: number): Promise<CatalogPage> {
    const entries = await (this.entriesPromise ??= this.discover());
    const start = (page - 1) * PAGE_SIZE;
    const selected = entries.slice(start, start + PAGE_SIZE);
    const lots = [];
    for (const entry of selected) {
      const url = lotUrl(entry);
      const detail = await fetchDetail(url);
      lots.push({
        url,
        data: mapLot(detail ?? entry),
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
    const detail = await fetchDetail(url);
    if (!detail || !detail.id_vistoria_imobiliaria) {
      throw new TerminalLotUnavailableError('Sato real-estate lot is no longer available');
    }
    return mapLot(detail);
  }

  private async discover(): Promise<JsonObject[]> {
    const entries: JsonObject[] = [];
    for (let page = 1; page <= 100; page += 1) {
      const response = await fetch(`${API_URL}?page=${page}&type=leilao`, {
        headers: requestHeaders('application/json'),
        signal: AbortSignal.timeout(45_000),
      });
      if (!response.ok) throw new Error(`Sato catalog API failed: HTTP ${response.status}`);
      const batch = await response.json() as JsonObject[];
      if (!batch.length) break;
      entries.push(...batch.filter((entry) => Boolean(entry.id_vistoria_imobiliaria)));
      if (this.requestIntervalMs > 0) await sleep(this.requestIntervalMs);
    }
    return entries;
  }
}

async function fetchDetail(url: string): Promise<JsonObject | undefined> {
  const response = await fetch(url, {
    headers: requestHeaders('text/html,application/xhtml+xml'),
    signal: AbortSignal.timeout(45_000),
  });
  if (response.status === 404 || response.status === 410) return undefined;
  if (!response.ok) throw new Error(`Sato lot page failed: HTTP ${response.status}`);
  const $ = cheerio.load(await response.text());
  const page = $('#app').attr('data-page');
  if (!page) return undefined;
  const payload = JSON.parse(page) as { props?: { loteInit?: JsonObject } };
  return payload.props?.loteInit;
}

function mapLot(lot: JsonObject): LotData {
  const event = object(lot.leilao);
  const status = object(lot.status_lote);
  const inspection = object(lot.vistoria_imobiliaria);
  const title = text(lot.titulo);
  const description = plainText(text(lot.descricao) || text(event.descricao_do_pagamento));
  const location = parseLocation(title, description);
  const firstValue = number(lot.lance_inicial);
  const secondValue = number(lot.lance_inicial_segundo_leilao);
  const currentBid = number(object(lot.lanceAtual).valor ?? lot.lanceAtual);
  const end = date(lot.datahora_pregao_segundo_leilao)
    ?? date(lot.datahora_pregao)
    ?? date(event.data_hora_inicio_segundo_leilao)
    ?? date(event.data_hora_inicio)
    ?? new Date();
  const documents = [
    ...array(lot.documentos_lote),
    ...array(event.arquivos_do_leilao),
  ].map(documentFromMedia).filter(isDocument);

  return {
    title,
    currentBid,
    nextBid: number(lot.proximoLance) || currentBid || secondValue || firstValue,
    auctionEnd: end,
    city: location.city,
    state: location.state,
    address: location.address,
    ...(description ? { observations: description } : {}),
    propertyType: propertyType(`${title} ${description}`),
    ...(text(inspection.desocupado) === '1' ? { occupancyStatus: 'desocupado' } : {}),
    ...(firstValue ? { firstRoundMinimumValue: firstValue } : {}),
    ...(secondValue ? { secondRoundMinimumValue: secondValue } : {}),
    lotNumber: text(lot.sequencia),
    externalCode: text(lot.id),
    sourceAnnouncementId: text(lot.id),
    saleStatus: text(status.identificador) || text(status.nome) || text(object(lot.proximoStatus).texto),
    displayStatus: text(status.texto_site) || text(status.nome) || text(object(lot.proximoStatus).texto),
    classification: 'Imóveis',
    assetType: 'real_estate',
    eventName: plainText(text(event.titulo)),
    eventExternalCode: text(lot.id_leilao),
    eventUrl: `${BASE_URL}/leiloes/${text(lot.id_leilao)}`,
    imageUrls: array(lot.imagens_lote).map(imageFromMedia).filter(Boolean),
    documents,
    additionalDetails: {
      leiloeiro: plainText(text(object(event.leiloeiro).nome) || 'Tatiana Hisa Sato'),
      comitente: plainText(text(object(event.comitente).nome)),
    },
  };
}

function lotUrl(lot: JsonObject): string {
  return `${BASE_URL}/leiloes/${text(lot.id_leilao)}/lotes/${text(lot.id)}`;
}
function imageFromMedia(value: unknown): string {
  const file = object(object(value).arquivo);
  const urls = object(file.leilaoAbertoUrl);
  return text(urls.x4) || text(urls.x2) || text(file.signedUrl);
}
function documentFromMedia(value: unknown): { url: string; label?: string; documentType?: string } | undefined {
  const item = object(value);
  const file = object(item.arquivo);
  const url = text(file.signedUrl);
  if (!url) return undefined;
  const label = plainText(text(item.titulo) || text(item.nome) || text(file.nome) || 'Documento');
  return { url, label, documentType: documentType(label) };
}
function isDocument(value: ReturnType<typeof documentFromMedia>): value is NonNullable<typeof value> {
  return Boolean(value);
}
function parseLocation(title: string, description: string): { city: string; state: string; address: string } {
  const match = /(?:\||[-–])\s*([^|–-]+?)\/([A-Z]{2})\b/i.exec(title)
    ?? /\b([^,.;]+?)\/([A-Z]{2})\b/i.exec(title);
  const city = plainText(match?.[1] ?? '');
  const state = (match?.[2] ?? '').toUpperCase();
  const address = /(?:localiza(?:do)?|situad[oa])\s+(?:à|na|no)?\s*([^.;]+)/i.exec(description)?.[1]?.trim()
    ?? [city, state].filter(Boolean).join(' / ');
  return { city, state, address };
}
function propertyType(value: string): string {
  const normalized = normalize(value);
  if (/apartamento|apto/.test(normalized)) return 'apartamento';
  if (/casa|sobrado|residencia/.test(normalized)) return 'casa';
  if (/terreno|lote|gleba/.test(normalized)) return 'terreno';
  if (/fazenda|sitio|chacara|rural/.test(normalized)) return 'rural';
  if (/galpao|barracao/.test(normalized)) return 'galpao';
  if (/comercial|loja|sala|predio/.test(normalized)) return 'comercial';
  return 'outro';
}
function documentType(value: string): string {
  const normalized = normalize(value);
  if (normalized.includes('matricula')) return 'matricula';
  if (normalized.includes('edital')) return 'edital';
  if (normalized.includes('laudo') || normalized.includes('avaliacao')) return 'laudo';
  return 'outro';
}
function requestHeaders(accept: string): Record<string, string> {
  return { accept, 'user-agent': 'Mozilla/5.0 (compatible; AuctionMonitor/1.0)' };
}
function date(value: unknown): Date | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  const parsed = new Date(raw.includes('T') ? raw : `${raw.replace(' ', 'T')}-03:00`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}
function number(value: unknown): number {
  const parsed = Number(typeof value === 'string' ? value.replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.') : value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
function object(value: unknown): JsonObject { return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}; }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function text(value: unknown): string { return value === undefined || value === null ? '' : String(value).trim(); }
function plainText(value: string): string { return cheerio.load(`<div>${value}</div>`)('div').text().replace(/\s+/g, ' ').trim(); }
function normalize(value: string): string { return plainText(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
function sleep(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }
