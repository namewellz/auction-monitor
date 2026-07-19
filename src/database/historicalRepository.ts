import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { LotData } from '../types/lot.js';
import type { AuctionEventData, CollectionSource } from '../types/historical.js';

export interface DueMarketLot {
  id: number;
  site: string;
  url: string;
  auctionEnd: Date;
  recheckCount: number;
}

export interface PendingMedia {
  id: number;
  sourceUrl: string;
  downloadAttempts: number;
}

export interface PendingDocument extends PendingMedia {
  label?: string;
  documentType?: string;
}

export interface StoredDocumentMetadata {
  storageKey: string;
  contentHash: string;
  contentType: string;
  sizeBytes: number;
  etag?: string;
}

export interface OptimizableMedia {
  id: number;
  sourceUrl: string;
  storageKey: string;
  sizeBytes?: number;
  optimizationAttempts: number;
}

export interface OptimizedMediaMetadata {
  storageKey: string;
  contentHash: string;
  contentType: string;
  sizeBytes: number;
  originalSizeBytes: number;
  imageWidth: number;
  imageHeight: number;
  optimizationProfile: string;
  etag?: string;
}

export interface StoredMedia {
  id: number;
  storageKey?: string;
  sourceUrl: string;
  downloadStatus: string;
  contentType?: string;
}

export interface SaveObservationResult {
  id: number;
  outcome: 'new' | 'updated' | 'unchanged';
}

interface PreviousLotState {
  current_bid: string | null;
  current_bidder_alias: string | null;
  next_bid: string | null;
  final_bid: string | null;
  commission_fee: string | null;
  buyer_fee: string | null;
  other_fees: string | null;
  total_cost: string | null;
  sale_status: string | null;
  auction_end: Date;
  sold_at: Date | null;
}

export class HistoricalRepository {
  public constructor(private readonly pool: Pool) {}

