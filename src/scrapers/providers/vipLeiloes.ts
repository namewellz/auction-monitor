import * as cheerio from 'cheerio';
import type { AuctionScraper } from '../base/auctionScraper.js';
import type { BidHistoryEntry, LotData } from '../../types/lot.js';
import { parseMoney } from '../../utils/format.js';
import { hostMatches } from '../../utils/url.js';
import { VipLeiloesClient } from './vipLeiloesClient.js';
import { isVipFinalSale, normalizeVipStatus } from './vipLeiloesStatus.js';

interface VipUpdateResponse {
  atualizacao: VipUpdate;
}

interface VipUpdate {
  anuncioId: string;
  eventoId: string;
  eventoSituacao?: string;
  situacao?: string;
  situacaoNome?: string;
  ofertaAtualValor?: number;
  ofertaAtualData?: string;
  ofertaAtualPessoaApelido?: string;
  ofertaAtualQuantidade?: number;
  valorInicial?: number;
  incremento?: number;
  valorOferta1?: number;
  valorCompreJa?: number;
  iniciaOuEncerraEm?: string;
  ofertaAte?: string;
  tipoMonta?: string;
  estado?: { id?: string; nome?: string };
  ultimasOfertas?: VipBid[];
  evento?: { situacao?: string; formaOferta?: string };
}

interface VipBid {
  ordem?: number;
  data?: string;
  valor?: number;
  pessoaApelido?: string;
  tipo?: string;
}

export class VipLeiloesScraper implements AuctionScraper {
  public readonly site = 'vipleiloes';

  public constructor(private readonly client = new VipLeiloesClient()) {}

  public supports(url: string): boolean {
    return hostMatches(url, ['vipleiloes.com.br']) && /\/evento\/anuncio\//i.test(new URL(url).pathname);
  }

