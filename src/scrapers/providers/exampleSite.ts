import * as cheerio from 'cheerio';
import type { AuctionScraper } from '../base/auctionScraper.js';
import { fetchHtml } from '../base/cycleTlsClient.js';
import type { LotData } from '../../types/lot.js';
import { parseMoney } from '../../utils/format.js';
import { hostMatches } from '../../utils/url.js';

export class ExampleSiteScraper implements AuctionScraper {
  public readonly site = 'example';

  public constructor(private readonly hosts: string[]) {}

  public supports(url: string): boolean {
    return hostMatches(url, this.hosts);
  }

  public async scrape(url: string): Promise<LotData> {
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);

    const title = firstText($, ['h1', '[data-lot-title]', '.lot-title', '.titulo', '.title']);
    const currentBid = firstMoney($, ['[data-current-bid]', '.current-bid', '.lance-atual', '.valor-atual']);
    const nextBid = firstMoney($, ['[data-next-bid]', '.next-bid', '.proximo-lance', '.incremento']);
    const auctionEndText = firstText($, ['[data-auction-end]', '.auction-end', '.encerramento', '.data-encerramento']);
    const auctionEnd = parseBrazilianDate(auctionEndText);
    const cityState = firstText($, ['[data-city-state]', '.city-state', '.localidade', '.cidade']);
    const { city, state } = splitCityState(cityState);
    const address = firstText($, ['[data-address]', '.address', '.endereco']);
    const yardName = firstOptionalText($, ['[data-yard-name]', '.yard-name', '.patio']);
    const observations = firstOptionalText($, ['[data-observations]', '.observations', '.observacoes']);

    if (!title || currentBid === undefined || nextBid === undefined || !auctionEnd) {
      throw new Error('Example scraper could not extract required lot fields from this page.');
    }

    return {
      title,
      currentBid,
      nextBid,
      auctionEnd,
      city,
      state,
      address,
      ...(yardName ? { yardName } : {}),
      ...(observations ? { observations } : {}),
    };
  }
}

type CheerioRoot = cheerio.CheerioAPI;

function firstText($: CheerioRoot, selectors: string[]): string {
  return firstOptionalText($, selectors) ?? '';
}

function firstOptionalText($: CheerioRoot, selectors: string[]): string | undefined {
  for (const selector of selectors) {
    const value = $(selector).first().text().trim() || $(selector).first().attr('content')?.trim();
    if (value) {
      return collapseWhitespace(value);
    }
  }

  return undefined;
}

function firstMoney($: CheerioRoot, selectors: string[]): number | undefined {
  const text = firstOptionalText($, selectors);
  return text ? parseMoney(text) : undefined;
}

function collapseWhitespace(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

function parseBrazilianDate(input: string): Date | undefined {
  const match = input.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})/);
  if (!match) {
    const parsed = new Date(input);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  const [, day, month, year, hour, minute] = match;
  const iso = `${year}-${month?.padStart(2, '0')}-${day?.padStart(2, '0')}T${hour?.padStart(2, '0')}:${minute}:00-03:00`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function splitCityState(input: string): { city: string; state: string } {
  const [city = '', state = ''] = input.split('-').map((part) => part.trim());
  return { city, state };
}
