import type { Pool } from 'pg';
import type { CreateLotInput, Lot, LotData } from '../types/lot.js';

interface LotRow {
  id: string;
  site: string;
  url: string;
  title: string | null;
  current_bid: string | number | null;
  next_bid: string | number | null;
  auction_end: Date | null;
  city: string | null;
  state: string | null;
  address: string | null;
  yard_name: string | null;
  observations: string | null;
  lot_number: string | null;
  external_code: string | null;
  running_at_entry: boolean | null;
  origin: string | null;
  max_bid_limit: string | number | null;
  monitoring_enabled: boolean;
  last_check: Date | null;
  last_bid_change: Date | null;
  last_end_change: Date | null;
  created_at: Date;
}

export class LotRepository {
  public constructor(private readonly pool: Pool) {}

  public async create(input: CreateLotInput): Promise<Lot> {
    const result = await this.pool.query<LotRow>(`
      INSERT INTO lots (
        id,site,url,title,current_bid,next_bid,auction_end,city,state,address,yard_name,observations,
        lot_number,external_code,running_at_entry,origin,monitoring_enabled,last_check,created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,TRUE,NOW(),NOW())
      RETURNING *
    `, [
      input.id, input.site, input.url, input.title, input.currentBid, input.nextBid, input.auctionEnd,
      input.city, input.state, input.address, input.yardName ?? null, input.observations ?? null,
      input.lotNumber ?? null, input.externalCode ?? null, input.runningAtEntry ?? null, input.origin ?? null,
    ]);
    return mapLot(result.rows[0]!);
  }

  public async findById(id: string): Promise<Lot | undefined> {
    const result = await this.pool.query<LotRow>('SELECT * FROM lots WHERE id=$1', [id]);
    return result.rows[0] ? mapLot(result.rows[0]) : undefined;
  }

  public async findByUrl(url: string): Promise<Lot | undefined> {
    const result = await this.pool.query<LotRow>('SELECT * FROM lots WHERE url=$1', [url]);
    return result.rows[0] ? mapLot(result.rows[0]) : undefined;
  }

  public async list(): Promise<Lot[]> {
    const result = await this.pool.query<LotRow>(
      'SELECT * FROM lots ORDER BY monitoring_enabled DESC,auction_end ASC,created_at DESC',
    );
    return result.rows.map(mapLot);
  }

  public async listMonitored(): Promise<Lot[]> {
    const result = await this.pool.query<LotRow>(
      'SELECT * FROM lots WHERE monitoring_enabled=TRUE ORDER BY auction_end ASC',
    );
    return result.rows.map(mapLot);
  }

  public async delete(id: string): Promise<boolean> {
    return (await this.pool.query('DELETE FROM lots WHERE id=$1', [id])).rowCount !== 0;
  }

  public async setMonitoring(id: string, enabled: boolean): Promise<boolean> {
    return (await this.pool.query('UPDATE lots SET monitoring_enabled=$1 WHERE id=$2', [enabled, id])).rowCount !== 0;
  }

  public async setMaxBidLimit(id: string, value: number): Promise<boolean> {
    return (await this.pool.query('UPDATE lots SET max_bid_limit=$1 WHERE id=$2', [value, id])).rowCount !== 0;
  }

  public async updateFromScrape(
    id: string,
    data: LotData,
    flags: { bidChanged: boolean; endChanged: boolean },
  ): Promise<Lot | undefined> {
    const result = await this.pool.query<LotRow>(`
      UPDATE lots SET
        title=$2,current_bid=$3,next_bid=$4,auction_end=$5,city=$6,state=$7,address=$8,yard_name=$9,
        observations=$10,lot_number=$11,external_code=$12,running_at_entry=$13,origin=$14,last_check=NOW(),
        last_bid_change=CASE WHEN $15 THEN NOW() ELSE last_bid_change END,
        last_end_change=CASE WHEN $16 THEN NOW() ELSE last_end_change END
      WHERE id=$1 RETURNING *
    `, [
      id, data.title, data.currentBid, data.nextBid, data.auctionEnd, data.city, data.state, data.address,
      data.yardName ?? null, data.observations ?? null, data.lotNumber ?? null, data.externalCode ?? null,
      data.runningAtEntry ?? null, data.origin ?? null, flags.bidChanged, flags.endChanged,
    ]);
    return result.rows[0] ? mapLot(result.rows[0]) : undefined;
  }

  public async markChecked(id: string): Promise<void> {
    await this.pool.query('UPDATE lots SET last_check=NOW() WHERE id=$1', [id]);
  }

  public async hasAlert(lotId: string, alertKey: string): Promise<boolean> {
    return (await this.pool.query('SELECT 1 FROM lot_alerts WHERE lot_id=$1 AND alert_key=$2', [lotId, alertKey])).rowCount !== 0;
  }

  public async markAlert(lotId: string, alertKey: string): Promise<void> {
    await this.pool.query(
      'INSERT INTO lot_alerts (lot_id,alert_key) VALUES ($1,$2) ON CONFLICT(lot_id,alert_key) DO NOTHING',
      [lotId, alertKey],
    );
  }

  public async nextId(): Promise<string> {
    const result = await this.pool.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM lots');
    const number = (result.rows[0]?.count ?? 0) + 1;
    const letter = String.fromCharCode(65 + Math.floor((number - 1) / 99));
    return `${letter}${number.toString().padStart(2, '0')}`;
  }
}

function mapLot(row: LotRow): Lot {
  const lot: Lot = {
    id: row.id,
    site: row.site,
    url: row.url,
    title: row.title ?? '',
    currentBid: Number(row.current_bid ?? 0),
    nextBid: Number(row.next_bid ?? 0),
    auctionEnd: row.auction_end ?? new Date(0),
    city: row.city ?? '',
    state: row.state ?? '',
    address: row.address ?? '',
    monitoringEnabled: row.monitoring_enabled,
    createdAt: row.created_at,
  };
  if (row.yard_name !== null) lot.yardName = row.yard_name;
  if (row.observations !== null) lot.observations = row.observations;
  if (row.lot_number !== null) lot.lotNumber = row.lot_number;
  if (row.external_code !== null) lot.externalCode = row.external_code;
  if (row.running_at_entry !== null) lot.runningAtEntry = row.running_at_entry;
  if (row.origin !== null) lot.origin = row.origin;
  if (row.max_bid_limit !== null) lot.maxBidLimit = Number(row.max_bid_limit);
  if (row.last_check) lot.lastCheck = row.last_check;
  if (row.last_bid_change) lot.lastBidChange = row.last_bid_change;
  if (row.last_end_change) lot.lastEndChange = row.last_end_change;
  return lot;
}
