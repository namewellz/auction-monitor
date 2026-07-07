import type { LotData } from './lot.js';

export interface AuctionEventData {
  site: string;
  externalCode?: string;
  name?: string;
  url?: string;
  startsAt?: Date;
  endsAt?: Date;
  city?: string;
  state?: string;
}

export interface HistoricalLot extends LotData {
  id: number;
  site: string;
  url: string;
  eventId?: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  nextCheckAt: Date;
  recheckCount: number;
  finalizedAt?: Date;
}

export interface CollectionSource {
  id: number;
  site: string;
  url: string;
  scanIntervalMinutes: number;
  nextScanAt: Date;
}

export interface CollectionRunResult {
  discovered: number;
  collected: number;
  failed: number;
}
