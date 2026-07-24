import * as cheerio from 'cheerio';
import type { CatalogPage, CatalogProvider } from '../base/catalogProvider.js';
import type { LotData } from '../../types/lot.js';

const BASE_URL = 'https://www.calilleiloes.com.br';
const SOURCE_URL = `${BASE_URL}/lotes/imovel`;

export class CalilRealEstateCatalogProvider implements CatalogProvider {
  public readonly site = 'calilleiloes';
  public readonly source = SOURCE_URL;

  public constructor(private readonly requestIntervalMs = 750) {}

  public async scrapePage(page: number): Promise<CatalogPage> {
    const url = `${SOURCE_URL}?tipo=imovel&page=${page}`;
    const response = await fetch(url, { headers: headers(), signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Calil catalog failed: HTTP ${response.status}`);
    const $ = cheerio.load(await response.text());
    const total = numberFromText($('body').text(), /Total\s+(\d+)\s+Lotes/i) ?? 0;
    const detailUrls = unique($('.lote a[href*="/item/"][href*="/detalhes"]')
      .map((_, element) => absolute($(element).attr('href') ?? '')).get());
    const lots = [];
    for (const detailUrl of detailUrls) {
      const data = await this.scrapeLot(detailUrl);
      lots.push({ url: detailUrl, data, classification: 'Imóveis', assetType: 'real_estate' as const });
      if (this.requestIntervalMs > 0) await sleep(this.requestIntervalMs);
    }
    const pageSize = Math.max(detailUrls.length, 1);
    const hasNext = $('a[rel="next"]').length > 0;
    return { page, pageSize, total, hasNext, lots };
  }

  public async scrapeLot(url: string): Promise<LotData> {
    const response = await fetch(url, { headers: headers(), signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Calil lot detail failed: HTTP ${response.status}`);
    const $ = cheerio.load(await response.text());
    const text = compact($('body').text());
    const id = /\/item\/(\d+)/.exec(url)?.[1] ?? url;
    const ogTitle = $('meta[property="og:title"]').attr('content') ?? '';
    const title = compact(ogTitle.replace(/\s+-\s+(?:Lance Inicial|Maior Lance):.*$/i, ''))
      || compact($('h1').eq(1).text()) || `Imóvel ${id}`;
    const status = firstMatch(text, /(Aberto para Lances|Aguarde Abertura|Em Breve|Proposta|Encerrado|Arrematado)/i) ?? '';
    const cityState = /Cidade:\s*([^/]+?)\s*\/\s*([A-Z]{2})\b/i.exec(text);
    const address = firstMatch(text, /Endereço:\s*(.+?)(?=\s+Matrícula:|\s+Descrição:|\s+CEP:)/i) ?? '';
    const registration = firstMatch(text, /Matrícula:\s*(.+?)(?=\s+Descrição:|\s+Processo:|\s+Condições)/i) ?? '';
    const description = firstMatch(text, /Descrição:\s*(.+?)(?=\s+Condições de Pagamento|\s+Considerações Importantes|\s+Compartilhar:)/i) ?? '';
    const explicitEnd = firstMatch(text, /Encerramento:\s*(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2})/i);
    const firstRoundDate = firstMatch(text, /Data\s+1[ªº°]?\s*Leilão:\s*(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2})/i);
    const secondRoundDate = firstMatch(text, /Data\s+2[ªº°]?\s*Leilão:\s*(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2})/i);
    const thirdRoundDate = firstMatch(text, /Data\s+3[ªº°]?\s*Leilão:\s*(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2})/i);
    const initial = money(firstMatch(text, /LANCE INICIAL\s*R\$\s*([\d.,]+)/i));
    const current = money(firstMatch(text, /MAIOR LANCE\s*R\$\s*([\d.,]+)/i));
    const firstRound = roundValue(text, 1) || initial;
    const second = roundValue(text, 2) || money(firstMatch(text, /Lance Inicial\s*2[ªº°]?\s*Leilão:\s*R\$\s*([\d.,]+)/i));
    const third = roundValue(text, 3) || money(firstMatch(text, /Lance Inicial\s*3[ªº°]?\s*Leilão:\s*R\$\s*([\d.,]+)/i));
    const lotNumber = firstMatch(text, /LOTE\s+(\d+)/i) ?? '';
    const consignor = firstMatch(text, /Comitente:\s*(.+?)(?=\s+Cidade:)/i) ?? '';
    const area = numberFromText(description, /([\d.,]+)\s*(?:M²|m2|m²|Ha)\s+de área (?:total|privativa|de terreno)/i);
    const documents = $('.arquivos-lote a[href]').map((_, element) => {
      const label = compact($(element).text()) || 'Documento';
      return { url: absolute($(element).attr('href') ?? ''), label, documentType: documentType(label) };
    }).get().filter((document) => Boolean(document.url));
    const imageUrls = unique($('#carouselImgsLoteGrande a[href]').map((_, element) =>
      absolute($(element).attr('href') ?? '')).get().filter((image) => /\.(?:jpe?g|png|webp)(?:\?|$)/i.test(image)));
    const propertyType = normalizePropertyType(`${title} ${description}`);
    return {
      title,
      currentBid: current,
      nextBid: current || initial,
      auctionEnd: parseBrazilianDate(explicitEnd ?? thirdRoundDate ?? secondRoundDate ?? firstRoundDate) ?? new Date(),
      city: compact(cityState?.[1] ?? ''),
      state: cityState?.[2]?.toUpperCase() ?? '',
      address,
      propertyType,
      ...(description ? { observations: description } : {}),
      ...(area ? { totalAreaM2: area } : {}),
      ...(firstRound ? { firstRoundMinimumValue: firstRound } : {}),
      ...(second ? { secondRoundMinimumValue: second } : {}),
      ...(third ? { thirdRoundMinimumValue: third } : {}),
      lotNumber,
      externalCode: id,
      sourceAnnouncementId: id,
      consignor,
      saleStatus: status,
      displayStatus: status,
      classification: 'Imóveis',
      assetType: 'real_estate',
      eventName: title,
      eventExternalCode: id,
      eventUrl: url,
      imageUrls,
      documents,
      additionalDetails: {
        leiloeiro: 'Julio Abdo Costa Calil',
        registroLeiloeiro: 'JUCESP 813',
        matricula: registration,
      },
    };
  }
}

