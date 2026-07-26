import type { Pool, QueryResult } from 'pg';

export interface DashboardFilters {
  search?: string;
  sites?: string[];
  assetTypes?: string[];
  eventIds?: number[];
  statuses?: string[];
  brands?: string[];
  models?: string[];
  years?: number[];
  states?: string[];
  cities?: string[];
  neighborhoods?: string[];
  propertyTypes?: string[];
  vehicleConditions?: string[];
  origins?: string[];
  consignors?: string[];
  classifications?: string[];
  fuels?: string[];
  transmissions?: string[];
  runningAtEntry?: boolean;
  eventDateFrom?: string;
  eventDateTo?: string;
  endingWindowDays?: number;
  cursor?: string;
  sort?: LotSort;
  page: number;
  pageSize: number;
}

export type LotSort = 'auction_nearest' | 'auction_desc' | 'auction_asc' | 'year_desc' | 'year_asc' | 'brand_asc' | 'brand_desc';

interface AuctionCursor {
  bucket: number;
  time: number;
  lotNumber: number;
  id: number;
}

export type LotFacetKey = 'site' | 'assetType' | 'event' | 'status' | 'brand' | 'model' | 'year' | 'state' |
  'city' | 'neighborhood' | 'propertyType' | 'vehicleCondition' | 'origin' | 'consignor' | 'classification' | 'fuel' | 'transmission' | 'runningAtEntry';

export interface LotFacetOption {
  value: string;
  label: string;
  count: number;
}

export interface OperationProblemsFilters {
  queues: Array<'revalidation' | 'images' | 'documents'>;
  statuses: Array<'pending' | 'failed' | 'exhausted'>;
  site?: string;
  minAgeMinutes: number;
  limit: number;
  offset: number;
}

class DashboardQueryCache<T> {
  private readonly values = new Map<string, { expiresAt: number; value: T }>();
  private readonly pending = new Map<string, Promise<T>>();

  public constructor(private readonly ttlMs = 30_000, private readonly maxEntries = 100) {}

  public async get(key: string, loader: () => Promise<T>): Promise<T> {
    const cached = this.values.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      this.values.delete(key);
      this.values.set(key, cached);
      return cached.value;
    }
    if (cached) this.values.delete(key);
    const existing = this.pending.get(key);
    if (existing) return existing;
    const pending = loader().then((value) => {
      this.values.set(key, { expiresAt: Date.now() + this.ttlMs, value });
      while (this.values.size > this.maxEntries) {
        const oldest = this.values.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        this.values.delete(oldest);
      }
      return value;
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, pending);
    return pending;
  }

  public clear(): void {
    this.values.clear();
  }
}

function dashboardCacheKey(filters: DashboardFilters): string {
  const normalized = Object.fromEntries(Object.entries(filters)
    .filter(([key, value]) => !['page', 'pageSize', 'sort', 'cursor'].includes(key) && value !== undefined)
    .map(([key, value]) => [key, Array.isArray(value) ? [...value].sort() : value]));
  return JSON.stringify(normalized);
}

async function cancellableQuery<T extends Record<string, unknown>>(
  pool: Pool,
  text: string,
  params: unknown[],
  signal?: AbortSignal,
): Promise<QueryResult<T>> {
  if (!signal) return pool.query<T>(text, params);
  if (signal.aborted) throw new DOMException('Request aborted', 'AbortError');
  const client = await pool.connect();
  try {
    return await new Promise<QueryResult<T>>((resolve, reject) => {
      let query: unknown;
      const onAbort = () => {
        if (query) (client as unknown as { cancel: (target: unknown, query: unknown) => void }).cancel(client, query);
      };
      signal.addEventListener('abort', onAbort, { once: true });
      query = (client as unknown as {
        query: (
          queryText: string,
          values: unknown[],
          callback: (error: Error | null, result: QueryResult<T>) => void,
        ) => unknown;
      }).query(text, params, (error, result) => {
        signal.removeEventListener('abort', onAbort);
        if (error) reject(signal.aborted ? new DOMException('Request aborted', 'AbortError') : error);
        else resolve(result);
      });
      if (signal.aborted) onAbort();
    });
  } finally {
    client.release();
  }
}

function businessStatusSql(lotAlias: string): string {
  return `CASE WHEN ${lotAlias}.site = 'vipleiloes'
    THEN COALESCE(${lotAlias}.display_status, ${lotAlias}.sale_status)
    ELSE CASE
    WHEN ${lotAlias}.sale_status = 'LiberadoLeilao' THEN 'Aberto para Lances'
    WHEN ${lotAlias}.sale_status = 'NaoArrematado' THEN 'Não Arrematado'
    WHEN ${lotAlias}.sale_status = 'Condicional' THEN 'Condicional - Aguardando aprovação'
    WHEN ${lotAlias}.sale_status IN ('CondicionalNegada', 'NegadaCondicional') THEN 'Condicional - Negada'
    WHEN ${lotAlias}.sale_status IN ('AgPagamento', 'Pago') THEN
      CASE WHEN EXISTS (
        SELECT 1 FROM lot_snapshots status_history
        WHERE status_history.market_lot_id = ${lotAlias}.id
          AND status_history.sale_status = 'Condicional'
      ) THEN 'Condicional - Aprovada' ELSE 'Arrematado' END
    WHEN ${lotAlias}.sale_status IN ('Vendido', 'Arrematado') THEN 'Arrematado'
    ELSE ${lotAlias}.sale_status
    END
  END`;
}

function canonicalStatusSql(lotAlias: string): string {
  return `${lotAlias}.canonical_status`;
}

