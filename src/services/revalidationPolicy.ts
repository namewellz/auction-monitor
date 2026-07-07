import type { LotData } from '../types/lot.js';

const postAuctionOffsets = [5, 30, 120, 360, 1440, 4320, 10080, 20160, 43200].map(
  (minutes) => minutes * 60_000,
);

export interface RevalidationSchedule {
  nextCheckAt: Date;
  finalizedAt?: Date;
}

export function scheduleNextCheck(data: LotData, recheckCount = 0, now = new Date()): RevalidationSchedule {
  const remaining = data.auctionEnd.getTime() - now.getTime();
  if (remaining > 0) {
    return { nextCheckAt: new Date(now.getTime() + preAuctionInterval(remaining)) };
  }

  const age = Math.abs(remaining);
  const nextOffset = postAuctionOffsets.find((offset) => offset > age);
  if (nextOffset !== undefined) {
    return { nextCheckAt: new Date(data.auctionEnd.getTime() + nextOffset) };
  }

  const resultIsStable = isFinalStatus(data.saleStatus) && data.finalBid !== undefined;
  const exhaustedChecks = recheckCount >= postAuctionOffsets.length;
  if (resultIsStable || exhaustedChecks || age >= postAuctionOffsets.at(-1)!) {
    return { nextCheckAt: now, finalizedAt: now };
  }

  return { nextCheckAt: new Date(now.getTime() + 24 * 60 * 60_000) };
}

function preAuctionInterval(remaining: number): number {
  if (remaining > 7 * 24 * 60 * 60_000) return 24 * 60 * 60_000;
  if (remaining > 48 * 60 * 60_000) return 6 * 60 * 60_000;
  if (remaining > 6 * 60 * 60_000) return 60 * 60_000;
  if (remaining > 60 * 60_000) return 15 * 60_000;
  if (remaining > 10 * 60_000) return 5 * 60_000;
  return 60_000;
}

function isFinalStatus(status: string | undefined): boolean {
  if (!status) return false;
  return /sold|vendido|arrematado|closed|encerrado|finalizado/i.test(status);
}