function headers(): Record<string, string> {
  return { Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'pt-BR,pt;q=0.9', 'User-Agent': 'Mozilla/5.0 (compatible; AuctionMonitor/1.0)' };
}
function absolute(path: string): string { return path ? new URL(path, `${BASE_URL}/`).toString() : ''; }
function compact(value: string): string { return value.replace(/\s+/g, ' ').trim(); }
function firstMatch(value: string, pattern: RegExp): string | undefined { return pattern.exec(value)?.[1]?.trim(); }
function unique(values: string[]): string[] { return [...new Set(values)]; }
function sleep(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }
function money(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Number(value.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}
function roundValue(value: string, round: number): number {
  const pattern = new RegExp(`Data\\s+${round}[ªº°]?\\s*Leilão:.*?Lance Inicial:\\s*R\\$\\s*([\\d.,]+)`, 'i');
  return money(firstMatch(value, pattern));
}
function numberFromText(value: string, pattern: RegExp): number | undefined {
  const raw = pattern.exec(value)?.[1];
  if (!raw) return undefined;
  const parsed = Number(raw.replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : undefined;
}
function parseBrazilianDate(value: string | undefined): Date | undefined {
  const match = value && /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})$/.exec(value);
  if (!match) return undefined;
  const date = new Date(`${match[3]}-${match[2]}-${match[1]}T${match[4]}:${match[5]}:00-03:00`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
function normalize(value: string): string { return compact(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
function normalizePropertyType(value: string): string {
  const normalized = normalize(value);
  if (/apartamento|apto\b/.test(normalized)) return 'apartamento';
  if (/casa|sobrado|residencia/.test(normalized)) return 'casa';
  if (/galpao|barracao/.test(normalized)) return 'galpao';
  if (/terreno|lote\b|gleba|urbano/.test(normalized)) return 'terreno';
  if (/loja|sala|predio|comercial|industrial|negocio/.test(normalized)) return 'comercial';
  if (/sitio|fazenda|chacara|rural/.test(normalized)) return 'rural';
  return 'outro';
}
function documentType(label: string): string {
  const normalized = normalize(label);
  if (normalized.includes('matricula')) return 'matricula';
  if (normalized.includes('edital')) return 'edital';
  if (normalized.includes('avaliacao') || normalized.includes('laudo')) return 'laudo';
  return 'outro';
}