  public async saveObservation(
    site: string,
    url: string,
    data: LotData,
    scheduling: { nextCheckAt: Date; finalizedAt?: Date },
  ): Promise<SaveObservationResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const eventId = await this.upsertEvent(client, eventFromLot(site, data));
      const now = new Date();
      const rawDataJson = JSON.stringify(data);
      const snapshotHash = stableId(rawDataJson);
      const previousResult = await client.query<PreviousLotState>(
        `SELECT current_bid,current_bidder_alias,next_bid,final_bid,commission_fee,buyer_fee,other_fees,total_cost,
          sale_status,auction_end,sold_at FROM market_lots WHERE url=$1 FOR UPDATE`,
        [url],
      );
      const previous = previousResult.rows[0];
      const values = lotValues(site, url, data, eventId, scheduling, now, rawDataJson);
      const result = await client.query<{ id: string }>(
        `
        INSERT INTO market_lots (
          event_id, site, external_code, url, lot_number, title, brand, model,
          manufacture_year, model_year, mileage, running_at_entry, origin, consignor,
          city, state, address, yard_name, observations, sale_status, current_bid, next_bid,
          final_bid, commission_fee, buyer_fee, other_fees, total_cost, auction_start,
          auction_end, sold_at, first_seen_at, last_seen_at, last_checked_at, next_check_at,
          recheck_count, finalized_at, raw_data_json, current_bidder_alias,
          classification, source_announcement_id, display_status, sale_phase, sale_result, bid_count,
          color, fuel, transmission, plate_final, plate_state, air_conditioning, steering,
          key_available, locks, windows, asset_type
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
          $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$31,$31,$32,0,$33,$34::jsonb,$35,
          $36,$37,$38,$39,$40,$41,$42,$43,$44,$45,$46,$47,$48,$49,$50,$51,$52
        )
        ON CONFLICT (url) DO UPDATE SET
          event_id=EXCLUDED.event_id, external_code=EXCLUDED.external_code, lot_number=EXCLUDED.lot_number,
          title=EXCLUDED.title, brand=EXCLUDED.brand, model=EXCLUDED.model,
          manufacture_year=EXCLUDED.manufacture_year, model_year=EXCLUDED.model_year,
          mileage=EXCLUDED.mileage, running_at_entry=EXCLUDED.running_at_entry, origin=EXCLUDED.origin,
          consignor=EXCLUDED.consignor, city=EXCLUDED.city, state=EXCLUDED.state,
          address=EXCLUDED.address, yard_name=EXCLUDED.yard_name, observations=EXCLUDED.observations,
          sale_status=EXCLUDED.sale_status, current_bid=EXCLUDED.current_bid, next_bid=EXCLUDED.next_bid,
          current_bidder_alias=EXCLUDED.current_bidder_alias,
          final_bid=EXCLUDED.final_bid, commission_fee=EXCLUDED.commission_fee,
          buyer_fee=EXCLUDED.buyer_fee, other_fees=EXCLUDED.other_fees, total_cost=EXCLUDED.total_cost,
          auction_start=EXCLUDED.auction_start, auction_end=EXCLUDED.auction_end, sold_at=EXCLUDED.sold_at,
          last_seen_at=EXCLUDED.last_seen_at, last_checked_at=EXCLUDED.last_checked_at,
          next_check_at=EXCLUDED.next_check_at, recheck_count=market_lots.recheck_count+1,
          finalized_at=COALESCE(EXCLUDED.finalized_at, market_lots.finalized_at),
          classification=COALESCE(EXCLUDED.classification,market_lots.classification),
          source_announcement_id=EXCLUDED.source_announcement_id,
          display_status=EXCLUDED.display_status, sale_phase=EXCLUDED.sale_phase,
          sale_result=EXCLUDED.sale_result, bid_count=EXCLUDED.bid_count,
          color=EXCLUDED.color, fuel=EXCLUDED.fuel, transmission=EXCLUDED.transmission,
          plate_final=EXCLUDED.plate_final, plate_state=EXCLUDED.plate_state,
          air_conditioning=EXCLUDED.air_conditioning, steering=EXCLUDED.steering,
          key_available=EXCLUDED.key_available, locks=EXCLUDED.locks, windows=EXCLUDED.windows,
          asset_type=COALESCE(EXCLUDED.asset_type,market_lots.asset_type),
          raw_data_json=EXCLUDED.raw_data_json
        RETURNING id
      `,
        values,
      );
      const marketLotId = Number(result.rows[0]?.id);
      const snapshotInserted = await this.insertSnapshot(client, marketLotId, data, now, snapshotHash, rawDataJson);
      await this.insertChangeLog(client, marketLotId, previous, data, now, snapshotHash);
      await this.upsertMedia(client, marketLotId, data, now);
      await this.upsertRealEstateDetails(client, marketLotId, data);
      await this.upsertVehicleDetails(client, marketLotId, data);
      await this.upsertBidHistory(client, marketLotId, data);
      await client.query('COMMIT');
      return {
        id: marketLotId,
        outcome: !previous ? 'new' : snapshotInserted ? 'updated' : 'unchanged',
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  public async listDueLots(limit: number): Promise<DueMarketLot[]> {
    const result = await this.pool.query<{
      id: string; site: string; url: string; auction_end: Date; recheck_count: number;
    }>(
      `SELECT id, site, url, auction_end, recheck_count FROM market_lots
       WHERE finalized_at IS NULL AND next_check_at <= NOW() ORDER BY next_check_at LIMIT $1`,
      [limit],
    );
    return result.rows.map((row) => ({
      id: Number(row.id), site: row.site, url: row.url,
      auctionEnd: row.auction_end, recheckCount: row.recheck_count,
    }));
  }

  public async listSiteLots(site: string, limit: number): Promise<Array<{ url: string; recheckCount: number }>> {
    const result = await this.pool.query<{ url: string; recheck_count: number }>(
      `SELECT url,recheck_count FROM market_lots WHERE site=$1 ORDER BY last_checked_at ASC LIMIT $2`,
      [site, limit],
    );
    return result.rows.map((row) => ({ url: row.url, recheckCount: row.recheck_count }));
  }

  public async postponeFailedLot(url: string, recheckCount: number): Promise<void> {
    const delayMinutes = Math.min(1440, 30 * 2 ** Math.min(recheckCount, 5));
    await this.pool.query(
      `UPDATE market_lots SET next_check_at=NOW()+($1 * INTERVAL '1 minute'), recheck_count=recheck_count+1 WHERE url=$2`,
      [delayMinutes, url],
    );
  }

  public async addSource(site: string, url: string, scanIntervalMinutes = 360): Promise<void> {
    await this.pool.query(
      `INSERT INTO collection_sources (site,url,scan_interval_minutes,next_scan_at,created_at)
       VALUES ($1,$2,$3,NOW(),NOW()) ON CONFLICT(url) DO UPDATE SET
       site=EXCLUDED.site, scan_interval_minutes=EXCLUDED.scan_interval_minutes, enabled=TRUE`,
      [site, url, scanIntervalMinutes],
    );
  }

  public async listDueSources(limit: number): Promise<CollectionSource[]> {
    const result = await this.pool.query<{
      id: string; site: string; url: string; scan_interval_minutes: number; next_scan_at: Date;
    }>(
      `SELECT id,site,url,scan_interval_minutes,next_scan_at FROM collection_sources
       WHERE enabled=TRUE AND next_scan_at<=NOW() ORDER BY next_scan_at LIMIT $1`,
      [limit],
    );
    return result.rows.map((row) => ({
      id: Number(row.id), site: row.site, url: row.url,
      scanIntervalMinutes: row.scan_interval_minutes, nextScanAt: row.next_scan_at,
    }));
  }

  public async markSourceScanned(source: CollectionSource): Promise<void> {
    await this.pool.query(
      `UPDATE collection_sources SET last_scan_at=NOW(), next_scan_at=NOW()+($1 * INTERVAL '1 minute') WHERE id=$2`,
      [source.scanIntervalMinutes, source.id],
    );
  }

  public async postponeFailedSource(source: CollectionSource): Promise<void> {
    await this.pool.query(
      `UPDATE collection_sources SET next_scan_at=NOW()+($1 * INTERVAL '1 minute') WHERE id=$2`,
      [Math.min(source.scanIntervalMinutes, 60), source.id],
    );
  }

  public async startRun(sourceId?: number, site?: string): Promise<number> {
    const result = await this.pool.query<{ id: string }>(
      `INSERT INTO collection_runs (source_id,site,started_at,status) VALUES ($1,$2,NOW(),'running') RETURNING id`,
      [sourceId ?? null, site ?? null],
    );
    return Number(result.rows[0]?.id);
  }

  public async finishRun(
    runId: number,
    result: { discovered: number; collected: number; failed: number; new: number; updated: number; unchanged: number },
    error?: string,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE collection_runs SET finished_at=NOW(),status=$1,discovered_count=$2,
       collected_count=$3,failed_count=$4,new_count=$5,updated_count=$6,unchanged_count=$7,error=$8 WHERE id=$9`,
      [error ? 'failed' : 'completed', result.discovered, result.collected, result.failed,
        result.new, result.updated, result.unchanged, error ?? null, runId],
    );
  }

  public async listPendingMedia(limit: number): Promise<PendingMedia[]> {
    const result = await this.pool.query<{
      id: string; source_url: string; download_attempts: number;
    }>(
      `SELECT id,source_url,download_attempts FROM lot_media
       WHERE type='image' AND download_status IN ('pending','failed') AND download_attempts<4
       ORDER BY id LIMIT $1`,
      [limit],
    );
    return result.rows.map((row) => ({
      id: Number(row.id), sourceUrl: row.source_url, downloadAttempts: row.download_attempts,
    }));
  }

  public async markMediaDownloaded(
    id: number,
    media: OptimizedMediaMetadata,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE lot_media SET storage_key=$1,content_hash=$2,content_type=$3,size_bytes=$4,etag=$5,
       original_size_bytes=$6,image_width=$7,image_height=$8,optimization_profile=$9,optimized_at=NOW(),
       optimization_attempts=optimization_attempts+1,optimization_error=NULL,
       storage_provider='oracle-minio',storage_tier='hot',
       download_status='downloaded',download_attempts=download_attempts+1,download_error=NULL,downloaded_at=NOW()
       WHERE id=$10`,
      [media.storageKey, media.contentHash, media.contentType, media.sizeBytes, media.etag ?? null,
        media.originalSizeBytes, media.imageWidth, media.imageHeight, media.optimizationProfile, id],
    );
  }

