import * as cheerio from 'cheerio';
import type { CatalogPage, CatalogProvider } from '../base/catalogProvider.js';
import type { LotData } from '../../types/lot.js';

const API_URL = 'https://offer-query.superbid.net/seo/offers/';
const CATEGORY_URL = 'https://www.superbid.net/categorias/carros-motos';

interface SuperbidOffer {
  id: number; lotNumber?: number; endDateTime?: number; endDate?: string; price?: number;
  statusId?: number; totalBids?: number; offerStatus?: Record<string, boolean>;
  stores?: Array<{ name?: string }>;
  offerDetail?: { currentMinBid?: number; initialBidValue?: number };
  currentBidIncrement?: { currentBidIncrement?: number };
  auction?: { id?: number; desc?: string; beginDate?: string };
  groupOffer?: { commissionPercent?: number };
  offerDescription?: { offerDescription?: string };
  product?: {
    shortDesc?: string; detailedDescription?: string; photoCount?: number; productYourRef?: string;
    productCustomJson?: string;
    brand?: { description?: string }; model?: { description?: string };
    subCategory?: { description?: string; category?: { description?: string } };
    galleryJson?: Array<{ link?: string; type?: string; contentType?: string }>;
    location?: { city?: string; state?: string; locationGeo?: { lat?: number; lon?: number } };
    template?: { groups?: Array<{ properties?: Array<{ id?: string; title?: string; value?: string }> }> };
  };
  seller?: { name?: string };
}
interface ApiResponse { total: number; start: number; limit: number; offers: SuperbidOffer[] }

export class SuperbidCatalogProvider implements CatalogProvider {
  public readonly site = 'superbid';
  public readonly source = CATEGORY_URL;

  public constructor(
    private readonly pageSize = 100,
    private readonly requestIntervalMs = 750,
    private readonly maxRawOffers = 0,
  ) {}

