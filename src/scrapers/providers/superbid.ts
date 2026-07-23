import * as cheerio from 'cheerio';
import type { AuctionScraper } from '../base/auctionScraper.js';
import { fetchHtml } from '../base/cycleTlsClient.js';
import type { LotData } from '../../types/lot.js';
import { hostMatches } from '../../utils/url.js';

interface SuperbidNextData {
  props?: {
    pageProps?: {
      offerDetails?: {
        offers?: SuperbidOffer[];
      };
    };
  };
}

interface SuperbidOffer {
  id?: number;
  lotNumber?: number;
  endDateTime?: number;
  endDate?: string;
  price?: number;
  statusId?: number;
  offerStatus?: {
    sold?: boolean;
    closed?: boolean;
    reserved?: boolean;
    giveYourBid?: boolean;
  };
  stores?: Array<{ name?: string }>;
  offerDetail?: {
    currentMinBid?: number;
  };
  currentBidIncrement?: {
    currentBidIncrement?: number;
  };
  auction?: {
    id?: number;
    desc?: string;
    beginDate?: string;
    judicialPracaDescription?: string;
    address?: {
      city?: string;
      stateCode?: string;
    };
  };
  groupOffer?: { commissionPercent?: number };
  offerDescription?: {
    offerDescription?: string;
  };
  product?: {
    shortDesc?: string;
    location?: {
      city?: string;
      state?: string;
      stateCode?: string;
    };
  };
}

export class SuperbidScraper implements AuctionScraper {
  public readonly site = 'superbid';

  public supports(url: string): boolean {
    return hostMatches(url, ['superbid.net']);
  }

  public async scrape(url: string): Promise<LotData> {
    const html = await fetchHtml(url, { allowNativeFallback: true, preferNative: true });
    const $ = cheerio.load(html);
    const offer = extractOffer($);
    const descriptionText = htmlToText(offer.offerDescription?.offerDescription ?? '');
    const title = offer.product?.shortDesc ?? firstText($, ['h1', 'title']);
    const currentBid = offer.price ?? offer.offerDetail?.currentMinBid;
    const increment = offer.currentBidIncrement?.currentBidIncrement ?? 0;
    const nextBid = currentBid === undefined ? undefined : currentBid + increment;
    const auctionEnd = parseAuctionEnd(offer);
    const city = offer.product?.location?.city ?? offer.auction?.address?.city ?? extractFromDescription(descriptionText, /Local:\s*([^-\n]+)/i);
    const state =
      extractFromTitle(title, /\(([A-Z]{2})\)/) ||
      offer.product?.location?.stateCode ||
      offer.product?.location?.state ||
      offer.auction?.address?.stateCode ||
      '';
    const localRef = extractFromDescription(descriptionText, /Refer[êe]ncia Local:\s*([^\n]+)/i);

    const hasEnded = auctionEnd ? auctionEnd.getTime() <= Date.now() : false;
    const commissionPercent = offer.groupOffer?.commissionPercent;
    const commissionFee =
      currentBid === undefined || commissionPercent === undefined
        ? undefined
        : currentBid * (commissionPercent / 100);
    const saleStatus = superbidStatus(offer);
    const consignor = offer.stores?.at(-1)?.name;

    if (!title || currentBid === undefined || nextBid === undefined || !auctionEnd) {
      throw new Error('Superbid scraper could not extract required lot fields from this page.');
    }

    return {
      title,
      currentBid,
      nextBid,
      auctionEnd,
      city,
      state,
      address: [city, state].filter(Boolean).join(' - '),
      yardName: 'Superbid',
      observations: descriptionText,
      ...(offer.lotNumber !== undefined ? { lotNumber: String(offer.lotNumber) } : {}),
      ...(offer.id !== undefined ? { externalCode: String(offer.id) } : {}),
      ...(localRef ? { origin: `Referencia Local: ${localRef}` } : {}),
      ...vehicleFromTitle(title),
      ...(consignor ? { consignor } : {}),
      ...(saleStatus ? { saleStatus } : {}),
      ...(hasEnded ? { finalBid: currentBid } : {}),
      ...(commissionFee !== undefined ? { commissionFee, totalCost: currentBid + commissionFee } : {}),
      ...(offer.auction?.desc ? { eventName: offer.auction.desc } : {}),
      ...(offer.auction?.id !== undefined ? { eventExternalCode: String(offer.auction.id) } : {}),
      ...(offer.auction?.beginDate ? { auctionStart: parseSuperbidDate(offer.auction.beginDate) } : {}),
    };
  }
}

function superbidStatus(offer: SuperbidOffer): string | undefined {
  if (offer.offerStatus?.sold) return 'sold';
  if (offer.offerStatus?.reserved) return 'reserved';
  if (offer.offerStatus?.closed) return 'closed';
  if (offer.offerStatus?.giveYourBid) return 'open';
  return offer.statusId === undefined ? undefined : String(offer.statusId);
}

function vehicleFromTitle(title: string): Partial<LotData> {
  const yearMatch = title.match(/(\d{4})\s*\/\s*(\d{4})/);
  const beforeYear = yearMatch?.index === undefined ? title : title.slice(0, yearMatch.index).replace(/,\s*$/, '');
  const parts = beforeYear.trim().split(/\s+/);
  const brand = parts.shift();
  const model = parts.join(' ');

  return {
    ...(brand ? { brand } : {}),
    ...(model ? { model } : {}),
    ...(yearMatch?.[1] ? { manufactureYear: Number(yearMatch[1]) } : {}),
    ...(yearMatch?.[2] ? { modelYear: Number(yearMatch[2]) } : {}),
  };
}

function parseSuperbidDate(value: string): Date {
  return new Date(`${value.replace(' ', 'T')}-03:00`);
}

function extractOffer($: cheerio.CheerioAPI): SuperbidOffer {
  const nextData = parseNextData($);
  const offer = nextData.props?.pageProps?.offerDetails?.offers?.[0];
  if (!offer) {
    throw new Error('Superbid offer data was not found.');
  }

  return offer;
}

function parseNextData($: cheerio.CheerioAPI): SuperbidNextData {
  const byId = $('#__NEXT_DATA__').first().text();
  if (byId) {
    return JSON.parse(byId) as SuperbidNextData;
  }

  const script = $('script')
    .toArray()
    .map((element) => $(element).html() ?? '')
    .find((content) => content.includes('"offerDetails"') && content.includes('"offers"'));

  if (!script) {
    throw new Error('Superbid Next.js data script was not found.');
  }

  return JSON.parse(script) as SuperbidNextData;
}

function parseAuctionEnd(offer: SuperbidOffer): Date | undefined {
  if (typeof offer.endDateTime === 'number') {
    const parsed = new Date(offer.endDateTime);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  if (offer.endDate) {
    const parsed = new Date(`${offer.endDate.replace(' ', 'T')}-03:00`);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  return undefined;
}

function firstText($: cheerio.CheerioAPI, selectors: string[]): string {
  for (const selector of selectors) {
    const value = normalizedText($(selector).first().text());
    if (value) return value;
  }

  return '';
}

function htmlToText(input: string): string {
  const withBreaks = input.replace(/<br\s*\/?>/gi, '\n');
  return cheerio
    .load(withBreaks)
    .text()
    .split('\n')
    .map((line) => normalizedText(line))
    .filter(Boolean)
    .join('\n');
}

function normalizedText(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

function extractFromDescription(input: string, pattern: RegExp): string {
  return normalizedText(input.match(pattern)?.[1] ?? '');
}

function extractFromTitle(input: string, pattern: RegExp): string {
  return normalizedText(input.match(pattern)?.[1] ?? '');
}