  public async listUnoptimizedMedia(profile: string, limit: number): Promise<OptimizableMedia[]> {
    const result = await this.pool.query<{
      id: string; source_url: string; storage_key: string; size_bytes: string | null; optimization_attempts: number;
    }>(
      `SELECT id,source_url,storage_key,size_bytes,optimization_attempts FROM lot_media
       WHERE type='image' AND download_status='downloaded' AND storage_key IS NOT NULL
         AND optimization_profile IS DISTINCT FROM $1 AND optimization_attempts<4
       ORDER BY id LIMIT $2`,
      [profile, limit],
    );
    return result.rows.map((row) => ({
      id: Number(row.id),
      sourceUrl: row.source_url,
      storageKey: row.storage_key,
      ...(row.size_bytes ? { sizeBytes: Number(row.size_bytes) } : {}),
      optimizationAttempts: row.optimization_attempts,
    }));
  }

  public async markMediaOptimized(id: number, media: OptimizedMediaMetadata): Promise<void> {
    await this.pool.query(
      `UPDATE lot_media SET storage_key=$1,content_hash=$2,content_type=$3,size_bytes=$4,etag=$5,
       original_size_bytes=COALESCE(original_size_bytes,$6),image_width=$7,image_height=$8,
       optimization_profile=$9,optimized_at=NOW(),optimization_attempts=optimization_attempts+1,
       optimization_error=NULL WHERE id=$10`,
      [media.storageKey, media.contentHash, media.contentType, media.sizeBytes, media.etag ?? null,
        media.originalSizeBytes, media.imageWidth, media.imageHeight, media.optimizationProfile, id],
    );
  }

