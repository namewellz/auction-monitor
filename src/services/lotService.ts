import type { Lot, LotChanges, LotData } from '../types/lot.js';
import type { LotRepository } from '../database/lotRepository.js';
import type { ScraperFactory } from '../scrapers/scraperFactory.js';

export class LotService {
  public constructor(
    private readonly lots: LotRepository,
    private readonly scraperFactory: ScraperFactory,
  ) {}

  public async add(url: string): Promise<{ lot: Lot; alreadyExists: boolean }> {
    const existing = await this.lots.findByUrl(url);
    if (existing) {
      return { lot: existing, alreadyExists: true };
    }

    const scraper = this.scraperFactory.forUrl(url);
    const data = await scraper.scrape(url);
    const lot = await this.lots.create({
      id: await this.lots.nextId(),
      site: scraper.site,
      url,
      ...data,
    });

    return { lot, alreadyExists: false };
  }

  public list(): Promise<Lot[]> {
    return this.lots.list();
  }

  public details(id: string): Promise<Lot | undefined> {
    return this.lots.findById(normalizeLotId(id));
  }

  public remove(id: string): Promise<boolean> {
    return this.lots.delete(normalizeLotId(id));
  }

  public pause(id: string): Promise<boolean> {
    return this.lots.setMonitoring(normalizeLotId(id), false);
  }

  public resume(id: string): Promise<boolean> {
    return this.lots.setMonitoring(normalizeLotId(id), true);
  }

  public setMaxBidLimit(id: string, value: number): Promise<boolean> {
    return this.lots.setMaxBidLimit(normalizeLotId(id), value);
  }

  public async refresh(lot: Lot): Promise<{ lot: Lot; changes: LotChanges }> {
    const scraper = this.scraperFactory.forUrl(lot.url);
    const fresh = await scraper.scrape(lot.url);
    const changes = compareLot(lot, fresh);
    const updated = await this.lots.updateFromScrape(lot.id, fresh, {
      bidChanged: changes.bidChanged,
      endChanged: changes.endChanged,
    });

    return { lot: updated ?? lot, changes };
  }
}

function normalizeLotId(id: string): string {
  return id.trim().toUpperCase();
}

function compareLot(previous: Lot, fresh: LotData): LotChanges {
  const changedFields: string[] = [];

  if (previous.address !== fresh.address) changedFields.push('address');
  if (previous.city !== fresh.city) changedFields.push('city');
  if (previous.state !== fresh.state) changedFields.push('state');
  if ((previous.observations ?? '') !== (fresh.observations ?? '')) changedFields.push('observations');
  if ((previous.lotNumber ?? '') !== (fresh.lotNumber ?? '')) changedFields.push('lotNumber');
  if ((previous.externalCode ?? '') !== (fresh.externalCode ?? '')) changedFields.push('externalCode');
  if (previous.runningAtEntry !== fresh.runningAtEntry) changedFields.push('runningAtEntry');
  if ((previous.origin ?? '') !== (fresh.origin ?? '')) changedFields.push('origin');

  const bidChanged = previous.currentBid !== fresh.currentBid;
  const endChanged = previous.auctionEnd.getTime() !== fresh.auctionEnd.getTime();

  const changes: LotChanges = {
    bidChanged,
    endChanged,
    infoChanged: changedFields.length > 0,
    changedFields,
  };

  if (bidChanged) changes.previousCurrentBid = previous.currentBid;
  if (endChanged) changes.previousAuctionEnd = previous.auctionEnd;

  return changes;
}