function buildLotWhere(filters: DashboardFilters, omittedFacet?: LotFacetKey): { where: string; params: unknown[] } {
  const conditions = ['1=1'];
  const params: unknown[] = [];
  const addParam = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };
  const addList = (
    facet: LotFacetKey,
    column: string,
    values: Array<string | number> | undefined,
    cast: 'text' | 'int' | 'bigint' = 'text',
  ): void => {
    if (omittedFacet === facet || !values?.length) return;
    conditions.push(`${column} = ANY(${addParam(values)}::${cast}[])`);
  };

  if (filters.search) {
    const placeholder = addParam(`%${filters.search}%`);
    conditions.push(`(
      ml.title ILIKE ${placeholder} OR ml.brand ILIKE ${placeholder} OR ml.model ILIKE ${placeholder} OR
      ml.consignor ILIKE ${placeholder} OR ml.external_code ILIKE ${placeholder} OR ml.lot_number ILIKE ${placeholder}
    )`);
  }
  addList('site', 'ml.site', filters.sites);
  addList('assetType', 'ml.asset_type', filters.assetTypes);
  addList('event', 'ml.event_id', filters.eventIds, 'bigint');
  addList('status', canonicalStatusSql('ml'), filters.statuses);
  addList('brand', 'ml.brand', filters.brands);
  addList('model', 'ml.model', filters.models);
  addList('year', 'ml.model_year', filters.years, 'int');
  addList('state', 'ml.state', filters.states);
  addList('city', 'ml.city', filters.cities);
  if (omittedFacet !== 'neighborhood' && filters.neighborhoods?.length) {
    conditions.push(`EXISTS (SELECT 1 FROM real_estate_details red WHERE red.market_lot_id=ml.id
      AND red.neighborhood_normalized = ANY(${addParam(filters.neighborhoods)}::text[]))`);
  }
  if (omittedFacet !== 'propertyType' && filters.propertyTypes?.length) {
    conditions.push(`EXISTS (SELECT 1 FROM real_estate_details red WHERE red.market_lot_id=ml.id
      AND red.property_type = ANY(${addParam(filters.propertyTypes)}::text[]))`);
  }
  if (omittedFacet !== 'vehicleCondition' && filters.vehicleConditions?.length) {
    conditions.push(`EXISTS (SELECT 1 FROM vehicle_details vd WHERE vd.market_lot_id=ml.id
      AND vd.vehicle_condition = ANY(${addParam(filters.vehicleConditions)}::text[]))`);
  }
  addList('origin', 'ml.origin', filters.origins);
  addList('consignor', 'ml.consignor', filters.consignors);
  addList('classification', 'ml.classification', filters.classifications);
  addList('fuel', 'ml.fuel', filters.fuels);
  addList('transmission', 'ml.transmission', filters.transmissions);
  if (omittedFacet !== 'runningAtEntry' && filters.runningAtEntry !== undefined) {
    conditions.push(`ml.running_at_entry = ${addParam(filters.runningAtEntry)}`);
  }
  if (filters.eventDateFrom) {
    conditions.push(`(COALESCE(ml.auction_start,ml.auction_end) AT TIME ZONE 'America/Sao_Paulo')::date >= ${addParam(filters.eventDateFrom)}::date`);
  }
  if (filters.eventDateTo) {
    conditions.push(`(COALESCE(ml.auction_start,ml.auction_end) AT TIME ZONE 'America/Sao_Paulo')::date <= ${addParam(filters.eventDateTo)}::date`);
  }
  if (filters.endingWindowDays) {
    const days = addParam(filters.endingWindowDays);
    conditions.push(`ml.auction_end BETWEEN NOW() - (${days}::int * INTERVAL '1 day') AND NOW() + (${days}::int * INTERVAL '1 day')`);
  }
  return { where: conditions.join(' AND '), params };
}

function lotOrderBy(sort: LotSort | undefined): string {
  const lotNumber = "NULLIF(regexp_replace(ml.lot_number, '\\D', '', 'g'), '')::int ASC NULLS LAST";
  switch (sort) {
    case 'auction_nearest':
      return `CASE
        WHEN ml.auction_end >= NOW() THEN 0
        WHEN ml.auction_end < NOW() THEN 1
        ELSE 2
      END ASC,
      CASE WHEN ml.auction_end >= NOW() THEN ml.auction_end END ASC NULLS LAST,
      CASE WHEN ml.auction_end < NOW() THEN ml.auction_end END DESC NULLS LAST,${lotNumber}`;
    case 'auction_asc': return `COALESCE(ml.auction_start,ml.auction_end) ASC NULLS LAST,${lotNumber}`;
    case 'year_desc': return `ml.model_year DESC NULLS LAST,ml.manufacture_year DESC NULLS LAST,ml.brand ASC NULLS LAST,ml.model ASC NULLS LAST,${lotNumber}`;
    case 'year_asc': return `ml.model_year ASC NULLS LAST,ml.manufacture_year ASC NULLS LAST,ml.brand ASC NULLS LAST,ml.model ASC NULLS LAST,${lotNumber}`;
    case 'brand_asc': return `ml.brand ASC NULLS LAST,ml.model ASC NULLS LAST,ml.model_year DESC NULLS LAST,${lotNumber}`;
    case 'brand_desc': return `ml.brand DESC NULLS LAST,ml.model DESC NULLS LAST,ml.model_year DESC NULLS LAST,${lotNumber}`;
    default: return lotOrderBy('auction_nearest');
  }
}

function decodeAuctionCursor(value: string | undefined): AuctionCursor | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<AuctionCursor>;
    if (![parsed.bucket, parsed.time, parsed.lotNumber, parsed.id].every(Number.isFinite)) return undefined;
    return parsed as AuctionCursor;
  } catch {
    return undefined;
  }
}

function encodeAuctionCursor(row: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify({
    bucket: Number(row._sortBucket),
    time: Number(row._sortTime),
    lotNumber: Number(row._sortLotNumber),
    id: Number(row.id),
  })).toString('base64url');
}

export class DashboardRepository {
  private readonly statsCache = new DashboardQueryCache<Record<string, unknown>>();
  private readonly facetsCache = new DashboardQueryCache<{
    total: number; facets: Record<LotFacetKey, LotFacetOption[]>;
  }>();

  public constructor(private readonly pool: Pool) {}

  public invalidateCaches(): void {
    this.statsCache.clear();
    this.facetsCache.clear();
  }

  public async stats(filters: DashboardFilters): Promise<Record<string, unknown>> {
    return this.statsCache.get(dashboardCacheKey(filters), () => this.loadStats(filters));
  }

  private async loadStats(filters: DashboardFilters): Promise<Record<string, unknown>> {
    const query = buildLotWhere(filters);
    const result = await this.pool.query<Record<string, unknown>>(`
      WITH filtered AS MATERIALIZED (
        SELECT ml.id,ml.event_id,ml.auction_end,ml.final_bid,ml.current_bid,ml.last_seen_at
        FROM market_lots ml WHERE ${query.where}
      ), filtered_media AS MATERIALIZED (
        SELECT lm.type,lm.download_status,lm.size_bytes,lm.content_hash,lm.source_url,lm.storage_key
        FROM lot_media lm
        JOIN filtered f ON f.id=lm.market_lot_id
      ), lot_stats AS (
        SELECT
          COUNT(*)::int AS "totalLots",
          COUNT(DISTINCT event_id)::int AS "totalEvents",
          COUNT(*) FILTER (WHERE auction_end > NOW())::int AS "activeLots",
          COUNT(*) FILTER (WHERE auction_end <= NOW())::int AS "endedLots",
          COUNT(*) FILTER (WHERE final_bid IS NOT NULL)::int AS "lotsWithResult",
          ROUND(AVG(current_bid) FILTER (WHERE current_bid > 0), 2)::float AS "averageBid",
          MAX(last_seen_at) AS "lastUpdatedAt"
        FROM filtered
      ), media_stats AS (
        SELECT
          COALESCE(SUM(summary.total_media),0)::int AS "totalMedia",
          COALESCE(SUM(summary.total_images),0)::int AS "totalImages",
          COALESCE(SUM(summary.downloaded_images),0)::int AS "downloadedImages",
          COALESCE(SUM(summary.image_bytes),0)::float AS "imageBytes"
        FROM filtered
        JOIN lot_media_summary summary ON summary.market_lot_id=filtered.id
      ), document_stats AS (
        SELECT
          COUNT(DISTINCT COALESCE(content_hash,source_url)) FILTER (
            WHERE type='document'
          )::int AS "totalDocuments",
          COUNT(DISTINCT storage_key) FILTER (
            WHERE type='document' AND download_status='downloaded'
          )::int AS "downloadedDocuments"
        FROM filtered_media
      ), stored_media AS (
        SELECT storage_key,MAX(size_bytes)::float AS size_bytes,
          BOOL_OR(type='document') AS is_document
        FROM filtered_media
        WHERE download_status='downloaded' AND storage_key IS NOT NULL
        GROUP BY storage_key
      ), storage_stats AS (
        SELECT
          COALESCE(SUM(size_bytes) FILTER (WHERE is_document),0)::float AS "documentBytes",
          COALESCE(SUM(size_bytes),0)::float AS "mediaBytes"
        FROM stored_media
      )
      SELECT lot_stats.*,media_stats.*,document_stats.*,storage_stats.*
      FROM lot_stats CROSS JOIN media_stats CROSS JOIN document_stats CROSS JOIN storage_stats
    `, query.params);
    return result.rows[0] ?? {};
  }