  public async markMediaOptimizationFailed(id: number, error: string): Promise<void> {
    await this.pool.query(
      `UPDATE lot_media SET optimization_attempts=optimization_attempts+1,optimization_error=$1 WHERE id=$2`,
      [error.slice(0, 1000), id],
    );
  }

  public async countMediaByStorageKey(storageKey: string): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      'SELECT COUNT(*) AS count FROM lot_media WHERE storage_key=$1',
      [storageKey],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  public async markMediaFailed(id: number, error: string): Promise<void> {
    await this.pool.query(
      `UPDATE lot_media SET download_status='failed',download_attempts=download_attempts+1,download_error=$1 WHERE id=$2`,
      [error.slice(0, 1000), id],
    );
  }

  public async getMedia(id: number): Promise<StoredMedia | undefined> {
    const result = await this.pool.query<{
      id: string; storage_key: string | null; source_url: string; download_status: string; content_type: string | null;
    }>(`UPDATE lot_media SET last_accessed_at=NOW() WHERE id=$1
        RETURNING id,storage_key,source_url,download_status,content_type`, [id]);
    const row = result.rows[0];
    if (!row) return undefined;
    return {
      id: Number(row.id), sourceUrl: row.source_url, downloadStatus: row.download_status,
      ...(row.storage_key ? { storageKey: row.storage_key } : {}),
      ...(row.content_type ? { contentType: row.content_type } : {}),
    };
  }

  private async upsertEvent(client: PoolClient, event: AuctionEventData | undefined): Promise<number | undefined> {
    if (!event) return undefined;
    const externalCode = event.externalCode ?? stableId(event.url ?? event.name ?? event.site);
    const result = await client.query<{ id: string }>(
      `INSERT INTO auction_events (site,external_code,name,url,starts_at,ends_at,city,state,first_seen_at,last_seen_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW()) ON CONFLICT(site,external_code) DO UPDATE SET
       name=COALESCE(EXCLUDED.name,auction_events.name),url=COALESCE(EXCLUDED.url,auction_events.url),
       starts_at=COALESCE(EXCLUDED.starts_at,auction_events.starts_at),ends_at=COALESCE(EXCLUDED.ends_at,auction_events.ends_at),
       city=COALESCE(EXCLUDED.city,auction_events.city),state=COALESCE(EXCLUDED.state,auction_events.state),last_seen_at=NOW()
       RETURNING id`,
      [event.site, externalCode, event.name ?? null, event.url ?? null, event.startsAt ?? null,
        event.endsAt ?? null, event.city ?? null, event.state ?? null],
    );
    return Number(result.rows[0]?.id);
  }

  private async insertSnapshot(
    client: PoolClient,
    marketLotId: number,
    data: LotData,
    observedAt: Date,
    hash: string,
    rawDataJson: string,
  ): Promise<boolean> {
    const result = await client.query(
      `INSERT INTO lot_snapshots (market_lot_id,observed_at,current_bid,bidder_alias,next_bid,final_bid,sale_status,
       commission_fee,buyer_fee,other_fees,total_cost,auction_end,data_hash,raw_data_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)
       ON CONFLICT(market_lot_id,data_hash) DO NOTHING`,
      [marketLotId, observedAt, data.currentBid, data.bidderAlias ?? null, data.nextBid,
        data.finalBid ?? null, data.saleStatus ?? null,
        data.commissionFee ?? null, data.buyerFee ?? null, data.otherFees ?? null, data.totalCost ?? null,
        data.auctionEnd, hash, rawDataJson],
    );
    return (result.rowCount ?? 0) > 0;
  }

  public async listPendingDocuments(limit: number): Promise<PendingDocument[]> {
    const result = await this.pool.query<{
      id: string; source_url: string; download_attempts: number; label: string | null; document_type: string | null;
    }>(
      `SELECT id,source_url,download_attempts,label,document_type FROM lot_media
       WHERE type='document' AND download_status IN ('pending','failed','metadata_only') AND download_attempts<4
       ORDER BY id LIMIT $1`,
      [limit],
    );
    return result.rows.map((row) => ({
      id: Number(row.id), sourceUrl: row.source_url, downloadAttempts: row.download_attempts,
      ...(row.label ? { label: row.label } : {}),
      ...(row.document_type ? { documentType: row.document_type } : {}),
    }));
  }

  public async markDocumentDownloaded(id: number, document: StoredDocumentMetadata, bucket: string): Promise<void> {
    await this.pool.query(
      `UPDATE lot_media SET storage_key=$1,content_hash=$2,content_type=$3,size_bytes=$4,etag=$5,
       original_size_bytes=$4,storage_provider='oracle-minio',storage_tier='hot',storage_bucket=$6,
       download_status='downloaded',download_attempts=download_attempts+1,download_error=NULL,downloaded_at=NOW()
       WHERE id=$7`,
      [document.storageKey, document.contentHash, document.contentType, document.sizeBytes,
        document.etag ?? null, bucket, id],
    );
  }