  public async scrape(url: string): Promise<LotData> {
    const pageResponse = await this.client.get(url, 'https://www.vipleiloes.com.br/pesquisa');
    if (!pageResponse.ok) throw new Error(`VIP lot page failed with status ${pageResponse.status}.`);
    const html = await pageResponse.text();
    if (/Attention Required!|cf-error-details/i.test(html)) throw new Error('VIP lot page was blocked by Cloudflare.');
    const $ = cheerio.load(html);
    const details = tableDetails($);
    const announcementId = textValue($('#anuncioId').val());
    if (!announcementId) throw new Error('VIP announcement id was not found.');

    const updateResponse = await this.client.getAjax(
      `/evento/atualizacao?anuncioId=${encodeURIComponent(announcementId)}`,
      url,
    );
    if (!updateResponse.ok) throw new Error(`VIP update route failed with status ${updateResponse.status}.`);
    const update = ((await updateResponse.json()) as VipUpdateResponse).atualizacao;
    if (!update) throw new Error('VIP update route returned no announcement data.');

    const title = details.get('veiculo') ?? normalizeText($('h1').first().text());
    const currentBid = update.ofertaAtualValor ?? money(details.get('oferta inicial'));
    const increment = update.incremento ?? 0;
    const nextBid = update.valorOferta1 ?? (currentBid === undefined ? undefined : currentBid + increment);
    const auctionEnd = parseVipDate(update.ofertaAte ?? update.iniciaOuEncerraEm) ?? analyticsEventDate($) ?? new Date();
    if (!title || currentBid === undefined || nextBid === undefined) {
      throw new Error('VIP scraper could not extract required lot fields.');
    }

    const status = normalizeVipStatus(update.situacao);
    const finalSale = isVipFinalSale(update.situacao) && update.ofertaAtualValor !== undefined;
    const address = details.get('localizacao') ?? '';
    const location = parseAddress(address);
    const years = (details.get('ano') ?? '').match(/(\d{4})\s*\/\s*(\d{4})/);
    const plate = (details.get('final da placa') ?? '').match(/(\w)\s*-\s*([A-Z]{2})/i);
    const titleParts = title.split(/\s+-\s+/);
    const number = lotNumber($);
    const externalCode = details.get('codigo');
    const runningAtEntry = yesNo(details.get('funcionando na entrada'));
    const origin = details.get('procedencia');
    const consignor = details.get('comitente');
    const color = details.get('cor');
    const fuel = details.get('combustivel');
    const transmission = details.get('cambio');
    const airConditioning = details.get('ar condicionado');
    const steering = details.get('direcao');
    const keyAvailable = details.get('chave');
    const locks = details.get('trava');
    const windows = details.get('vidro');
    const mileage = integer(details.get('km'));
    const eventUrl = absoluteUrl(textValue($('#urlDisputa').val()), url);
    const eventName = normalizeText($('title').text()).replace(/^VIP Leil(?:õ|o)es\s*-\s*/i, '');
    const imageUrls = uniqueUrls(
      $('img.d-block.w-100.object-fit-contain.borda-suave[src]')
        .map((_, element) => absoluteUrl($(element).attr('src'), url))
        .get(),
    );
    const documentUrls = uniqueUrls(
      sectionByTitle($, 'documentos').find('a[href]')
        .map((_, element) => absoluteUrl($(element).attr('href'), url))
        .get(),
    );
    const videoUrl = $('video source[src],video[src]').map((_, element) => absoluteUrl($(element).attr('src'), url)).get()[0];
    let bidHistory = bidsFromUpdate(update.ultimasOfertas ?? []);
    if (finalSale && (update.ofertaAtualQuantidade ?? 0) > bidHistory.length) {
      bidHistory = await this.fetchBidHistory(announcementId, url).catch(() => bidHistory);
    }

    return {
      title,
      currentBid,
      ...(update.ofertaAtualPessoaApelido ? { bidderAlias: update.ofertaAtualPessoaApelido } : {}),
      nextBid,
      auctionEnd,
      city: location.city,
      state: location.state || update.estado?.id || '',
      address,
      yardName: 'VIP Leiloes',
      ...(sectionText($, 'observacoes') ? { observations: sectionText($, 'observacoes') } : {}),
      ...(number ? { lotNumber: number } : {}),
      ...(externalCode ? { externalCode } : {}),
      sourceAnnouncementId: announcementId,
      ...(runningAtEntry !== undefined ? { runningAtEntry } : {}),
      ...(origin ? { origin } : {}),
      ...(titleParts[0] ? { brand: titleParts[0] } : {}),
      ...(titleParts[1] ? { model: titleParts.slice(1).join(' - ') } : {}),
      ...(years?.[1] ? { manufactureYear: Number(years[1]) } : {}),
      ...(years?.[2] ? { modelYear: Number(years[2]) } : {}),
      ...(mileage ? { mileage } : {}),
      ...(consignor ? { consignor } : {}),
      ...(update.situacao ? { saleStatus: update.situacao } : {}),
      ...(update.situacaoNome ? { displayStatus: update.situacaoNome } : {}),
      salePhase: status.phase,
      ...(status.result ? { saleResult: status.result } : {}),
      ...(update.ofertaAtualQuantidade !== undefined ? { bidCount: update.ofertaAtualQuantidade } : {}),
      ...(color ? { color } : {}),
      ...(fuel ? { fuel } : {}),
      ...(transmission ? { transmission } : {}),
      ...(plate?.[1] ? { plateFinal: plate[1] } : {}),
      ...(plate?.[2] ? { plateState: plate[2].toUpperCase() } : {}),
      ...(airConditioning ? { airConditioning } : {}),
      ...(steering ? { steering } : {}),
      ...(keyAvailable ? { keyAvailable } : {}),
      ...(locks ? { locks } : {}),
      ...(windows ? { windows } : {}),
      ...(finalSale ? { finalBid: update.ofertaAtualValor! } : {}),
      ...(eventName ? { eventName } : {}),
      ...(update.eventoId ? { eventExternalCode: update.eventoId } : {}),
      ...(eventUrl ? { eventUrl } : {}),
      auctionStart: auctionEnd,
      ...(imageUrls.length ? { imageUrls } : {}),
      ...(videoUrl ? { videoUrl } : {}),
      ...(documentUrls.length ? { documentUrls } : {}),
      ...(bidHistory.length ? { bidHistory } : {}),
    };
  }

  private async fetchBidHistory(announcementId: string, referer: string): Promise<BidHistoryEntry[]> {
    const response = await this.client.getAjax(
      `/evento/historicoofertas?anuncioId=${encodeURIComponent(announcementId)}`,
      referer,
    );
    if (!response.ok) return [];
    const $ = cheerio.load(await response.text());
    const result: BidHistoryEntry[] = [];
    $('tbody tr').each((_, row) => {
      const cells = $(row).find('td').map((__, cell) => normalizeText($(cell).text())).get();
      const amount = money(cells[2]);
      const observedAt = parseBrazilianDate(cells[3]);
      if (amount === undefined || !observedAt) return;
      const order = Number(cells[0]);
      result.push({
        sourceKey: `${Number.isFinite(order) ? order : cells[0]}:${observedAt.toISOString()}:${amount}`,
        amount,
        observedAt,
        ...(cells[1] ? { bidderAlias: cells[1] } : {}),
        ...(cells[4] ? { bidType: cells[4] } : {}),
        ...(Number.isFinite(order) ? { sourceOrder: order } : {}),
      });
    });
    return result;
  }
}