  public async sites(): Promise<unknown[]> {
    const result = await this.pool.query(`
      SELECT site, COUNT(*)::int AS "lotCount" FROM market_lots GROUP BY site ORDER BY site
    `);
    return result.rows;
  }

  public async integrationStats(): Promise<unknown[]> {
    const result = await this.pool.query(`
      WITH lot_stats AS (
        SELECT site,COUNT(*)::int AS "lotCount",MAX(last_seen_at) AS "lastSeenAt",
          COUNT(*) FILTER (WHERE auction_end > NOW())::int AS "activeLots",
          COUNT(DISTINCT event_id)::int AS "eventCount",
          ARRAY_REMOVE(ARRAY_AGG(DISTINCT asset_type),NULL) AS "assetTypes"
        FROM market_lots GROUP BY site
      ), latest_runs AS (
        SELECT DISTINCT ON (site) site,status,started_at AS "startedAt",finished_at AS "finishedAt",
          discovered_count AS "discoveredCount",new_count AS "newCount",updated_count AS "updatedCount",
          failed_count AS "failedCount",error
        FROM collection_runs WHERE site IS NOT NULL ORDER BY site,started_at DESC
      )
      SELECT COALESCE(ls.site,lr.site) AS site,COALESCE(ls."lotCount",0)::int AS "lotCount",
        COALESCE(ls."activeLots",0)::int AS "activeLots",COALESCE(ls."eventCount",0)::int AS "eventCount",
        COALESCE(ls."assetTypes",ARRAY[]::text[]) AS "assetTypes",ls."lastSeenAt",
        lr.status AS "lastRunStatus",lr."startedAt" AS "lastRunStartedAt",lr."finishedAt" AS "lastRunFinishedAt",
        lr."discoveredCount",lr."newCount",lr."updatedCount",lr."failedCount",lr.error AS "lastError"
      FROM lot_stats ls FULL JOIN latest_runs lr ON lr.site=ls.site ORDER BY site
    `);
    return result.rows;
  }

  public async catalogs(): Promise<unknown[]> {
    const result = await this.pool.query(`
      SELECT CASE WHEN asset_type='real_estate' THEN 'real_estate' ELSE 'vehicles' END AS catalog,
        COUNT(*)::int AS "lotCount"
      FROM market_lots
      GROUP BY CASE WHEN asset_type='real_estate' THEN 'real_estate' ELSE 'vehicles' END
      ORDER BY catalog
    `);
    return result.rows;
  }

  public async storageStats(site?: string): Promise<unknown> {
    const [objects, migrations] = await Promise.all([
      this.pool.query(`
        SELECT stored.type, stored.storage_provider AS "storageProvider", stored.storage_tier AS "storageTier",
          COUNT(*)::int AS "objectCount", COALESCE(SUM(stored.size_bytes),0)::bigint AS "sizeBytes",
          MIN(stored.first_seen_at) AS "oldestObject", MAX(stored.last_accessed_at) AS "lastAccess"
        FROM (
          SELECT DISTINCT ON (lm.storage_key) lm.type,lm.storage_provider,lm.storage_tier,
            lm.size_bytes,lm.first_seen_at,lm.last_accessed_at,lm.storage_key
          FROM lot_media lm JOIN market_lots ml ON ml.id=lm.market_lot_id
          WHERE lm.download_status='downloaded' AND lm.storage_key IS NOT NULL
            AND ($1::text IS NULL OR ml.site=$1)
          ORDER BY lm.storage_key,lm.id
        ) stored
        GROUP BY stored.type, stored.storage_provider, stored.storage_tier
        ORDER BY storage_tier, type
      `, [site ?? null]),
      this.pool.query(`
        SELECT status, COUNT(*)::int AS count
        FROM storage_migrations GROUP BY status ORDER BY status
      `),
    ]);
    return { objects: objects.rows, migrations: migrations.rows };
  }

  public async storageUsage(days = 30, site?: string): Promise<unknown> {
    const params = [days, site ?? null];
    const where = `bucket_hour>=NOW()-($1::int * INTERVAL '1 day') AND ($2::text IS NULL OR site=$2)`;
    const [summary, daily, bySite, period] = await Promise.all([
      this.pool.query(`
        SELECT operation,media_type AS "mediaType",success,
          SUM(request_count)::bigint AS "requestCount",
          SUM(bytes_in)::bigint AS "bytesIn",SUM(bytes_out)::bigint AS "bytesOut"
        FROM object_storage_metrics WHERE ${where}
        GROUP BY operation,media_type,success ORDER BY operation,media_type,success DESC
      `, params),
      this.pool.query(`
        SELECT bucket_hour::date AS day,
          SUM(request_count) FILTER (WHERE operation='put')::bigint AS puts,
          SUM(request_count) FILTER (WHERE operation='get')::bigint AS gets,
          SUM(request_count) FILTER (WHERE operation='head')::bigint AS heads,
          SUM(request_count) FILTER (WHERE NOT success AND operation<>'head')::bigint AS failures,
          SUM(bytes_in)::bigint AS "bytesIn",SUM(bytes_out)::bigint AS "bytesOut"
        FROM object_storage_metrics WHERE ${where}
        GROUP BY bucket_hour::date ORDER BY day
      `, params),
      this.pool.query(`
        SELECT site,SUM(request_count)::bigint AS "requestCount",
          SUM(request_count) FILTER (WHERE operation='put')::bigint AS puts,
          SUM(request_count) FILTER (WHERE operation IN ('get','head'))::bigint AS "tier2Requests",
          SUM(bytes_in)::bigint AS "bytesIn",SUM(bytes_out)::bigint AS "bytesOut"
        FROM object_storage_metrics WHERE ${where}
        GROUP BY site ORDER BY SUM(request_count) DESC
      `, params),
      this.pool.query(`
        SELECT MIN(bucket_hour) AS "observedSince",MAX(bucket_hour) AS "observedUntil",
          COUNT(DISTINCT bucket_hour)::int AS "hoursWithActivity"
        FROM object_storage_metrics WHERE ${where}
      `, params),
    ]);
    return {
      days, site: site ?? null, summary: summary.rows, daily: daily.rows, bySite: bySite.rows,
      period: period.rows[0],
    };
  }

  public async collectionRuns(site?: string, limit = 10): Promise<unknown[]> {
    const result = await this.pool.query(`
      SELECT cr.id::int, COALESCE(cr.site, cs.site) AS site,
        cr.started_at AS "startedAt", cr.finished_at AS "finishedAt", cr.status,
        cr.discovered_count AS "discoveredCount", cr.collected_count AS "collectedCount",
        cr.new_count AS "newCount", cr.updated_count AS "updatedCount",
        cr.unchanged_count AS "unchangedCount", cr.failed_count AS "failedCount", cr.error
      FROM collection_runs cr
      LEFT JOIN collection_sources cs ON cs.id = cr.source_id
      WHERE ($1::text IS NULL OR COALESCE(cr.site, cs.site) = $1)
      ORDER BY cr.started_at DESC
      LIMIT $2
    `, [site ?? null, limit]);
    return result.rows;
  }

  public async operationQueues(site?: string): Promise<{ queues: unknown[]; sites: string[] }> {
    const mediaQueue = async (type: 'image' | 'document', queue: string) => {
      const result = await this.pool.query(`
        SELECT $2::text AS queue,
          COUNT(*) FILTER (WHERE lm.download_status IN ('pending','failed','metadata_only') AND lm.download_attempts<4)::int AS pending,
          COUNT(*) FILTER (WHERE lm.download_status='processing')::int AS processing,
          COUNT(*) FILTER (WHERE lm.download_status='failed' AND lm.download_attempts<4)::int AS failed,
          COUNT(*) FILTER (WHERE lm.download_status NOT IN ('downloaded','unavailable') AND lm.download_attempts>=4)::int AS exhausted,
          MIN(lm.first_seen_at) FILTER (WHERE lm.download_status NOT IN ('downloaded','unavailable')) AS "oldestAt",
          COUNT(*) FILTER (WHERE lm.downloaded_at>=NOW()-INTERVAL '1 hour')::int AS "throughput1h",
          COUNT(*) FILTER (WHERE lm.downloaded_at>=NOW()-INTERVAL '24 hours')::int AS "throughput24h",
          percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (lm.processing_finished_at-lm.processing_started_at)))
            FILTER (WHERE lm.processing_finished_at IS NOT NULL AND lm.processing_started_at IS NOT NULL) AS "cycleP50Seconds",
          percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (lm.processing_finished_at-lm.processing_started_at)))
            FILTER (WHERE lm.processing_finished_at IS NOT NULL AND lm.processing_started_at IS NOT NULL) AS "cycleP95Seconds",
          percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (lm.downloaded_at-lm.first_seen_at)))
            FILTER (WHERE lm.downloaded_at IS NOT NULL) AS "leadP50Seconds",
          percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (lm.downloaded_at-lm.first_seen_at)))
            FILTER (WHERE lm.downloaded_at IS NOT NULL) AS "leadP95Seconds"
        FROM lot_media lm JOIN market_lots ml ON ml.id=lm.market_lot_id
        WHERE lm.type=$3 AND ($1::text IS NULL OR ml.site=$1)
      `, [site ?? null, queue, type]);
      return result.rows[0];
    };
    const [revalidation, images, documents, sites] = await Promise.all([
      this.pool.query(`
        SELECT 'revalidation' AS queue,
          COUNT(*) FILTER (WHERE finalized_at IS NULL AND next_check_at<=NOW()
            AND NOT (revalidation_started_at IS NOT NULL AND revalidation_finished_at IS NULL)
            AND revalidation_error IS NULL AND consecutive_failures<6)::int AS pending,
          COUNT(*) FILTER (WHERE finalized_at IS NULL
            AND revalidation_started_at IS NOT NULL AND revalidation_finished_at IS NULL)::int AS processing,
          COUNT(*) FILTER (WHERE finalized_at IS NULL
            AND NOT (revalidation_started_at IS NOT NULL AND revalidation_finished_at IS NULL)
            AND revalidation_error IS NOT NULL AND consecutive_failures<6)::int AS failed,
          COUNT(*) FILTER (WHERE finalized_at IS NULL
            AND NOT (revalidation_started_at IS NOT NULL AND revalidation_finished_at IS NULL)
            AND consecutive_failures>=6)::int AS exhausted,
          MIN(next_check_at) FILTER (WHERE finalized_at IS NULL AND next_check_at<=NOW()
            AND NOT (revalidation_started_at IS NOT NULL AND revalidation_finished_at IS NULL)
            AND revalidation_error IS NULL AND consecutive_failures<6) AS "oldestAt",
          COUNT(*) FILTER (WHERE revalidation_finished_at>=NOW()-INTERVAL '1 hour')::int AS "throughput1h",
          COUNT(*) FILTER (WHERE revalidation_finished_at>=NOW()-INTERVAL '24 hours')::int AS "throughput24h",
          percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (revalidation_finished_at-revalidation_started_at)))
            FILTER (WHERE revalidation_finished_at IS NOT NULL AND revalidation_started_at IS NOT NULL) AS "cycleP50Seconds",
          percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (revalidation_finished_at-revalidation_started_at)))
            FILTER (WHERE revalidation_finished_at IS NOT NULL AND revalidation_started_at IS NOT NULL) AS "cycleP95Seconds",
          percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (revalidation_finished_at-revalidation_due_at)))
            FILTER (WHERE revalidation_finished_at IS NOT NULL AND revalidation_due_at IS NOT NULL) AS "leadP50Seconds",
          percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (revalidation_finished_at-revalidation_due_at)))
            FILTER (WHERE revalidation_finished_at IS NOT NULL AND revalidation_due_at IS NOT NULL) AS "leadP95Seconds"
        FROM market_lots WHERE ($1::text IS NULL OR site=$1)
      `, [site ?? null]),
      mediaQueue('image', 'images'),
      mediaQueue('document', 'documents'),
      this.pool.query<{ site: string }>('SELECT DISTINCT site FROM market_lots ORDER BY site'),
    ]);
    return { queues: [revalidation.rows[0], images, documents], sites: sites.rows.map((row) => row.site) };
  }

  public async operationItems(queue: string, status: string | undefined, site: string | undefined, limit = 100): Promise<unknown[]> {
    if (queue === 'revalidation') {
      const result = await this.pool.query(`
        SELECT id::int,'revalidation' AS queue,site,url,title,
          CASE WHEN revalidation_started_at IS NOT NULL AND revalidation_finished_at IS NULL THEN 'processing'
            WHEN consecutive_failures>=6 THEN 'exhausted' WHEN revalidation_error IS NOT NULL THEN 'failed'
            WHEN next_check_at<=NOW() THEN 'pending' ELSE 'scheduled' END AS status,
          consecutive_failures AS attempts,next_check_at AS "queuedAt",revalidation_started_at AS "startedAt",
          revalidation_finished_at AS "finishedAt",revalidation_error AS "lastError",
          GREATEST(0,EXTRACT(EPOCH FROM (NOW()-next_check_at)))::float AS "ageSeconds",
          EXTRACT(EPOCH FROM (revalidation_finished_at-revalidation_started_at))::float AS "cycleSeconds",
          EXTRACT(EPOCH FROM (revalidation_finished_at-revalidation_due_at))::float AS "leadSeconds"
        FROM market_lots
        WHERE finalized_at IS NULL
          AND ($1::text IS NULL OR site=$1) AND ($2::text IS NULL OR $2=CASE
          WHEN revalidation_started_at IS NOT NULL AND revalidation_finished_at IS NULL THEN 'processing'
          WHEN consecutive_failures>=6 THEN 'exhausted' WHEN revalidation_error IS NOT NULL THEN 'failed'
          WHEN next_check_at<=NOW() THEN 'pending' ELSE 'scheduled' END)
          AND ($2::text IS NOT NULL OR next_check_at<=NOW() OR revalidation_error IS NOT NULL)
        ORDER BY next_check_at LIMIT $3
      `, [site ?? null, status ?? null, limit]);
      return result.rows;
    }
    const type = queue === 'documents' ? 'document' : queue === 'images' ? 'image' : undefined;
    if (!type) return [];
    const result = await this.pool.query(`
      SELECT lm.id::int,$1::text AS queue,ml.site,ml.url,ml.title,
        CASE WHEN lm.download_status='processing' THEN 'processing'
          WHEN lm.download_attempts>=4 AND lm.download_status NOT IN ('downloaded','unavailable') THEN 'exhausted'
          WHEN lm.download_status='failed' THEN 'failed'
          WHEN lm.download_status IN ('pending','metadata_only') THEN 'pending' ELSE lm.download_status END AS status,
        lm.download_attempts AS attempts,lm.first_seen_at AS "queuedAt",lm.processing_started_at AS "startedAt",
        lm.processing_finished_at AS "finishedAt",lm.download_error AS "lastError",
        EXTRACT(EPOCH FROM (COALESCE(lm.downloaded_at,NOW())-lm.first_seen_at))::float AS "ageSeconds",
        EXTRACT(EPOCH FROM (lm.processing_finished_at-lm.processing_started_at))::float AS "cycleSeconds",
        EXTRACT(EPOCH FROM (lm.downloaded_at-lm.first_seen_at))::float AS "leadSeconds"
      FROM lot_media lm JOIN market_lots ml ON ml.id=lm.market_lot_id
      WHERE lm.type=$2 AND ($3::text IS NULL OR ml.site=$3)
        AND ($4::text IS NULL OR $4=CASE WHEN lm.download_status='processing' THEN 'processing'
          WHEN lm.download_attempts>=4 AND lm.download_status NOT IN ('downloaded','unavailable') THEN 'exhausted'
          WHEN lm.download_status='failed' THEN 'failed'
          WHEN lm.download_status IN ('pending','metadata_only') THEN 'pending' ELSE lm.download_status END)
        AND ($4::text IS NOT NULL OR lm.download_status NOT IN ('downloaded','unavailable'))
      ORDER BY lm.first_seen_at LIMIT $5
    `, [queue, type, site ?? null, status ?? null, limit]);
    return result.rows;
  }

  public async operationProblems(filters: OperationProblemsFilters): Promise<Record<string, unknown>> {
    const params = [
      filters.queues,
      filters.statuses,
      filters.site ?? null,
      filters.minAgeMinutes * 60,
    ];
    const queueCte = `
      WITH problem_items AS (
        SELECT ml.id::int AS id,'revalidation'::text AS queue,ml.site,ml.url,NULL::text AS source_url,ml.title,
          CASE
            WHEN ml.consecutive_failures>=6 THEN 'exhausted'
            WHEN ml.revalidation_error IS NOT NULL THEN 'failed'
            ELSE 'pending'
          END::text AS status,
          ml.consecutive_failures::int AS attempts,
          ml.next_check_at AS queued_at,
          ml.revalidation_started_at AS started_at,
          ml.revalidation_finished_at AS finished_at,
          ml.revalidation_finished_at AS last_attempt_at,
          ml.revalidation_error AS last_error,
          CASE
            WHEN ml.revalidation_error IS NOT NULL OR ml.consecutive_failures>=6
              THEN COALESCE(ml.revalidation_finished_at,ml.next_check_at)
            ELSE ml.next_check_at
          END AS stalled_since,
          GREATEST(0,EXTRACT(EPOCH FROM (NOW()-CASE
            WHEN ml.revalidation_error IS NOT NULL OR ml.consecutive_failures>=6
              THEN COALESCE(ml.revalidation_finished_at,ml.next_check_at)
            ELSE ml.next_check_at
          END)))::float AS age_seconds,
          EXTRACT(EPOCH FROM (ml.revalidation_finished_at-ml.revalidation_started_at))::float AS cycle_seconds,
          EXTRACT(EPOCH FROM (ml.revalidation_finished_at-ml.revalidation_due_at))::float AS lead_seconds
        FROM market_lots ml
        WHERE ml.finalized_at IS NULL
          AND (ml.next_check_at<=NOW() OR ml.revalidation_error IS NOT NULL OR ml.consecutive_failures>=6)

        UNION ALL

        SELECT lm.id::int AS id,
          CASE WHEN lm.type='document' THEN 'documents' ELSE 'images' END::text AS queue,
          ml.site,ml.url,lm.source_url,ml.title,
          CASE
            WHEN lm.download_attempts>=4 AND lm.download_status NOT IN ('downloaded','unavailable') THEN 'exhausted'
            WHEN lm.download_status='failed' THEN 'failed'
            ELSE 'pending'
          END::text AS status,
          lm.download_attempts::int AS attempts,
          lm.first_seen_at AS queued_at,
          lm.processing_started_at AS started_at,
          lm.processing_finished_at AS finished_at,
          COALESCE(lm.last_attempt_at,lm.processing_finished_at) AS last_attempt_at,
          lm.download_error AS last_error,
          CASE
            WHEN lm.download_status='failed' OR lm.download_attempts>=4
              THEN COALESCE(lm.last_attempt_at,lm.processing_finished_at,lm.first_seen_at)
            ELSE lm.first_seen_at
          END AS stalled_since,
          GREATEST(0,EXTRACT(EPOCH FROM (NOW()-CASE
            WHEN lm.download_status='failed' OR lm.download_attempts>=4
              THEN COALESCE(lm.last_attempt_at,lm.processing_finished_at,lm.first_seen_at)
            ELSE lm.first_seen_at
          END)))::float AS age_seconds,
          EXTRACT(EPOCH FROM (lm.processing_finished_at-lm.processing_started_at))::float AS cycle_seconds,
          EXTRACT(EPOCH FROM (lm.downloaded_at-lm.first_seen_at))::float AS lead_seconds
        FROM lot_media lm
        JOIN market_lots ml ON ml.id=lm.market_lot_id
        WHERE lm.type IN ('image','document')
          AND lm.download_status IN ('pending','failed','metadata_only')
      ),
      filtered AS (
        SELECT * FROM problem_items
        WHERE queue=ANY($1::text[])
          AND status=ANY($2::text[])
          AND ($3::text IS NULL OR site=$3)
          AND age_seconds >= $4::int
      )
    `;
    const [summary, items] = await Promise.all([
      this.pool.query<{
        total: number;
        byStatus: unknown[];
        byQueue: unknown[];
        bySite: unknown[];
        topErrors: unknown[];
      }>(`${queueCte}
        SELECT
          (SELECT COUNT(*)::int FROM filtered) AS total,
          (SELECT COALESCE(json_agg(row_to_json(grouped)),'[]'::json) FROM (
            SELECT status,COUNT(*)::int AS count
            FROM filtered GROUP BY status ORDER BY count DESC
          ) grouped) AS "byStatus",
          (SELECT COALESCE(json_agg(row_to_json(grouped)),'[]'::json) FROM (
            SELECT queue,COUNT(*)::int AS count,MIN(stalled_since) AS "oldestAt"
            FROM filtered GROUP BY queue ORDER BY count DESC
          ) grouped) AS "byQueue",
          (SELECT COALESCE(json_agg(row_to_json(grouped)),'[]'::json) FROM (
            SELECT site,COUNT(*)::int AS count
            FROM filtered GROUP BY site ORDER BY count DESC,site LIMIT 50
          ) grouped) AS "bySite",
          (SELECT COALESCE(json_agg(row_to_json(grouped)),'[]'::json) FROM (
            SELECT regexp_replace(last_error,'https?://[^ ]+','<url>','g') AS error,
              COUNT(*)::int AS count
            FROM filtered WHERE NULLIF(BTRIM(last_error),'') IS NOT NULL
            GROUP BY regexp_replace(last_error,'https?://[^ ]+','<url>','g')
            ORDER BY count DESC,error LIMIT 20
          ) grouped) AS "topErrors"
      `, params),
      this.pool.query(`${queueCte}
        SELECT id,queue,site,url,source_url AS "sourceUrl",title,status,attempts,
          queued_at AS "queuedAt",started_at AS "startedAt",finished_at AS "finishedAt",
          last_attempt_at AS "lastAttemptAt",stalled_since AS "stalledSince",
          last_error AS "lastError",age_seconds AS "ageSeconds",
          cycle_seconds AS "cycleSeconds",lead_seconds AS "leadSeconds"
        FROM filtered
        ORDER BY CASE status WHEN 'exhausted' THEN 0 WHEN 'failed' THEN 1 ELSE 2 END,
          age_seconds DESC,id
        LIMIT $5 OFFSET $6`, [...params, filters.limit, filters.offset]),
    ]);
    const totals = summary.rows[0] ?? {
      total: 0, byStatus: [], byQueue: [], bySite: [], topErrors: [],
    };
    const totalCount = totals.total;
    return {
      generatedAt: new Date().toISOString(),
      filters: {
        queues: filters.queues,
        statuses: filters.statuses,
        site: filters.site ?? null,
        minAgeMinutes: filters.minAgeMinutes,
      },
      pagination: {
        limit: filters.limit,
        offset: filters.offset,
        total: totalCount,
        returned: items.rows.length,
        hasMore: filters.offset + items.rows.length < totalCount,
      },
      summary: {
        byStatus: totals.byStatus,
        byQueue: totals.byQueue,
        bySite: totals.bySite,
        topErrors: totals.topErrors,
      },
      items: items.rows,
    };
  }

  public async retryOperation(queue: string, id: number): Promise<boolean> {
    const result = queue === 'revalidation'
      ? await this.pool.query(`UPDATE market_lots SET next_check_at=NOW(),finalized_at=NULL,revalidation_error=NULL,
          consecutive_failures=0,revalidation_started_at=NULL,revalidation_finished_at=NULL WHERE id=$1`, [id])
      : await this.pool.query(`UPDATE lot_media SET download_status='pending',download_attempts=0,download_error=NULL,
          processing_started_at=NULL,processing_finished_at=NULL WHERE id=$1 AND type=$2`,
        [id, queue === 'documents' ? 'document' : 'image']);
    return (result.rowCount ?? 0) > 0;
  }

  public async events(site?: string): Promise<unknown[]> {
    const result = await this.pool.query(`
      SELECT
        ae.id::int, ae.external_code AS "externalCode", ae.name, ae.starts_at AS "startsAt",
        ae.ends_at AS "endsAt", ae.city, ae.state, COUNT(ml.id)::int AS "lotCount"
      FROM auction_events ae
      LEFT JOIN market_lots ml ON ml.event_id = ae.id
      WHERE ($1::text IS NULL OR ae.site = $1)
      GROUP BY ae.id
      ORDER BY COALESCE(ae.starts_at, ae.ends_at) DESC
    `, [site ?? null]);
    return result.rows;
  }

  public async lots(filters: DashboardFilters, signal?: AbortSignal): Promise<{
    items: unknown[]; total: number; page: number; pageSize: number; nextCursor?: string;
  }> {
    const { where, params } = buildLotWhere(filters);
    const totalResult = await cancellableQuery<{ total: number }>(
      this.pool,
      `SELECT COUNT(*)::int AS total FROM market_lots ml WHERE ${where}`,
      params,
      signal,
    );
    const cursor = decodeAuctionCursor(filters.cursor);
    const useKeyset = (!filters.sort || filters.sort === 'auction_nearest') && (filters.page === 1 || Boolean(cursor));
    const sortBucket = `CASE WHEN ml.auction_end>=NOW() THEN 0 WHEN ml.auction_end<NOW() THEN 1 ELSE 2 END`;
    const sortTime = `CASE
      WHEN ml.auction_end>=NOW() THEN EXTRACT(EPOCH FROM ml.auction_end)
      WHEN ml.auction_end<NOW() THEN -EXTRACT(EPOCH FROM ml.auction_end)
      ELSE 9000000000000000000
    END`;
    const sortLotNumber = `COALESCE(NULLIF(regexp_replace(ml.lot_number,'\\D','','g'),'')::int,2147483647)`;
    let cursorWhere = '';
    if (useKeyset && cursor) {
      params.push(cursor.bucket, cursor.time, cursor.lotNumber, cursor.id);
      const first = params.length - 3;
      cursorWhere = ` AND (${sortBucket},${sortTime},${sortLotNumber},ml.id)
        > ($${first}::int,$${first + 1}::numeric,$${first + 2}::int,$${first + 3}::bigint)`;
    }
    params.push(filters.pageSize + (useKeyset ? 1 : 0));
    const limit = `$${params.length}`;
    params.push(useKeyset ? 0 : (filters.page - 1) * filters.pageSize);
    const offset = `$${params.length}`;
    const result = await cancellableQuery(
      this.pool,
      `
      SELECT
        ml.id::int, ml.site, ml.asset_type AS "assetType", ml.classification, ml.external_code AS "externalCode", ml.url, ml.lot_number AS "lotNumber",
        ml.title, ml.brand, ml.model, ml.manufacture_year AS "manufactureYear",
        ml.model_year AS "modelYear", ml.mileage, ml.running_at_entry AS "runningAtEntry",
        ml.origin, ml.consignor, ml.city, ml.state, ml.address, ml.yard_name AS "yardName",
        ml.observations, ml.sale_status AS "saleStatus", ml.sale_phase AS "salePhase",
        ml.sale_result AS "saleResult", ml.bid_count AS "bidCount",
        ${canonicalStatusSql('ml')} AS "businessState",
        ${businessStatusSql('ml')} AS "businessStatus", ml.current_bid::float AS "currentBid",
        ml.current_bidder_alias AS "currentBidderAlias",
        ml.next_bid::float AS "nextBid", ml.final_bid::float AS "finalBid",
        ml.commission_fee::float AS "commissionFee", ml.other_fees::float AS "otherFees",
        ml.total_cost::float AS "totalCost", ml.auction_start AS "auctionStart",
        ml.auction_end AS "auctionEnd", ml.sold_at AS "soldAt", ml.last_seen_at AS "lastSeenAt",
        ae.id::int AS "eventId", ae.name AS "eventName",
        red.neighborhood, red.property_type AS "propertyType", red.occupancy_status AS "occupancyStatus",
        red.total_area_m2::float AS "totalAreaM2", red.private_area_m2::float AS "privateAreaM2",
        red.accepts_financing AS "acceptsFinancing",
        red.first_round_minimum_value::float AS "firstRoundMinimumValue",
        red.second_round_minimum_value::float AS "secondRoundMinimumValue",
        red.third_round_minimum_value::float AS "thirdRoundMinimumValue",
        vd.vehicle_condition AS "vehicleCondition",
        (SELECT id::int FROM lot_media WHERE market_lot_id=ml.id AND type='image' AND download_status='downloaded' ORDER BY position LIMIT 1) AS "primaryMediaId",
        (SELECT source_url FROM lot_media WHERE market_lot_id=ml.id AND type='image' ORDER BY position LIMIT 1) AS "primarySourceUrl",
        (SELECT COUNT(*)::int FROM lot_media WHERE market_lot_id=ml.id AND type='image') AS "imageCount",
        (SELECT source_url FROM lot_media WHERE market_lot_id=ml.id AND type='video' LIMIT 1) AS "videoUrl",
        (SELECT COUNT(*)::int FROM lot_snapshots WHERE market_lot_id=ml.id) AS "snapshotCount",
        (SELECT COUNT(*)::int FROM lot_change_log WHERE market_lot_id=ml.id) AS "changeCount",
        ${sortBucket}::int AS "_sortBucket",
        ${sortTime}::float AS "_sortTime",
        ${sortLotNumber}::int AS "_sortLotNumber"
      FROM market_lots ml
      LEFT JOIN auction_events ae ON ae.id = ml.event_id
      LEFT JOIN real_estate_details red ON red.market_lot_id = ml.id
      LEFT JOIN vehicle_details vd ON vd.market_lot_id = ml.id
      WHERE ${where}${cursorWhere}
      ORDER BY ${useKeyset
    ? `${sortBucket},${sortTime},${sortLotNumber},ml.id`
    : lotOrderBy(filters.sort)}
      LIMIT ${limit} OFFSET ${offset}
    `, params, signal);
    const hasNext = useKeyset && result.rows.length > filters.pageSize;
    if (hasNext) result.rows.pop();
    const nextCursor = hasNext && result.rows.length ? encodeAuctionCursor(result.rows.at(-1)!) : undefined;
    const items = result.rows.map((row: Record<string, unknown>) => {
      const { _sortBucket, _sortTime, _sortLotNumber, ...item } = row;
      return {
        ...item,
        primaryImage: item.primaryMediaId ? `/api/media/${item.primaryMediaId}` : item.primarySourceUrl,
      };
    });
    return {
      items,total: totalResult.rows[0]?.total ?? 0,page: filters.page,pageSize: filters.pageSize,
      ...(nextCursor ? { nextCursor } : {}),
    };
  }

  public async facets(filters: DashboardFilters): Promise<{ total: number; facets: Record<LotFacetKey, LotFacetOption[]> }> {
    return this.facetsCache.get(dashboardCacheKey(filters), () => this.loadFacets(filters));
  }

  private async loadFacets(filters: DashboardFilters): Promise<{
    total: number; facets: Record<LotFacetKey, LotFacetOption[]>;
  }> {
    type FacetDefinition = {
      key: LotFacetKey; value: string; label?: string; limit?: number; orderBy?: string;
      groupedValue: string; groupedLabel?: string;
    };
    const definitions: FacetDefinition[] = [
      { key: 'site', value: 'ml.site', groupedValue: 'ml.site' },
      { key: 'assetType', value: 'ml.asset_type', groupedValue: 'ml.asset_type' },
      { key: 'event', value: 'ml.event_id::text', label: "COALESCE(ae.name,'Evento sem nome')",
        groupedValue: 'ml.event_id::text', groupedLabel: "COALESCE(ae.name,'Evento sem nome')", limit: 500 },
      { key: 'status', value: canonicalStatusSql('ml'), groupedValue: canonicalStatusSql('ml') },
      { key: 'brand', value: 'ml.brand', groupedValue: 'ml.brand' },
      { key: 'model', value: 'ml.model', groupedValue: 'ml.model', limit: 1000 },
      { key: 'year', value: 'ml.model_year::text', groupedValue: 'ml.model_year::text', orderBy: 'value::int DESC' },
      { key: 'state', value: 'ml.state', groupedValue: 'ml.state' },
      { key: 'city', value: 'ml.city', groupedValue: 'ml.city', limit: 500 },
      { key: 'neighborhood', value: '(SELECT red.neighborhood_normalized FROM real_estate_details red WHERE red.market_lot_id=ml.id)',
        label: "(SELECT red.neighborhood FROM real_estate_details red WHERE red.market_lot_id=ml.id)",
        groupedValue: 'red.neighborhood_normalized', groupedLabel: 'red.neighborhood', limit: 1000 },
      { key: 'propertyType', value: '(SELECT red.property_type FROM real_estate_details red WHERE red.market_lot_id=ml.id)',
        groupedValue: 'red.property_type', limit: 500 },
      { key: 'vehicleCondition', value: '(SELECT vd.vehicle_condition FROM vehicle_details vd WHERE vd.market_lot_id=ml.id)',
        groupedValue: 'vd.vehicle_condition', limit: 100 },
      { key: 'origin', value: 'ml.origin', groupedValue: 'ml.origin', limit: 500 },
      { key: 'consignor', value: 'ml.consignor', groupedValue: 'ml.consignor', limit: 1000 },
      { key: 'classification', value: 'ml.classification', groupedValue: 'ml.classification' },
      { key: 'fuel', value: 'ml.fuel', groupedValue: 'ml.fuel' },
      { key: 'transmission', value: 'ml.transmission', groupedValue: 'ml.transmission' },
      {
        key: 'runningAtEntry',
        value: "CASE WHEN ml.running_at_entry IS TRUE THEN 'yes' WHEN ml.running_at_entry IS FALSE THEN 'no' END",
        groupedValue: "CASE WHEN ml.running_at_entry IS TRUE THEN 'yes' WHEN ml.running_at_entry IS FALSE THEN 'no' END",
      },
    ];
    const selectedKeys = new Set<LotFacetKey>([
      ...(filters.sites?.length ? ['site' as const] : []),
      ...(filters.assetTypes?.length ? ['assetType' as const] : []),
      ...(filters.eventIds?.length ? ['event' as const] : []),
      ...(filters.statuses?.length ? ['status' as const] : []),
      ...(filters.brands?.length ? ['brand' as const] : []),
      ...(filters.models?.length ? ['model' as const] : []),
      ...(filters.years?.length ? ['year' as const] : []),
      ...(filters.states?.length ? ['state' as const] : []),
      ...(filters.cities?.length ? ['city' as const] : []),
      ...(filters.neighborhoods?.length ? ['neighborhood' as const] : []),
      ...(filters.propertyTypes?.length ? ['propertyType' as const] : []),
      ...(filters.vehicleConditions?.length ? ['vehicleCondition' as const] : []),
      ...(filters.origins?.length ? ['origin' as const] : []),
      ...(filters.consignors?.length ? ['consignor' as const] : []),
      ...(filters.classifications?.length ? ['classification' as const] : []),
      ...(filters.fuels?.length ? ['fuel' as const] : []),
      ...(filters.transmissions?.length ? ['transmission' as const] : []),
      ...(filters.runningAtEntry !== undefined ? ['runningAtEntry' as const] : []),
    ]);
    const groupedDefinitions = definitions.filter((definition) => !selectedKeys.has(definition.key));
    const selectedDefinitions = definitions.filter((definition) => selectedKeys.has(definition.key));
    const totalQuery = buildLotWhere(filters);
    const [totalResult, groupedResult, ...selectedResults] = await Promise.all([
      this.pool.query<{ total: number }>(
        `SELECT COUNT(*)::int AS total FROM market_lots ml WHERE ${totalQuery.where}`,
        totalQuery.params,
      ),
      this.groupedFacetOptions(groupedDefinitions, filters),
      ...selectedDefinitions.map((definition) => this.facetOptions(definition, filters)),
    ]);
    const facets = Object.fromEntries(
      definitions.map((definition) => [definition.key, []]),
    ) as unknown as Record<LotFacetKey, LotFacetOption[]>;
    for (const row of groupedResult.rows) facets[row.key]?.push(row);
    selectedDefinitions.forEach((definition, index) => {
      facets[definition.key] = selectedResults[index]?.rows ?? [];
    });
    return { total: totalResult.rows[0]?.total ?? 0, facets };
  }

  private async groupedFacetOptions(
    definitions: Array<{
      key: LotFacetKey; groupedValue: string; groupedLabel?: string; limit?: number; orderBy?: string;
    }>,
    filters: DashboardFilters,
  ) {
    if (!definitions.length) return { rows: [] as Array<LotFacetOption & { key: LotFacetKey }> };
    const query = buildLotWhere(filters);
    const values = definitions.map((definition) => `(
      '${definition.key}'::text,
      (${definition.groupedValue})::text,
      (${definition.groupedLabel ?? definition.groupedValue})::text
    )`).join(',');
    const result = await this.pool.query<LotFacetOption & { key: LotFacetKey }>(`
      WITH expanded AS MATERIALIZED (
        SELECT facet.key,facet.value,facet.label
        FROM market_lots ml
        LEFT JOIN auction_events ae ON ae.id=ml.event_id
        LEFT JOIN real_estate_details red ON red.market_lot_id=ml.id
        LEFT JOIN vehicle_details vd ON vd.market_lot_id=ml.id
        CROSS JOIN LATERAL (VALUES ${values}) facet(key,value,label)
        WHERE ${query.where}
          AND NULLIF(BTRIM(facet.value), '') IS NOT NULL
      ), grouped AS (
        SELECT key,value,label,COUNT(*)::int AS count
        FROM expanded GROUP BY key,value,label
      )
      SELECT key,value,label,count
      FROM grouped
      ORDER BY key,
        CASE WHEN key='year' THEN value::int END DESC NULLS LAST,
        CASE WHEN key<>'year' THEN count END DESC NULLS LAST,
        label ASC
    `, query.params);
    const limits = new Map(definitions.map((definition) => [definition.key, definition.limit ?? 120]));
    const counts = new Map<LotFacetKey, number>();
    return {
      rows: result.rows.filter((row) => {
        const count = counts.get(row.key) ?? 0;
        counts.set(row.key, count + 1);
        return count < (limits.get(row.key) ?? 120);
      }),
    };
  }

  private async facetOptions(
    definition: { key: LotFacetKey; value: string; label?: string; limit?: number; orderBy?: string },
    filters: DashboardFilters,
  ) {
    const query = buildLotWhere(filters, definition.key);
    const label = definition.label ?? definition.value;
    query.params.push(definition.limit ?? 120);
    return this.pool.query<LotFacetOption>(`
      WITH filtered AS (
        SELECT ${definition.value} AS value, ${label} AS label
        FROM market_lots ml
        LEFT JOIN auction_events ae ON ae.id = ml.event_id
        WHERE ${query.where}
      )
      SELECT value::text, label::text, COUNT(*)::int AS count
      FROM filtered
      WHERE NULLIF(BTRIM(value::text), '') IS NOT NULL
      GROUP BY value, label
      ORDER BY ${definition.orderBy ?? 'COUNT(*) DESC, label ASC'}
      LIMIT $${query.params.length}
    `, query.params);
  }

  public async lot(id: number): Promise<unknown | undefined> {
    const result = await this.pool.query<Record<string, unknown>>(`
      SELECT ml.*, ${businessStatusSql('ml')} AS "businessStatus",
        ml.current_bid::float, ml.next_bid::float, ml.final_bid::float,
        ml.commission_fee::float, ml.buyer_fee::float, ml.other_fees::float, ml.total_cost::float,
        ae.name AS event_name, red.neighborhood, red.postal_code, red.property_type,
        red.occupancy_status, red.total_area_m2::float, red.private_area_m2::float,
        red.latitude, red.longitude, red.accepts_financing,
        vd.vehicle_condition,vd.engine_condition,vd.body_condition,vd.paint_condition,
        vd.upholstery_condition,vd.tire_condition,vd.wheel_type,vd.door_count,vd.seat_type,
        vd.sound_system,vd.chassis_condition,vd.vehicle_restrictions,vd.tax_status,vd.debt_notes,
        vd.reference_code,vd.extraction_confidence,vd.unmapped_details_json
      FROM market_lots ml
      LEFT JOIN auction_events ae ON ae.id = ml.event_id
      LEFT JOIN real_estate_details red ON red.market_lot_id = ml.id
      LEFT JOIN vehicle_details vd ON vd.market_lot_id = ml.id
      WHERE ml.id=$1
    `, [id]);
    const lot = result.rows[0];
    if (!lot) return undefined;

    const [media, snapshots, changes, bids] = await Promise.all([
      this.pool.query(`
        SELECT id::int, type, source_url AS "sourceUrl", position, label,
          document_type AS "documentType",download_status AS "downloadStatus",
          storage_provider AS "storageProvider",storage_tier AS "storageTier"
        FROM lot_media WHERE market_lot_id=$1 ORDER BY type, position
      `, [id]),
      this.pool.query(`
        SELECT snapshot.observed_at AS "observedAt", snapshot.current_bid::float AS "currentBid",
          snapshot.final_bid::float AS "finalBid", snapshot.sale_status AS "saleStatus",
          CASE WHEN (snapshot.raw_data_json->>'displayStatus') IS NOT NULL
            THEN snapshot.raw_data_json->>'displayStatus'
            ELSE CASE
            WHEN snapshot.sale_status = 'LiberadoLeilao' THEN 'Aberto para Lances'
            WHEN snapshot.sale_status = 'NaoArrematado' THEN 'Não Arrematado'
            WHEN snapshot.sale_status = 'Condicional' THEN 'Condicional - Aguardando aprovação'
            WHEN snapshot.sale_status IN ('CondicionalNegada', 'NegadaCondicional') THEN 'Condicional - Negada'
            WHEN snapshot.sale_status IN ('AgPagamento', 'Pago') THEN
              CASE WHEN EXISTS (
                SELECT 1 FROM lot_snapshots previous_snapshot
                WHERE previous_snapshot.market_lot_id = snapshot.market_lot_id
                  AND previous_snapshot.sale_status = 'Condicional'
                  AND (previous_snapshot.observed_at, previous_snapshot.id) < (snapshot.observed_at, snapshot.id)
              ) THEN 'Condicional - Aprovada' ELSE 'Arrematado' END
            WHEN snapshot.sale_status IN ('Vendido', 'Arrematado') THEN 'Arrematado'
            ELSE snapshot.sale_status
            END
          END AS "businessStatus",
          total_cost::float AS "totalCost", auction_end AS "auctionEnd"
        FROM lot_snapshots snapshot WHERE market_lot_id=$1 ORDER BY observed_at DESC LIMIT 30
      `, [id]),
      this.pool.query(`
        SELECT id::int,change_type AS "changeType",field_name AS "fieldName",
          value_type AS "valueType",old_value AS "oldValue",new_value AS "newValue",
          bidder_alias AS "bidderAlias",observed_at AS "observedAt"
        FROM lot_change_log WHERE market_lot_id=$1 ORDER BY observed_at DESC,id DESC LIMIT 100
      `, [id]),
      this.pool.query(`
        SELECT source_order AS "sourceOrder",amount::float,bidder_alias AS "bidderAlias",
          bid_type AS "bidType",observed_at AS "observedAt"
        FROM lot_bid_history WHERE market_lot_id=$1 ORDER BY observed_at DESC,id DESC LIMIT 500
      `, [id]),
    ]);
    return { ...lot, media: media.rows, snapshots: snapshots.rows, changes: changes.rows, bids: bids.rows };
  }
}
