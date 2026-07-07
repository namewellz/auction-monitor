import type { LotData } from '../../types/lot.js';

export interface AuctionScraper {
  readonly site: string;
  supports(url: string): boolean;
  scrape(url: string): Promise<LotData>;
}