  private async insertChangeLog(
    client: PoolClient,
    marketLotId: number,
    previous: PreviousLotState | undefined,
    data: LotData,
    observedAt: Date,
    snapshotHash: string,
  ): Promise<void> {
    if (!previous) {
      await client.query(
        `INSERT INTO lot_change_log
          (market_lot_id,change_key,change_type,new_value,bidder_alias,observed_at)
         VALUES ($1,$2,'discovered',$3,$4,$5) ON CONFLICT(change_key) DO NOTHING`,
        [marketLotId, `observation:${marketLotId}:${snapshotHash}:discovered`,
          data.saleStatus ?? null, data.bidderAlias ?? null, observedAt],
      );
      return;
    }

    const changes: Array<{
      field: string; type: 'money' | 'status' | 'datetime'; oldValue: unknown; newValue: unknown;
    }> = [
      { field: 'current_bid', type: 'money', oldValue: previous.current_bid, newValue: data.currentBid },
      { field: 'next_bid', type: 'money', oldValue: previous.next_bid, newValue: data.nextBid },
      { field: 'final_bid', type: 'money', oldValue: previous.final_bid, newValue: data.finalBid },
      { field: 'commission_fee', type: 'money', oldValue: previous.commission_fee, newValue: data.commissionFee },
      { field: 'buyer_fee', type: 'money', oldValue: previous.buyer_fee, newValue: data.buyerFee },
      { field: 'other_fees', type: 'money', oldValue: previous.other_fees, newValue: data.otherFees },
      { field: 'total_cost', type: 'money', oldValue: previous.total_cost, newValue: data.totalCost },
      { field: 'sale_status', type: 'status', oldValue: previous.sale_status, newValue: data.saleStatus },
      { field: 'auction_end', type: 'datetime', oldValue: previous.auction_end, newValue: data.auctionEnd },
      { field: 'sold_at', type: 'datetime', oldValue: previous.sold_at, newValue: data.soldAt },
    ];

    for (const change of changes) {
      const oldValue = serializeChangeValue(change.oldValue, change.type);
      const newValue = serializeChangeValue(change.newValue, change.type);
      if (oldValue === newValue) continue;
      const changeType = change.field === 'sale_status'
        ? 'status_changed'
        : change.type === 'datetime' ? 'schedule_changed' : 'value_changed';
      await client.query(
        `INSERT INTO lot_change_log
          (market_lot_id,change_key,change_type,field_name,value_type,old_value,new_value,bidder_alias,observed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(change_key) DO NOTHING`,
        [marketLotId, `observation:${marketLotId}:${snapshotHash}:${change.field}`, changeType,
          change.field, change.type, oldValue, newValue, data.bidderAlias ?? null, observedAt],
      );
    }

    if (data.bidderAlias) {
      await client.query(
        `UPDATE lot_change_log SET bidder_alias=$1 WHERE id=(
          SELECT id FROM lot_change_log
          WHERE market_lot_id=$2 AND field_name='current_bid' AND bidder_alias IS NULL
            AND new_value::numeric=$3
          ORDER BY observed_at DESC,id DESC LIMIT 1
        )`,
        [data.bidderAlias, marketLotId, data.currentBid],
      );
    }
  }

  private async upsertMedia(client: PoolClient, marketLotId: number, data: LotData, observedAt: Date): Promise<void> {
    for (const [position, sourceUrl] of (data.imageUrls ?? []).entries()) {
      await client.query(
        `INSERT INTO lot_media (market_lot_id,type,source_url,position,first_seen_at,last_seen_at)
         VALUES ($1,'image',$2,$3,$4,$4) ON CONFLICT(market_lot_id,source_url) DO UPDATE SET
         position=EXCLUDED.position,last_seen_at=EXCLUDED.last_seen_at`,
        [marketLotId, sourceUrl, position, observedAt],
      );
    }
    if (data.videoUrl) {
      await client.query(
        `INSERT INTO lot_media (market_lot_id,type,source_url,position,download_status,first_seen_at,last_seen_at)
         VALUES ($1,'video',$2,0,'metadata_only',$3,$3) ON CONFLICT(market_lot_id,source_url) DO UPDATE SET last_seen_at=EXCLUDED.last_seen_at`,
        [marketLotId, data.videoUrl, observedAt],
      );
    }
    const documents: NonNullable<LotData['documents']> =
      data.documents ?? (data.documentUrls ?? []).map((url) => ({ url }));
    for (const [position, document] of documents.entries()) {
      await client.query(
        `INSERT INTO lot_media (market_lot_id,type,source_url,position,label,document_type,download_status,first_seen_at,last_seen_at)
         VALUES ($1,'document',$2,$3,$4,$5,'pending',$6,$6) ON CONFLICT(market_lot_id,source_url) DO UPDATE SET
         position=EXCLUDED.position,label=COALESCE(EXCLUDED.label,lot_media.label),
         document_type=COALESCE(EXCLUDED.document_type,lot_media.document_type),last_seen_at=EXCLUDED.last_seen_at`,
        [marketLotId, document.url, position, document.label ?? null, document.documentType ?? null, observedAt],
      );
    }
  }

