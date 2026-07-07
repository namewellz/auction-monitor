import type { AuctionScraper } from './base/auctionScraper.js';

export class ScraperFactory {
  public constructor(private readonly scrapers: AuctionScraper[]) {}

  public forUrl(url: string): AuctionScraper {
    const scraper = this.scrapers.find((candidate) => candidate.supports(url));
    if (!scraper) {
      throw new Error(`No scraper registered for URL: ${url}`);
    }

    return scraper;
  }
}