type CheerioRoot = cheerio.CheerioAPI;

function tableDetails($: CheerioRoot): Map<string, string> {
  const details = new Map<string, string>();
  $('table tr').each((_, row) => {
    const cells = $(row).find('th,td').map((__, cell) => normalizeText($(cell).text())).get();
    if (cells[0] && cells[1]) details.set(normalizeKey(cells[0]), cells[1]);
  });
  return details;
}

function sectionByTitle($: CheerioRoot, title: string) {
  return $('.offer-section').filter((_, section) =>
    normalizeKey($(section).find('.offer-title').first().text()) === normalizeKey(title),
  ).first();
}

function sectionText($: CheerioRoot, title: string): string {
  return normalizeText(sectionByTitle($, title).find('.offer-text').first().text());
}

function lotNumber($: CheerioRoot): string | undefined {
  for (const input of $('input[value]').toArray()) {
    const value = textValue($(input).attr('value'));
    if (!value?.includes('"view_item"')) continue;
    try {
      const parsed = JSON.parse(value) as { ecommerce?: { items?: Array<{ lote?: string }> } };
      const number = parsed.ecommerce?.items?.[0]?.lote;
      if (number) return String(number);
    } catch {
      // Ignore unrelated hidden values.
    }
  }
  return normalizeText($('body').text()).match(/\bLote:\s*(\d+)\b/i)?.[1];
}

function analyticsEventDate($: CheerioRoot): Date | undefined {
  for (const input of $('input[value]').toArray()) {
    const value = textValue($(input).attr('value'));
    if (!value?.includes('"view_item"')) continue;
    try {
      const parsed = JSON.parse(value) as { ecommerce?: { items?: Array<{ data_inicio?: string }> } };
      const date = parsed.ecommerce?.items?.[0]?.data_inicio;
      if (date) return parseBrazilianDate(date);
    } catch {
      // Ignore unrelated hidden values.
    }
  }
  return undefined;
}

function bidsFromUpdate(bids: VipBid[]): BidHistoryEntry[] {
  return bids.flatMap((bid) => {
    const observedAt = parseVipDate(bid.data);
    if (bid.valor === undefined || !observedAt) return [];
    return [{
      sourceKey: `${bid.ordem ?? 'unknown'}:${observedAt.toISOString()}:${bid.valor}`,
      amount: bid.valor,
      observedAt,
      ...(bid.pessoaApelido ? { bidderAlias: bid.pessoaApelido } : {}),
      ...(bid.tipo ? { bidType: bid.tipo } : {}),
      ...(bid.ordem !== undefined ? { sourceOrder: bid.ordem } : {}),
    }];
  });
}

function parseAddress(address: string): { city: string; state: string } {
  const match = address.match(/,\s*([^,]+),\s*([A-Z]{2})\s*-\s*CEP:/i);
  return { city: match?.[1]?.trim() ?? '', state: match?.[2]?.toUpperCase() ?? '' };
}

function parseVipDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
  const parsed = new Date(hasZone ? value : `${value}-03:00`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function parseBrazilianDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const match = value.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?(?:\s*([+-]\d{2}:?\d{2}))?/);
  if (!match) return undefined;
  const [, day, month, year, hour, minute, second = '00', zone = '-03:00'] = match;
  const normalizedZone = zone.includes(':') ? zone : `${zone.slice(0, 3)}:${zone.slice(3)}`;
  const parsed = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}${normalizedZone}`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function normalizeKey(value: string): string {
  return normalizeText(value).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function textValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function money(value: string | undefined): number | undefined {
  return value ? parseMoney(value) : undefined;
}

function integer(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value.replace(/\D/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function yesNo(value: string | undefined): boolean | undefined {
  const normalized = normalizeKey(value ?? '');
  if (normalized.startsWith('sim')) return true;
  if (normalized.startsWith('nao')) return false;
  return undefined;
}

function absoluteUrl(value: string | undefined, base: string): string {
  if (!value) return '';
  try { return new URL(value, base).toString(); } catch { return ''; }
}

function uniqueUrls(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
