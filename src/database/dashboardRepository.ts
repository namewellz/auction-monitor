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
  origins?: string[];
  consignors?: string[];
  classifications?: string[];
  fuels?: string[];
  transmissions?: string[];
  runningAtEntry?: boolean;
  eventDateFrom?: string;
  eventDateTo?: string;
  sort?: LotSort;
  page: number;
  pageSize: number;
}

export type LotSort = 'auction_desc' | 'auction_asc' | 'year_desc' | 'year_asc' | 'brand_asc' | 'brand_desc';

export type LotFacetKey = 'site' | 'assetType' | 'event' | 'status' | 'brand' | 'model' | 'year' | 'state' |
  'city' | 'origin' | 'consignor' | 'classification' | 'fuel' | 'transmission' | 'runningAtEntry';

export interface LotFacetOption {
  value: string;
  label: string;
  count: number;
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
  return { where: conditions.join(' AND '), params };
}

function lotOrderBy(sort: LotSort | undefined): string {
  const lotNumber = "NULLIF(regexp_replace(ml.lot_number, '\\D', '', 'g'), '')::int ASC NULLS LAST";
  switch (sort) {
    case 'auction_asc': return `COALESCE(ml.auction_start,ml.auction_end) ASC NULLS LAST,${lotNumber}`;
    case 'year_desc': return `ml.model_year DESC NULLS LAST,ml.manufacture_year DESC NULLS LAST,ml.brand ASC NULLS LAST,ml.model ASC NULLS LAST,${lotNumber}`;
    case 'year_asc': return `ml.model_year ASC NULLS LAST,ml.manufacture_year ASC NULLS LAST,ml.brand ASC NULLS LAST,ml.model ASC NULLS LAST,${lotNumber}`;
    case 'brand_asc': return `ml.brand ASC NULLS LAST,ml.model ASC NULLS LAST,ml.model_year DESC NULLS LAST,${lotNumber}`;
    case 'brand_desc': return `ml.brand DESC NULLS LAST,ml.model DESC NULLS LAST,ml.model_year DESC NULLS LAST,${lotNumber}`;
    default: return `COALESCE(ml.auction_start,ml.auction_end) DESC NULLS LAST,${lotNumber}`;
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
        (SELECT COUNT(*)::int FROM lot_media lm JOIN filtered f ON f.id=lm.market_lot_id WHERE lm.type='image' AND lm.download_status='downloaded') AS "downloadedMedia",
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
        (SELECT id::int FROM lot_media WHERE market_lot_id=ml.id AND type='image' AND download_status='downloaded' ORDER BY position LIMIT 1) AS "primaryMediaId",
        (SELECT source_url FROM lot_media WHERE market_lot_id=ml.id AND type='image' ORDER BY position LIMIT 1) AS "primarySourceUrl",
        (SELECT COUNT(*)::int FROM lot_media WHERE market_lot_id=ml.id AND type='image') AS "imageCount",
        (SELECT source_url FROM lot_media WHERE market_lot_id=ml.id AND type='video' LIMIT 1) AS "videoUrl",
        (SELECT COUNT(*)::int FROM lot_snapshots WHERE market_lot_id=ml.id) AS "snapshotCount",
        (SELECT COUNT(*)::int FROM lot_change_log WHERE market_lot_id=ml.id) AS "changeCount"
      FROM market_lots ml
      LEFT JOIN auction_events ae ON ae.id = ml.event_id
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
        ae.name AS event_name
      FROM market_lots ml
      LEFT JOIN auction_events ae ON ae.id = ml.event_id
      WHERE ml.id=$1
    `, [id]);
    const lot = result.rows[0];
    if (!lot) return undefined;

    const [media, snapshots, changes, bids] = await Promise.all([
      this.pool.query(`
        SELECT id::int, type, source_url AS "sourceUrl", position, download_status AS "downloadStatus"
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