  private async upsertRealEstateDetails(client: PoolClient, marketLotId: number, data: LotData): Promise<void> {
    if (data.assetType !== 'real_estate') return;
    await client.query(
      `INSERT INTO real_estate_details (
        market_lot_id,state_code,city_code,neighborhood,neighborhood_normalized,postal_code,
        property_type,occupancy_status,total_area_m2,private_area_m2,latitude,longitude,accepts_financing,updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
      ON CONFLICT(market_lot_id) DO UPDATE SET
        state_code=EXCLUDED.state_code,city_code=EXCLUDED.city_code,neighborhood=EXCLUDED.neighborhood,
        neighborhood_normalized=EXCLUDED.neighborhood_normalized,postal_code=EXCLUDED.postal_code,
        property_type=EXCLUDED.property_type,occupancy_status=EXCLUDED.occupancy_status,
        total_area_m2=EXCLUDED.total_area_m2,private_area_m2=EXCLUDED.private_area_m2,
        latitude=EXCLUDED.latitude,longitude=EXCLUDED.longitude,
        accepts_financing=EXCLUDED.accepts_financing,updated_at=NOW()`,
      [marketLotId, data.state, null, data.neighborhood ?? null, data.neighborhoodNormalized ?? null,
        data.postalCode ?? null, data.propertyType ?? null, data.occupancyStatus ?? null,
        data.totalAreaM2 ?? null, data.privateAreaM2 ?? null, data.latitude ?? null,
        data.longitude ?? null, data.acceptsFinancing ?? null],
    );
  }

  private async upsertVehicleDetails(client: PoolClient, marketLotId: number, data: LotData): Promise<void> {
    if (!data.vehicleDetails || data.assetType === 'real_estate') return;
    const details = data.vehicleDetails;
    await client.query(
      `INSERT INTO vehicle_details (
        market_lot_id,vehicle_condition,engine_condition,body_condition,paint_condition,
        upholstery_condition,tire_condition,wheel_type,door_count,seat_type,sound_system,
        chassis_condition,vehicle_restrictions,tax_status,debt_notes,reference_code,
        extraction_confidence,unmapped_details_json,updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,NOW())
      ON CONFLICT(market_lot_id) DO UPDATE SET
        vehicle_condition=EXCLUDED.vehicle_condition,engine_condition=EXCLUDED.engine_condition,
        body_condition=EXCLUDED.body_condition,paint_condition=EXCLUDED.paint_condition,
        upholstery_condition=EXCLUDED.upholstery_condition,tire_condition=EXCLUDED.tire_condition,
        wheel_type=EXCLUDED.wheel_type,door_count=EXCLUDED.door_count,seat_type=EXCLUDED.seat_type,
        sound_system=EXCLUDED.sound_system,chassis_condition=EXCLUDED.chassis_condition,
        vehicle_restrictions=EXCLUDED.vehicle_restrictions,tax_status=EXCLUDED.tax_status,
        debt_notes=EXCLUDED.debt_notes,reference_code=EXCLUDED.reference_code,
        extraction_confidence=EXCLUDED.extraction_confidence,
        unmapped_details_json=EXCLUDED.unmapped_details_json,updated_at=NOW()`,
      [marketLotId, details.vehicleCondition ?? null, details.engineCondition ?? null,
        details.bodyCondition ?? null, details.paintCondition ?? null, details.upholsteryCondition ?? null,
        details.tireCondition ?? null, details.wheelType ?? null, details.doorCount ?? null,
        details.seatType ?? null, details.soundSystem ?? null, details.chassisCondition ?? null,
        details.vehicleRestrictions ?? null, details.taxStatus ?? null, details.debtNotes ?? null,
        details.referenceCode ?? null, details.extractionConfidence ?? null,
        JSON.stringify(details.unmappedDetails ?? {})],
    );
  }