  public async scrapePage(page: number): Promise<CatalogPage> {
    if (page > 1) await sleep(this.requestIntervalMs);
    const params = new URLSearchParams({
      locale: 'pt_BR', portalId: '[2,15]', requestOrigin: 'marketplace', timeZoneId: 'UTC',
      preOrderBy: 'orderByFirstOpenedOffersAndSecondHasPhoto', filter: '', orderBy: 'score:desc',
      pageNumber: String(page), pageSize: String(this.pageSize), searchType: 'opened', urlSeo: CATEGORY_URL,
    });
    const response = await fetch(`${API_URL}?${params}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; AuctionMonitor/1.0)' },
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`Superbid catalog failed: HTTP ${response.status}`);
    const payload = await response.json() as ApiResponse;
    const offers = (payload.offers ?? []).filter(isCarOffer);
    const lots = offers.map((offer) => {
      const url = offerUrl(offer);
      return { url, data: mapOffer(offer), classification: 'Carros', assetType: 'car' as const };
    });
    const rawProcessed = page * this.pageSize;
    const capped = this.maxRawOffers > 0 && rawProcessed >= this.maxRawOffers;
    return {
      page,
      pageSize: this.pageSize,
      total: this.maxRawOffers > 0 ? Math.min(payload.total, this.maxRawOffers) : payload.total,
      hasNext: !capped && rawProcessed < payload.total,
      lots,
    };
  }
}

function isCarOffer(offer: SuperbidOffer): boolean {
  return normalize(offer.product?.subCategory?.category?.description ?? '') === 'carros';
}

function mapOffer(offer: SuperbidOffer): LotData {
  const product = offer.product ?? {};
  const title = clean(product.shortDesc ?? `Oferta Superbid ${offer.id}`);
  const parsed = parseDescription(product.detailedDescription ?? offer.offerDescription?.offerDescription ?? '');
  const template = templateValues(product.template);
  const details = new Map([...parsed.values, ...template]);
  const location = parseLocation(product.location?.city ?? '');
  const state = location.state || stateCode(product.location?.state ?? '') || extract(title, /\(([A-Z]{2})\)/);
  const currentBid = number(offer.price ?? offer.offerDetail?.initialBidValue);
  const nextBid = number(offer.offerDetail?.currentMinBid)
    || currentBid + number(offer.currentBidIncrement?.currentBidIncrement);
  const commissionPercent = offer.groupOffer?.commissionPercent;
  const commissionFee = commissionPercent === undefined ? undefined : currentBid * commissionPercent / 100;
  const manufactureYear = integer(value(details, ['anofabricacao', 'ano fabricacao']))
    ?? years(title)[0];
  const modelYear = integer(value(details, ['anomodelo', 'ano modelo'])) ?? years(title)[1];
  const mileageText = value(details, ['km', 'quilometragem', 'quilometragem acima de', 'obs da quilometragem']);
  const mileage = mileageText && !/nao visualizado|nao informado/i.test(normalize(mileageText)) ? integer(mileageText) : undefined;
  const motor = value(details, ['motor']);
  const runningAtEntry = explicitRunning(motor);
  const restrictions = customRestrictions(product.productCustomJson);
  const vehicleDetails = vehicleDetailsFrom(details, parsed.unmapped, title, parsed.text, restrictions,
    template.size > 0 ? 'structured' : 'label_parsed', product.productYourRef);
  const images = (product.galleryJson ?? []).filter((item) => item.link && item.type !== 'video')
    .map((item) => item.link!);
  const videoUrl = (product.galleryJson ?? []).find((item) => item.type === 'video')?.link;
  const auctionEnd = offer.endDateTime ? new Date(offer.endDateTime) : parseDate(offer.endDate);
  const auctionStart = parseDate(offer.auction?.beginDate);
  if (!auctionEnd || Number.isNaN(auctionEnd.getTime())) throw new Error(`Superbid offer ${offer.id} has no valid end date`);

  return {
    title, currentBid, nextBid, auctionEnd,
    city: location.city, state, address: [location.city, state].filter(Boolean).join(' / '),
    yardName: 'Superbid', observations: parsed.text,
    ...(offer.lotNumber !== undefined ? { lotNumber: String(offer.lotNumber) } : {}),
    externalCode: String(offer.id), sourceAnnouncementId: String(offer.id),
    ...(runningAtEntry !== undefined ? { runningAtEntry } : {}),
    ...(product.brand?.description ? { brand: clean(product.brand.description) } : {}),
    ...(product.model?.description ? { model: clean(product.model.description) } : {}),
    ...(manufactureYear ? { manufactureYear } : {}), ...(modelYear ? { modelYear } : {}),
    ...(mileage ? { mileage } : {}),
    ...(offer.seller?.name ?? offer.stores?.at(-1)?.name ? { consignor: clean(offer.seller?.name ?? offer.stores?.at(-1)?.name ?? '') } : {}),
    saleStatus: status(offer), displayStatus: status(offer), classification: 'Carros', assetType: 'car',
    bidCount: offer.totalBids ?? 0,
    ...(value(details, ['cor']) ? { color: value(details, ['cor']) } : {}),
    ...(value(details, ['combustivel']) ? { fuel: value(details, ['combustivel']) } : {}),
    ...(value(details, ['cambio']) ? { transmission: value(details, ['cambio']) } : {}),
    ...(extract(title, /placa\s+final\s+([A-Z0-9])/i) ? { plateFinal: extract(title, /placa\s+final\s+([A-Z0-9])/i) } : {}),
    ...(extract(title, /placa\s+final\s+[A-Z0-9]\s*\(([A-Z]{2})\)/i) ? { plateState: extract(title, /placa\s+final\s+[A-Z0-9]\s*\(([A-Z]{2})\)/i) } : {}),
    ...(value(details, ['ar condicionado']) ? { airConditioning: value(details, ['ar condicionado']) } : {}),
    ...(value(details, ['direcao']) ? { steering: value(details, ['direcao']) } : {}),
    ...(value(details, ['chave']) ? { keyAvailable: value(details, ['chave']) } : {}),
    ...(value(details, ['travas', 'trava']) ? { locks: value(details, ['travas', 'trava']) } : {}),
    ...(value(details, ['vidros']) ? { windows: value(details, ['vidros']) } : {}),
    vehicleDetails,
    ...(commissionFee !== undefined ? { commissionFee, totalCost: currentBid + commissionFee } : {}),
    ...(offer.auction?.desc ? { eventName: clean(offer.auction.desc) } : {}),
    ...(offer.auction?.id !== undefined ? { eventExternalCode: String(offer.auction.id) } : {}),
    ...(auctionStart ? { auctionStart } : {}),
    ...(images.length ? { imageUrls: [...new Set(images)] } : {}), ...(videoUrl ? { videoUrl } : {}),
    ...(product.location?.locationGeo?.lat !== undefined ? { latitude: product.location.locationGeo.lat } : {}),
    ...(product.location?.locationGeo?.lon !== undefined ? { longitude: product.location.locationGeo.lon } : {}),
  };
}

function parseDescription(html: string): { text: string; values: Map<string, string>; unmapped: Record<string, string> } {
  const $ = cheerio.load(html);
  $('br').replaceWith('\n');
  $('p, div, li, h1, h2, h3, h4, h5, h6, tr').each((_, element) => {
    const node = $(element);
    if (element.tagName === 'li') node.prepend('• ');
    node.append('\n');
  });
  const rawText = $.root().text();
  const knownLabels = 'Referência Local|Marca|Modelo|Ano Fab\\/Modelo|Placa|Obs da quilometragem|Quilometragem acima de|Quilometragem|Cor|Combustível|Chassi|N[º°]? de Portas|Câmbio|Direção|Ar condicionado|Vidros|Travas|Rodas|Bancos|Aparelho de Som|Motor|Pintura|Lataria|Tapeçaria|Pneus|Chave de ignição|Chave reserva\\/Manual|Débitos em aberto';
  const separated = rawText.replace(new RegExp(`\\s*(${knownLabels})\\s*:`, 'gi'), '\n$1:');
  const lines: string[] = [];
  for (const rawLine of separated.split('\n')) {
    const line = clean(rawLine);
    if (line) lines.push(line);
    else if (lines.length > 0 && lines.at(-1) !== '') lines.push('');
  }
  while (lines.at(-1) === '') lines.pop();
  const text = lines.join('\n');
  const values = new Map<string, string>();
  const unmapped: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const match = /^([^:]{2,60}):\s*(.+)$/.exec(line);
    if (!match?.[1] || !match[2]) continue;
    const key = normalize(match[1]);
    values.set(key, match[2]);
    unmapped[clean(match[1])] = match[2];
  }
  return { text, values, unmapped };
}
function templateValues(template: SuperbidOffer['product'] extends infer _ ? { groups?: Array<{ properties?: Array<{ id?: string; title?: string; value?: string }> }> } | undefined : never): Map<string, string> {
  const result = new Map<string, string>();
  for (const group of template?.groups ?? []) for (const property of group.properties ?? []) {
    if (property.value) result.set(normalize(property.id ?? property.title ?? ''), clean(property.value));
  }
  return result;
}
function vehicleDetailsFrom(values: Map<string, string>, unmapped: Record<string, string>, title: string, text: string,
  restrictions: string, confidence: 'structured' | 'label_parsed', referenceCode?: string): NonNullable<LotData['vehicleDetails']> {
  const combined = normalize(`${title} ${text} ${restrictions}`);
  const condition = /sucata|baixa definitiva|\bbaixa\b/i.test(combined) ? 'sucata'
    : /batid[oa]/.test(combined) ? 'batido' : /avariad[oa]/.test(combined) ? 'avariado' : undefined;
  const taxNotes = text.split('\n').filter((line) => /ipva|multa|debito|licenciamento/i.test(normalize(line))).join(' ');
  return {
    ...(condition ? { vehicleCondition: condition } : {}),
    ...(value(values, ['motor']) ? { engineCondition: value(values, ['motor']) } : {}),
    ...(value(values, ['lataria']) ? { bodyCondition: value(values, ['lataria']) } : {}),
    ...(value(values, ['pintura']) ? { paintCondition: value(values, ['pintura']) } : {}),
    ...(value(values, ['tapecaria']) ? { upholsteryCondition: value(values, ['tapecaria']) } : {}),
    ...(value(values, ['pneus']) ? { tireCondition: value(values, ['pneus']) } : {}),
    ...(value(values, ['rodas']) ? { wheelType: value(values, ['rodas']) } : {}),
    ...(integer(value(values, ['n de portas', 'numero de portas'])) ? { doorCount: integer(value(values, ['n de portas', 'numero de portas']))! } : {}),
    ...(value(values, ['bancos']) ? { seatType: value(values, ['bancos']) } : {}),
    ...(value(values, ['aparelho de som', 'som']) ? { soundSystem: value(values, ['aparelho de som', 'som']) } : {}),
    ...(value(values, ['chassi']) ? { chassisCondition: value(values, ['chassi']) } : {}),
    ...(restrictions ? { vehicleRestrictions: restrictions } : {}),
    ...(taxNotes ? { taxStatus: taxNotes } : {}), ...(referenceCode ? { referenceCode } : {}),
    extractionConfidence: confidence, unmappedDetails: unmapped,
  };
}

function value(values: Map<string, string>, aliases: string[]): string {
  for (const alias of aliases) { const found = values.get(normalize(alias)); if (found) return found; }
  return '';
}
function customRestrictions(json: string | undefined): string { try { const value = JSON.parse(json ?? '{}') as { vehicleRestrictions?: string }; return clean(value.vehicleRestrictions ?? ''); } catch { return ''; } }
function explicitRunning(motor: string): boolean | undefined { const value = normalize(motor); if (/nao funciona|inoperante/.test(value)) return false; if (/funcionando|operacional/.test(value)) return true; return undefined; }
function status(offer: SuperbidOffer): string { if (offer.offerStatus?.sold) return 'sold'; if (offer.offerStatus?.closed) return 'closed'; if (offer.offerStatus?.giveYourBid) return 'open'; return String(offer.statusId ?? 'unknown'); }
function offerUrl(offer: SuperbidOffer): string { return `https://exchange.superbid.net/oferta/${slug(offer.product?.shortDesc ?? 'oferta')}-${offer.id}`; }
function slug(value: string): string { return normalize(value).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function clean(value: string): string { return value.replace(/\s+/g, ' ').trim(); }
function normalize(value: string): string { return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[º°]/g, '').replace(/[^a-z0-9&]+/g, ' ').trim(); }
function number(value: unknown): number { const parsed = Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0; }
function integer(value: string | undefined): number | undefined { const match = value?.replace(/\./g, '').match(/\d+/); return match ? Number(match[0]) : undefined; }
function years(value: string): [number | undefined, number | undefined] { const match = /(19|20)\d{2}\s*\/\s*((?:19|20)\d{2})/.exec(value); return [match?.[0] ? Number(match[0].slice(0, 4)) : undefined, match?.[2] ? Number(match[2]) : undefined]; }
function extract(value: string, pattern: RegExp): string { return clean(pattern.exec(value)?.[1] ?? ''); }
function parseDate(value: string | undefined): Date | undefined { if (!value) return undefined; const date = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`); return Number.isNaN(date.getTime()) ? undefined : date; }
function parseLocation(value: string): { city: string; state: string } { const match = /^(.*?)\s*-\s*([A-Z]{2})$/.exec(clean(value)); return { city: clean(match?.[1] ?? value), state: match?.[2] ?? '' }; }
function stateCode(value: string): string { const states: Record<string, string> = { 'minas gerais': 'MG', 'sao paulo': 'SP', 'rio de janeiro': 'RJ', parana: 'PR', 'santa catarina': 'SC', 'rio grande do sul': 'RS', bahia: 'BA', goias: 'GO', 'espirito santo': 'ES' }; return states[normalize(value)] ?? ''; }
function sleep(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }
