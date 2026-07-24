import type { Pool } from 'pg';

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
  sort?: LotSort;
  page: number;
  pageSize: number;
}

export type LotSort = 'auction_nearest' | 'auction_desc' | 'auction_asc' | 'year_desc' | 'year_asc' | 'brand_asc' | 'brand_desc';

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
  return `CASE
    WHEN ${lotAlias}.sale_result = 'CONDITIONAL_REJECTED'
      OR ${lotAlias}.sale_status IN ('CondicionalNegada','NegadaCondicional','CondicionalRecusada')
      THEN 'conditional_rejected'
    WHEN ${lotAlias}.sale_result = 'CONDITIONAL_PENDING' OR ${lotAlias}.sale_status = 'Condicional'
      THEN 'conditional_pending'
    WHEN ${lotAlias}.sale_result = 'SOLD'
      OR ${lotAlias}.sale_status IN ('AgPagamento','Pago','Vendido','Arrematado','VendidoPorCompreJa')
      THEN CASE WHEN EXISTS (
        SELECT 1 FROM lot_snapshots canonical_history
        WHERE canonical_history.market_lot_id = ${lotAlias}.id
          AND (canonical_history.sale_status = 'Condicional'
            OR canonical_history.raw_data_json::jsonb->>'saleResult' = 'CONDITIONAL_PENDING')
      ) THEN 'conditional_approved' ELSE 'sold' END
    WHEN ${lotAlias}.sale_result = 'UNSOLD'
      OR ${lotAlias}.sale_status IN ('NaoArrematado','SemLance') THEN 'unsold'
    WHEN ${lotAlias}.sale_result = 'WITHDRAWN'
      OR ${lotAlias}.sale_status IN ('Retirado','Cancelado','Suspenso') THEN 'withdrawn'
    WHEN ${lotAlias}.sale_phase = 'OPEN'
      OR ${lotAlias}.sale_status IN ('LiberadoLeilao','AbertoParaOfertas','DoulheUma','DoulheDuas','EmDisputa')
      THEN 'open'
    ELSE 'other'
  END`;
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

export class DashboardRepository {
  public constructor(private readonly pool: Pool) {}

  public async stats(filters: DashboardFilters): Promise<Record<string, unknown>> {
    const query = buildLotWhere(filters);
    const result = await this.pool.query<Record<string, unknown>>(`
      WITH filtered AS (
        SELECT ml.* FROM market_lots ml WHERE ${query.where}
      )
      SELECT
        COUNT(*)::int AS "totalLots",
        COUNT(DISTINCT event_id)::int AS "totalEvents",
        COUNT(*) FILTER (WHERE auction_end > NOW())::int AS "activeLots",
        COUNT(*) FILTER (WHERE auction_end <= NOW())::int AS "endedLots",
        COUNT(*) FILTER (WHERE final_bid IS NOT NULL)::int AS "lotsWithResult",
        ROUND(AVG(current_bid) FILTER (WHERE current_bid > 0), 2)::float AS "averageBid",
        MAX(last_seen_at) AS "lastUpdatedAt",
        (SELECT COUNT(*)::int FROM lot_media lm JOIN filtered f ON f.id=lm.market_lot_id) AS "totalMedia",
        (SELECT COUNT(*)::int FROM lot_media lm JOIN filtered f ON f.id=lm.market_lot_id WHERE lm.type='image') AS "totalImages",
        (SELECT COUNT(*)::int FROM lot_media lm JOIN filtered f ON f.id=lm.market_lot_id WHERE lm.type='image' AND lm.download_status='downloaded') AS "downloadedImages",
        (SELECT COALESCE(SUM(lm.size_bytes), 0)::float FROM lot_media lm JOIN filtered f ON f.id=lm.market_lot_id WHERE lm.type='image' AND lm.download_status='downloaded') AS "imageBytes",
        (SELECT COUNT(*)::int FROM lot_media lm JOIN filtered f ON f.id=lm.market_lot_id WHERE lm.type='document') AS "totalDocuments",
        (SELECT COUNT(*)::int FROM lot_media lm JOIN filtered f ON f.id=lm.market_lot_id WHERE lm.type='document' AND lm.download_status='downloaded') AS "downloadedDocuments",
        (SELECT COALESCE(SUM(lm.size_bytes), 0)::float FROM lot_media lm JOIN filtered f ON f.id=lm.market_lot_id WHERE lm.type='document' AND lm.download_status='downloaded') AS "documentBytes",
        (SELECT COALESCE(SUM(lm.size_bytes), 0)::float FROM lot_media lm JOIN filtered f ON f.id=lm.market_lot_id WHERE lm.download_status='downloaded') AS "mediaBytes"
      FROM filtered
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
        SELECT lm.type, lm.storage_provider AS "storageProvider", lm.storage_tier AS "storageTier",
          COUNT(*)::int AS "objectCount", COALESCE(SUM(lm.size_bytes),0)::bigint AS "sizeBytes",
          MIN(lm.first_seen_at) AS "oldestObject", MAX(lm.last_accessed_at) AS "lastAccess"
        FROM lot_media lm JOIN market_lots ml ON ml.id=lm.market_lot_id
        WHERE lm.download_status='downloaded' AND ($1::text IS NULL OR ml.site=$1)
        GROUP BY lm.type, lm.storage_provider, lm.storage_tier
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
          COUNT(*) FILTER (WHERE lm.download_status<>'downloaded' AND lm.download_attempts>=4)::int AS exhausted,
          MIN(lm.first_seen_at) FILTER (WHERE lm.download_status<>'downloaded') AS "oldestAt",
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
          WHEN lm.download_attempts>=4 AND lm.download_status<>'downloaded' THEN 'exhausted'
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
          WHEN lm.download_attempts>=4 AND lm.download_status<>'downloaded' THEN 'exhausted'
          WHEN lm.download_status='failed' THEN 'failed'
          WHEN lm.download_status IN ('pending','metadata_only') THEN 'pending' ELSE lm.download_status END)
        AND ($4::text IS NOT NULL OR lm.download_status<>'downloaded')
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
        SELECT ml.id::int AS id,'revalidation'::text AS queue,ml.site,ml.url,ml.title,
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
          ml.site,ml.url,ml.title,
          CASE
            WHEN lm.download_attempts>=4 AND lm.download_status<>'downloaded' THEN 'exhausted'
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
        SELECT id,queue,site,url,title,status,attempts,
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

  public async lots(filters: DashboardFilters): Promise<{ items: unknown[]; total: number; page: number; pageSize: number }> {
    const { where, params } = buildLotWhere(filters);
    const totalResult = await this.pool.query<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM market_lots ml WHERE ${where}`,
      params,
    );
    params.push(filters.pageSize);
    const limit = `$${params.length}`;
    params.push((filters.page - 1) * filters.pageSize);
    const offset = `$${params.length}`;
    const result = await this.pool.query(`
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
        (SELECT COUNT(*)::int FROM lot_change_log WHERE market_lot_id=ml.id) AS "changeCount"
      FROM market_lots ml
      LEFT JOIN auction_events ae ON ae.id = ml.event_id
      LEFT JOIN real_estate_details red ON red.market_lot_id = ml.id
      LEFT JOIN vehicle_details vd ON vd.market_lot_id = ml.id
      WHERE ${where}
      ORDER BY ${lotOrderBy(filters.sort)}
      LIMIT ${limit} OFFSET ${offset}
    `, params);
    const items = result.rows.map((row: Record<string, unknown>) => ({
      ...row,
      primaryImage: row.primaryMediaId ? `/api/media/${row.primaryMediaId}` : row.primarySourceUrl,
    }));
    return { items, total: totalResult.rows[0]?.total ?? 0, page: filters.page, pageSize: filters.pageSize };
  }

  public async facets(filters: DashboardFilters): Promise<{ total: number; facets: Record<LotFacetKey, LotFacetOption[]> }> {
    const definitions: Array<{ key: LotFacetKey; value: string; label?: string; limit?: number; orderBy?: string }> = [
      { key: 'site', value: 'ml.site' },
      { key: 'assetType', value: 'ml.asset_type' },
      { key: 'event', value: 'ml.event_id::text', label: "COALESCE(ae.name,'Evento sem nome')", limit: 500 },
      { key: 'status', value: canonicalStatusSql('ml') },
      { key: 'brand', value: 'ml.brand' },
      { key: 'model', value: 'ml.model', limit: 1000 },
      { key: 'year', value: 'ml.model_year::text', orderBy: 'value::int DESC' },
      { key: 'state', value: 'ml.state' },
      { key: 'city', value: 'ml.city', limit: 500 },
      { key: 'neighborhood', value: '(SELECT red.neighborhood_normalized FROM real_estate_details red WHERE red.market_lot_id=ml.id)',
        label: "(SELECT red.neighborhood FROM real_estate_details red WHERE red.market_lot_id=ml.id)", limit: 1000 },
      { key: 'propertyType', value: '(SELECT red.property_type FROM real_estate_details red WHERE red.market_lot_id=ml.id)', limit: 500 },
      { key: 'vehicleCondition', value: '(SELECT vd.vehicle_condition FROM vehicle_details vd WHERE vd.market_lot_id=ml.id)', limit: 100 },
      { key: 'origin', value: 'ml.origin', limit: 500 },
      { key: 'consignor', value: 'ml.consignor', limit: 1000 },
      { key: 'classification', value: 'ml.classification' },
      { key: 'fuel', value: 'ml.fuel' },
      { key: 'transmission', value: 'ml.transmission' },
      {
        key: 'runningAtEntry',
        value: "CASE WHEN ml.running_at_entry IS TRUE THEN 'yes' WHEN ml.running_at_entry IS FALSE THEN 'no' END",
      },
    ];
    const totalQuery = buildLotWhere(filters);
    const [totalResult, ...facetResults] = await Promise.all([
      this.pool.query<{ total: number }>(
        `SELECT COUNT(*)::int AS total FROM market_lots ml WHERE ${totalQuery.where}`,
        totalQuery.params,
      ),
      ...definitions.map((definition) => this.facetOptions(definition, filters)),
    ]);
    const facets = Object.fromEntries(definitions.map((definition, index) => [
      definition.key,
      facetResults[index]?.rows ?? [],
    ])) as Record<LotFacetKey, LotFacetOption[]>;
    return { total: totalResult.rows[0]?.total ?? 0, facets };
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