  private async upsertBidHistory(client: PoolClient, marketLotId: number, data: LotData): Promise<void> {
    for (const bid of data.bidHistory ?? []) {
      await client.query(
        `INSERT INTO lot_bid_history
          (market_lot_id,source_key,source_order,amount,bidder_alias,bid_type,observed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(market_lot_id,source_key) DO UPDATE SET
         amount=EXCLUDED.amount,bidder_alias=EXCLUDED.bidder_alias,bid_type=EXCLUDED.bid_type,
         observed_at=EXCLUDED.observed_at`,
        [marketLotId, bid.sourceKey, bid.sourceOrder ?? null, bid.amount,
          bid.bidderAlias ?? null, bid.bidType ?? null, bid.observedAt],
      );
    }
  }
}

function eventFromLot(site: string, data: LotData): AuctionEventData | undefined {
  if (!data.eventName && !data.eventExternalCode && !data.eventUrl) return undefined;
  return {
    site,
    ...(data.eventExternalCode ? { externalCode: data.eventExternalCode } : {}),
    ...(data.eventName ? { name: data.eventName } : {}),
    ...(data.eventUrl ? { url: data.eventUrl } : {}),
    ...(data.auctionStart ? { startsAt: data.auctionStart } : {}),
    endsAt: data.auctionEnd,
    ...(data.city ? { city: data.city } : {}),
    ...(data.state ? { state: data.state } : {}),
  };
}

function lotValues(
  site: string,
  url: string,
  data: LotData,
  eventId: number | undefined,
  scheduling: { nextCheckAt: Date; finalizedAt?: Date },
  now: Date,
  rawDataJson: string,
): unknown[] {
  return [
    eventId ?? null, site, data.externalCode ?? null, url, data.lotNumber ?? null, data.title,
    data.brand ?? null, data.model ?? null, data.manufactureYear ?? null, data.modelYear ?? null,
    data.mileage ?? null, data.runningAtEntry ?? null, data.origin ?? null, data.consignor ?? null,
    data.city, data.state, data.address, data.yardName ?? null, data.observations ?? null,
    data.saleStatus ?? null, data.currentBid, data.nextBid, data.finalBid ?? null,
    data.commissionFee ?? null, data.buyerFee ?? null, data.otherFees ?? null, data.totalCost ?? null,
    data.auctionStart ?? null, data.auctionEnd, data.soldAt ?? null, now, scheduling.nextCheckAt,
    scheduling.finalizedAt ?? null, rawDataJson, data.bidderAlias ?? null,
    data.classification ?? null, data.sourceAnnouncementId ?? null, data.displayStatus ?? null,
    data.salePhase ?? null, data.saleResult ?? null, data.bidCount ?? null, data.color ?? null,
    data.fuel ?? null, data.transmission ?? null, data.plateFinal ?? null, data.plateState ?? null,
    data.airConditioning ?? null, data.steering ?? null, data.keyAvailable ?? null,
    data.locks ?? null, data.windows ?? null, data.assetType ?? null,
  ];
}

function stableId(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function serializeChangeValue(value: unknown, type: 'money' | 'status' | 'datetime'): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (type === 'money') {
    const number = Number(value);
    return Number.isFinite(number) ? number.toFixed(2) : String(value);
  }
  if (type === 'datetime') {
    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
  }
  return String(value);
}
