import { Pool } from 'pg';

export function createPostgresPool(connectionString: string): Pool {
  return new Pool({ connectionString, max: 12, idleTimeoutMillis: 30_000 });
}

export async function runPostgresMigrations(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS lots (
      id TEXT PRIMARY KEY,
      site TEXT NOT NULL,
      url TEXT NOT NULL UNIQUE,
      title TEXT,
      current_bid NUMERIC(16,2),
      next_bid NUMERIC(16,2),
      auction_end TIMESTAMPTZ,
      city TEXT,
      state TEXT,
      address TEXT,
      yard_name TEXT,
      observations TEXT,
      lot_number TEXT,
      external_code TEXT,
      running_at_entry BOOLEAN,
      origin TEXT,
      max_bid_limit NUMERIC(16,2),
      monitoring_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      last_check TIMESTAMPTZ,
      last_bid_change TIMESTAMPTZ,
      last_end_change TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS lot_alerts (
      lot_id TEXT NOT NULL REFERENCES lots(id) ON DELETE CASCADE,
      alert_key TEXT NOT NULL,
      sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (lot_id, alert_key)
    );

    CREATE INDEX IF NOT EXISTS idx_lots_monitoring ON lots (monitoring_enabled, auction_end);

    CREATE TABLE IF NOT EXISTS auction_events (
      id BIGSERIAL PRIMARY KEY,
      site TEXT NOT NULL,
      external_code TEXT NOT NULL,
      name TEXT,
      url TEXT,
      starts_at TIMESTAMPTZ,
      ends_at TIMESTAMPTZ,
      city TEXT,
      state TEXT,
      first_seen_at TIMESTAMPTZ NOT NULL,
      last_seen_at TIMESTAMPTZ NOT NULL,
      UNIQUE(site, external_code)
    );

    CREATE TABLE IF NOT EXISTS market_lots (
      id BIGSERIAL PRIMARY KEY,
      event_id BIGINT REFERENCES auction_events(id) ON DELETE SET NULL,
      site TEXT NOT NULL,
      external_code TEXT,
      url TEXT NOT NULL UNIQUE,
      lot_number TEXT,
      title TEXT NOT NULL,
      brand TEXT,
      model TEXT,
      manufacture_year INTEGER,
      model_year INTEGER,
      mileage INTEGER,
      running_at_entry BOOLEAN,
      origin TEXT,
      consignor TEXT,
      city TEXT,
      state TEXT,
      address TEXT,
      yard_name TEXT,
      observations TEXT,
      sale_status TEXT,
      current_bid NUMERIC(16,2),
      current_bidder_alias TEXT,
      next_bid NUMERIC(16,2),
      final_bid NUMERIC(16,2),
      commission_fee NUMERIC(16,2),
      buyer_fee NUMERIC(16,2),
      other_fees NUMERIC(16,2),
      total_cost NUMERIC(16,2),
      auction_start TIMESTAMPTZ,
      auction_end TIMESTAMPTZ NOT NULL,
      sold_at TIMESTAMPTZ,
      first_seen_at TIMESTAMPTZ NOT NULL,
      last_seen_at TIMESTAMPTZ NOT NULL,
      last_checked_at TIMESTAMPTZ NOT NULL,
      next_check_at TIMESTAMPTZ NOT NULL,
      recheck_count INTEGER NOT NULL DEFAULT 0,
      finalized_at TIMESTAMPTZ,
      raw_data_json JSONB NOT NULL
    );

    CREATE TABLE IF NOT EXISTS lot_snapshots (
      id BIGSERIAL PRIMARY KEY,
      market_lot_id BIGINT NOT NULL REFERENCES market_lots(id) ON DELETE CASCADE,
      observed_at TIMESTAMPTZ NOT NULL,
      current_bid NUMERIC(16,2),
      bidder_alias TEXT,
      next_bid NUMERIC(16,2),
      final_bid NUMERIC(16,2),
      sale_status TEXT,
      commission_fee NUMERIC(16,2),
      buyer_fee NUMERIC(16,2),
      other_fees NUMERIC(16,2),
      total_cost NUMERIC(16,2),
      auction_end TIMESTAMPTZ NOT NULL,
      data_hash TEXT NOT NULL,
      raw_data_json JSONB NOT NULL,
      UNIQUE(market_lot_id, data_hash)
    );

    CREATE TABLE IF NOT EXISTS lot_change_log (
      id BIGSERIAL PRIMARY KEY,
      market_lot_id BIGINT NOT NULL REFERENCES market_lots(id) ON DELETE CASCADE,
      change_key TEXT NOT NULL UNIQUE,
      change_type TEXT NOT NULL,
      field_name TEXT,
      value_type TEXT,
      old_value TEXT,
      new_value TEXT,
      bidder_alias TEXT,
      observed_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE market_lots ADD COLUMN IF NOT EXISTS current_bidder_alias TEXT;
    ALTER TABLE market_lots ADD COLUMN IF NOT EXISTS classification TEXT;
    ALTER TABLE market_lots ADD COLUMN IF NOT EXISTS asset_type TEXT;
    ALTER TABLE market_lots ADD COLUMN IF NOT EXISTS source_announcement_id TEXT;
    ALTER TABLE market_lots ADD COLUMN IF NOT EXISTS display_status TEXT;
    ALTER TABLE market_lots ADD COLUMN IF NOT EXISTS sale_phase TEXT;
    ALTER TABLE market_lots ADD COLUMN IF NOT EXISTS sale_result TEXT;
    ALTER TABLE market_lots ADD COLUMN IF NOT EXISTS canonical_status TEXT;
    ALTER TABLE market_lots ADD COLUMN IF NOT EXISTS bid_count INTEGER;
    ALTER TABLE market_lots ADD COLUMN IF NOT EXISTS color TEXT;
    ALTER TABLE market_lots ADD COLUMN IF NOT EXISTS fuel TEXT;
    ALTER TABLE market_lots ADD COLUMN IF NOT EXISTS transmission TEXT;
    ALTER TABLE market_lots ADD COLUMN IF NOT EXISTS plate_final TEXT;
    ALTER TABLE market_lots ADD COLUMN IF NOT EXISTS plate_state TEXT;
    ALTER TABLE market_lots ADD COLUMN IF NOT EXISTS air_conditioning TEXT;
    ALTER TABLE market_lots ADD COLUMN IF NOT EXISTS steering TEXT;
    ALTER TABLE market_lots ADD COLUMN IF NOT EXISTS key_available TEXT;
    ALTER TABLE market_lots ADD COLUMN IF NOT EXISTS locks TEXT;
    ALTER TABLE market_lots ADD COLUMN IF NOT EXISTS windows TEXT;
    ALTER TABLE market_lots ADD COLUMN IF NOT EXISTS revalidation_started_at TIMESTAMPTZ;
    ALTER TABLE market_lots ADD COLUMN IF NOT EXISTS revalidation_due_at TIMESTAMPTZ;
    ALTER TABLE market_lots ADD COLUMN IF NOT EXISTS revalidation_finished_at TIMESTAMPTZ;
    ALTER TABLE market_lots ADD COLUMN IF NOT EXISTS revalidation_error TEXT;
    ALTER TABLE market_lots ADD COLUMN IF NOT EXISTS consecutive_failures INTEGER NOT NULL DEFAULT 0;
    UPDATE market_lots SET revalidation_finished_at=NOW(),next_check_at=NOW(),
      revalidation_error=COALESCE(revalidation_error,'Processamento interrompido antes da conclusão.'),
      consecutive_failures=consecutive_failures+1
    WHERE revalidation_started_at IS NOT NULL AND revalidation_finished_at IS NULL;
    ALTER TABLE lot_snapshots ADD COLUMN IF NOT EXISTS bidder_alias TEXT;

    UPDATE market_lots SET asset_type='car'
    WHERE asset_type IS NULL AND site='leilo' AND url LIKE '%/carros/%';
    UPDATE market_lots SET asset_type='motorcycle'
    WHERE asset_type IS NULL AND site='leilo' AND url LIKE '%/motos/%';
    UPDATE market_lots SET asset_type='car'
    WHERE asset_type IS NULL AND site='vipleiloes';
    ALTER TABLE lot_change_log ADD COLUMN IF NOT EXISTS bidder_alias TEXT;

    UPDATE market_lots
    SET final_bid = current_bid
    WHERE site = 'leilo' AND sale_status IN ('AgPagamento', 'Pago', 'Vendido', 'Arrematado')
      AND final_bid IS NULL AND current_bid IS NOT NULL;

    UPDATE lot_snapshots snapshots
    SET final_bid = snapshots.current_bid
    FROM market_lots lots
    WHERE snapshots.market_lot_id = lots.id AND lots.site = 'leilo'
      AND snapshots.sale_status IN ('AgPagamento', 'Pago', 'Vendido', 'Arrematado')
      AND snapshots.final_bid IS NULL AND snapshots.current_bid IS NOT NULL;

    CREATE TABLE IF NOT EXISTS lot_media (
      id BIGSERIAL PRIMARY KEY,
      market_lot_id BIGINT NOT NULL REFERENCES market_lots(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      source_url TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      storage_key TEXT,
      content_hash TEXT,
      content_type TEXT,
      size_bytes BIGINT,
      original_size_bytes BIGINT,
      image_width INTEGER,
      image_height INTEGER,
      optimization_profile TEXT,
      optimized_at TIMESTAMPTZ,
      optimization_attempts INTEGER NOT NULL DEFAULT 0,
      optimization_error TEXT,
      etag TEXT,
      download_status TEXT NOT NULL DEFAULT 'pending',
      download_attempts INTEGER NOT NULL DEFAULT 0,
      download_error TEXT,
      downloaded_at TIMESTAMPTZ,
      first_seen_at TIMESTAMPTZ NOT NULL,
      last_seen_at TIMESTAMPTZ NOT NULL,
      UNIQUE(market_lot_id, source_url)
    );

    ALTER TABLE lot_media ADD COLUMN IF NOT EXISTS original_size_bytes BIGINT;
    ALTER TABLE lot_media ADD COLUMN IF NOT EXISTS image_width INTEGER;
    ALTER TABLE lot_media ADD COLUMN IF NOT EXISTS image_height INTEGER;
    ALTER TABLE lot_media ADD COLUMN IF NOT EXISTS optimization_profile TEXT;
    ALTER TABLE lot_media ADD COLUMN IF NOT EXISTS optimized_at TIMESTAMPTZ;
    ALTER TABLE lot_media ADD COLUMN IF NOT EXISTS optimization_attempts INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE lot_media ADD COLUMN IF NOT EXISTS optimization_error TEXT;
    ALTER TABLE lot_media ADD COLUMN IF NOT EXISTS label TEXT;
    ALTER TABLE lot_media ADD COLUMN IF NOT EXISTS document_type TEXT;
    ALTER TABLE lot_media ADD COLUMN IF NOT EXISTS storage_provider TEXT NOT NULL DEFAULT 'oracle-minio';
    ALTER TABLE lot_media ADD COLUMN IF NOT EXISTS storage_tier TEXT NOT NULL DEFAULT 'hot';
    ALTER TABLE lot_media ADD COLUMN IF NOT EXISTS storage_bucket TEXT;
    ALTER TABLE lot_media ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
    ALTER TABLE lot_media ADD COLUMN IF NOT EXISTS last_accessed_at TIMESTAMPTZ;
    ALTER TABLE lot_media ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ;
    ALTER TABLE lot_media ADD COLUMN IF NOT EXISTS processing_finished_at TIMESTAMPTZ;
    ALTER TABLE lot_media ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ;

    UPDATE lot_media SET download_status='failed',processing_finished_at=NOW(),
      download_error=COALESCE(download_error,'Processamento interrompido antes da conclusão.')
    WHERE download_status='processing';

    CREATE TABLE IF NOT EXISTS lot_media_summary (
      market_lot_id BIGINT PRIMARY KEY REFERENCES market_lots(id) ON DELETE CASCADE,
      total_media INTEGER NOT NULL DEFAULT 0,
      total_images INTEGER NOT NULL DEFAULT 0,
      downloaded_images INTEGER NOT NULL DEFAULT 0,
      image_bytes BIGINT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE OR REPLACE FUNCTION refresh_lot_media_summary(target_lot_id BIGINT)
    RETURNS VOID LANGUAGE plpgsql AS $function$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM market_lots WHERE id=target_lot_id) THEN
        DELETE FROM lot_media_summary WHERE market_lot_id=target_lot_id;
        RETURN;
      END IF;
      INSERT INTO lot_media_summary (
        market_lot_id,total_media,total_images,downloaded_images,image_bytes,updated_at
      )
      SELECT target_lot_id,COUNT(*)::int,
        COUNT(*) FILTER (WHERE type='image')::int,
        COUNT(*) FILTER (WHERE type='image' AND download_status='downloaded')::int,
        COALESCE(SUM(size_bytes) FILTER (
          WHERE type='image' AND download_status='downloaded'
        ),0)::bigint,NOW()
      FROM lot_media WHERE market_lot_id=target_lot_id
      ON CONFLICT (market_lot_id) DO UPDATE SET
        total_media=EXCLUDED.total_media,total_images=EXCLUDED.total_images,
        downloaded_images=EXCLUDED.downloaded_images,image_bytes=EXCLUDED.image_bytes,
        updated_at=EXCLUDED.updated_at;
    END
    $function$;

    CREATE OR REPLACE FUNCTION maintain_lot_media_summary()
    RETURNS TRIGGER LANGUAGE plpgsql AS $function$
    BEGIN
      IF TG_OP='DELETE' OR (TG_OP='UPDATE' AND OLD.market_lot_id IS DISTINCT FROM NEW.market_lot_id) THEN
        PERFORM refresh_lot_media_summary(OLD.market_lot_id);
      END IF;
      IF TG_OP<>'DELETE' THEN
        PERFORM refresh_lot_media_summary(NEW.market_lot_id);
      END IF;
      RETURN COALESCE(NEW,OLD);
    END
    $function$;

    DROP TRIGGER IF EXISTS trg_lot_media_summary_insert_delete ON lot_media;
    CREATE TRIGGER trg_lot_media_summary_insert_delete AFTER INSERT OR DELETE ON lot_media
    FOR EACH ROW EXECUTE FUNCTION maintain_lot_media_summary();
    DROP TRIGGER IF EXISTS trg_lot_media_summary_update ON lot_media;
    CREATE TRIGGER trg_lot_media_summary_update
    AFTER UPDATE OF market_lot_id,type,download_status,size_bytes ON lot_media
    FOR EACH ROW EXECUTE FUNCTION maintain_lot_media_summary();

    INSERT INTO lot_media_summary (
      market_lot_id,total_media,total_images,downloaded_images,image_bytes,updated_at
    )
    SELECT ml.id,COUNT(lm.id)::int,
      COUNT(lm.id) FILTER (WHERE lm.type='image')::int,
      COUNT(lm.id) FILTER (WHERE lm.type='image' AND lm.download_status='downloaded')::int,
      COALESCE(SUM(lm.size_bytes) FILTER (
        WHERE lm.type='image' AND lm.download_status='downloaded'
      ),0)::bigint,NOW()
    FROM market_lots ml LEFT JOIN lot_media lm ON lm.market_lot_id=ml.id
    GROUP BY ml.id
    ON CONFLICT (market_lot_id) DO UPDATE SET
      total_media=EXCLUDED.total_media,total_images=EXCLUDED.total_images,
      downloaded_images=EXCLUDED.downloaded_images,image_bytes=EXCLUDED.image_bytes,
      updated_at=EXCLUDED.updated_at;

    CREATE OR REPLACE FUNCTION calculate_canonical_lot_status(lot market_lots)
    RETURNS TEXT LANGUAGE sql STABLE AS $function$
      SELECT CASE
        WHEN lot.sale_result='CONDITIONAL_REJECTED'
          OR lot.sale_status IN ('CondicionalNegada','NegadaCondicional','CondicionalRecusada','7')
          THEN 'conditional_rejected'
        WHEN lot.sale_result='CONDITIONAL_PENDING'
          OR lot.sale_status IN ('Condicional','reserved','11')
          THEN 'conditional_pending'
        WHEN lot.sale_result='SOLD'
          OR lot.sale_status IN ('AgPagamento','Pago','Vendido','Arrematado','VendidoPorCompreJa','sold','3')
          THEN CASE WHEN EXISTS (
            SELECT 1 FROM lot_snapshots history
            WHERE history.market_lot_id=lot.id
              AND (history.sale_status='Condicional'
                OR history.raw_data_json::jsonb->>'saleResult'='CONDITIONAL_PENDING')
          ) THEN 'conditional_approved' ELSE 'sold' END
        WHEN lot.sale_result='UNSOLD'
          OR lot.sale_status IN ('NaoArrematado','SemLance','closed','6') THEN 'unsold'
        WHEN lot.sale_result='WITHDRAWN'
          OR lot.sale_status IN ('Retirado','Cancelado','Suspenso','removed','stabbed') THEN 'withdrawn'
        WHEN lot.sale_phase='OPEN'
          OR lot.sale_status IN ('LiberadoLeilao','AbertoParaOfertas','DoulheUma','DoulheDuas','EmDisputa','open','1')
          THEN 'open'
        ELSE 'other'
      END
    $function$;

    CREATE OR REPLACE FUNCTION maintain_market_lot_canonical_status()
    RETURNS TRIGGER LANGUAGE plpgsql AS $function$
    BEGIN
      NEW.canonical_status=calculate_canonical_lot_status(NEW);
      RETURN NEW;
    END
    $function$;
    DROP TRIGGER IF EXISTS trg_market_lot_canonical_status ON market_lots;
    CREATE TRIGGER trg_market_lot_canonical_status
    BEFORE INSERT OR UPDATE OF sale_result,sale_status,sale_phase ON market_lots
    FOR EACH ROW EXECUTE FUNCTION maintain_market_lot_canonical_status();

    CREATE OR REPLACE FUNCTION refresh_snapshot_lot_canonical_status()
    RETURNS TRIGGER LANGUAGE plpgsql AS $function$
    DECLARE target_lot_id BIGINT;
    BEGIN
      target_lot_id=COALESCE(NEW.market_lot_id,OLD.market_lot_id);
      UPDATE market_lots lot SET canonical_status=calculate_canonical_lot_status(lot)
      WHERE lot.id=target_lot_id;
      RETURN COALESCE(NEW,OLD);
    END
    $function$;
    DROP TRIGGER IF EXISTS trg_snapshot_canonical_status ON lot_snapshots;
    CREATE TRIGGER trg_snapshot_canonical_status
    AFTER INSERT OR UPDATE OF sale_status,raw_data_json OR DELETE ON lot_snapshots
    FOR EACH ROW EXECUTE FUNCTION refresh_snapshot_lot_canonical_status();

    UPDATE market_lots lot SET canonical_status=calculate_canonical_lot_status(lot)
    WHERE canonical_status IS DISTINCT FROM calculate_canonical_lot_status(lot);

    CREATE TABLE IF NOT EXISTS real_estate_details (
      market_lot_id BIGINT PRIMARY KEY REFERENCES market_lots(id) ON DELETE CASCADE,
      state_code TEXT,
      city_code TEXT,
      neighborhood TEXT,
      neighborhood_normalized TEXT,
      postal_code TEXT,
      property_type TEXT,
      occupancy_status TEXT,
      total_area_m2 NUMERIC(14,2),
      private_area_m2 NUMERIC(14,2),
      latitude DOUBLE PRECISION,
      longitude DOUBLE PRECISION,
      accepts_financing BOOLEAN,
      first_round_minimum_value NUMERIC(16,2),
      second_round_minimum_value NUMERIC(16,2),
      third_round_minimum_value NUMERIC(16,2),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE real_estate_details ADD COLUMN IF NOT EXISTS first_round_minimum_value NUMERIC(16,2);
    ALTER TABLE real_estate_details ADD COLUMN IF NOT EXISTS second_round_minimum_value NUMERIC(16,2);
    ALTER TABLE real_estate_details ADD COLUMN IF NOT EXISTS third_round_minimum_value NUMERIC(16,2);

    UPDATE real_estate_details red SET
      first_round_minimum_value = COALESCE(red.first_round_minimum_value,
        CASE WHEN ml.raw_data_json->'additionalDetails'->>'valorMinimoPrimeiraPraca' ~ '^[0-9]+([.][0-9]+)?$'
          THEN (ml.raw_data_json->'additionalDetails'->>'valorMinimoPrimeiraPraca')::numeric END,
        CASE WHEN ml.site IN ('alessandroteixeira','alvaroleiloes')
          AND ml.raw_data_json->'additionalDetails'->>'avaliacao' ~ '^[0-9]+([.][0-9]+)?$'
          THEN (ml.raw_data_json->'additionalDetails'->>'avaliacao')::numeric END),
      second_round_minimum_value = COALESCE(red.second_round_minimum_value,
        CASE WHEN ml.raw_data_json->'additionalDetails'->>'valorMinimoSegundaPraca' ~ '^[0-9]+([.][0-9]+)?$'
          THEN (ml.raw_data_json->'additionalDetails'->>'valorMinimoSegundaPraca')::numeric END),
      third_round_minimum_value = COALESCE(red.third_round_minimum_value,
        CASE WHEN ml.raw_data_json->'additionalDetails'->>'valorMinimoTerceiraPraca' ~ '^[0-9]+([.][0-9]+)?$'
          THEN (ml.raw_data_json->'additionalDetails'->>'valorMinimoTerceiraPraca')::numeric END)
    FROM market_lots ml WHERE ml.id=red.market_lot_id;

    CREATE TABLE IF NOT EXISTS vehicle_details (
      market_lot_id BIGINT PRIMARY KEY REFERENCES market_lots(id) ON DELETE CASCADE,
      vehicle_condition TEXT,
      engine_condition TEXT,
      body_condition TEXT,
      paint_condition TEXT,
      upholstery_condition TEXT,
      tire_condition TEXT,
      wheel_type TEXT,
      door_count INTEGER,
      seat_type TEXT,
      sound_system TEXT,
      chassis_condition TEXT,
      vehicle_restrictions TEXT,
      tax_status TEXT,
      debt_notes TEXT,
      reference_code TEXT,
      extraction_confidence TEXT,
      unmapped_details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS storage_migrations (
      id BIGSERIAL PRIMARY KEY,
      lot_media_id BIGINT NOT NULL REFERENCES lot_media(id) ON DELETE CASCADE,
      from_provider TEXT NOT NULL,
      from_tier TEXT NOT NULL,
      to_provider TEXT NOT NULL,
      to_tier TEXT NOT NULL,
      status TEXT NOT NULL,
      source_key TEXT,
      destination_key TEXT,
      expected_hash TEXT,
      verified_hash TEXT,
      error TEXT,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finished_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS object_storage_metrics (
      bucket_hour TIMESTAMPTZ NOT NULL,
      storage_provider TEXT NOT NULL,
      operation TEXT NOT NULL,
      media_type TEXT NOT NULL,
      site TEXT NOT NULL,
      success BOOLEAN NOT NULL,
      request_count BIGINT NOT NULL DEFAULT 0,
      bytes_in BIGINT NOT NULL DEFAULT 0,
      bytes_out BIGINT NOT NULL DEFAULT 0,
      PRIMARY KEY (bucket_hour,storage_provider,operation,media_type,site,success)
    );

    CREATE TABLE IF NOT EXISTS lot_bid_history (
      id BIGSERIAL PRIMARY KEY,
      market_lot_id BIGINT NOT NULL REFERENCES market_lots(id) ON DELETE CASCADE,
      source_key TEXT NOT NULL,
      source_order INTEGER,
      amount NUMERIC(16,2) NOT NULL,
      bidder_alias TEXT,
      bid_type TEXT,
      observed_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(market_lot_id, source_key)
    );

    CREATE TABLE IF NOT EXISTS collection_sources (
      id BIGSERIAL PRIMARY KEY,
      site TEXT NOT NULL,
      url TEXT NOT NULL UNIQUE,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      scan_interval_minutes INTEGER NOT NULL DEFAULT 360,
      last_scan_at TIMESTAMPTZ,
      next_scan_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS collection_runs (
      id BIGSERIAL PRIMARY KEY,
      source_id BIGINT REFERENCES collection_sources(id) ON DELETE SET NULL,
      started_at TIMESTAMPTZ NOT NULL,
      finished_at TIMESTAMPTZ,
      status TEXT NOT NULL,
      discovered_count INTEGER NOT NULL DEFAULT 0,
      collected_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      new_count INTEGER NOT NULL DEFAULT 0,
      updated_count INTEGER NOT NULL DEFAULT 0,
      unchanged_count INTEGER NOT NULL DEFAULT 0,
      site TEXT,
      error TEXT
    );

    ALTER TABLE collection_runs ADD COLUMN IF NOT EXISTS new_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE collection_runs ADD COLUMN IF NOT EXISTS updated_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE collection_runs ADD COLUMN IF NOT EXISTS unchanged_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE collection_runs ADD COLUMN IF NOT EXISTS site TEXT;

    UPDATE collection_runs
    SET status='failed', finished_at=COALESCE(finished_at,NOW()),
      error=COALESCE(error,'Execução interrompida antes da conclusão.')
    WHERE status='running';

    CREATE INDEX IF NOT EXISTS idx_market_lots_due ON market_lots (finalized_at, next_check_at);
    CREATE INDEX IF NOT EXISTS idx_collection_runs_started ON collection_runs (started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_market_lots_analysis ON market_lots (brand, model, model_year, sale_status);
    CREATE INDEX IF NOT EXISTS idx_market_lots_event ON market_lots (event_id, lot_number);
    CREATE INDEX IF NOT EXISTS idx_market_lots_site ON market_lots (site);
    CREATE INDEX IF NOT EXISTS idx_market_lots_status ON market_lots (sale_phase, sale_result, sale_status);
    CREATE INDEX IF NOT EXISTS idx_market_lots_canonical_status ON market_lots (canonical_status);
    CREATE INDEX IF NOT EXISTS idx_market_lots_location ON market_lots (state, city);
    CREATE INDEX IF NOT EXISTS idx_market_lots_origin ON market_lots (origin);
    CREATE INDEX IF NOT EXISTS idx_market_lots_consignor ON market_lots (consignor);
    CREATE INDEX IF NOT EXISTS idx_market_lots_classification ON market_lots (classification);
    CREATE INDEX IF NOT EXISTS idx_market_lots_asset_type ON market_lots (asset_type);
    CREATE INDEX IF NOT EXISTS idx_market_lots_vehicle_details ON market_lots (fuel, transmission, running_at_entry);
    CREATE INDEX IF NOT EXISTS idx_snapshots_lot_time ON lot_snapshots (market_lot_id, observed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_change_log_lot_time ON lot_change_log (market_lot_id, observed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_lot_media_pending ON lot_media (download_status, download_attempts, id);
    CREATE INDEX IF NOT EXISTS idx_lot_media_lot ON lot_media (market_lot_id, type, position);
    CREATE INDEX IF NOT EXISTS idx_lot_media_hash ON lot_media (content_hash);
    CREATE INDEX IF NOT EXISTS idx_lot_media_storage_tier ON lot_media (storage_provider,storage_tier,last_accessed_at);
    CREATE INDEX IF NOT EXISTS idx_real_estate_location ON real_estate_details (state_code,city_code,neighborhood_normalized);
    CREATE INDEX IF NOT EXISTS idx_real_estate_type ON real_estate_details (property_type,occupancy_status,accepts_financing);
    CREATE INDEX IF NOT EXISTS idx_vehicle_details_condition ON vehicle_details (vehicle_condition,engine_condition);
    CREATE INDEX IF NOT EXISTS idx_storage_migrations_status ON storage_migrations (status,started_at);
    CREATE INDEX IF NOT EXISTS idx_object_storage_metrics_hour ON object_storage_metrics (bucket_hour DESC);
    CREATE INDEX IF NOT EXISTS idx_lot_media_optimization ON lot_media (optimization_profile, optimization_attempts, id)
      WHERE type='image' AND download_status='downloaded';
    CREATE INDEX IF NOT EXISTS idx_bid_history_lot_time ON lot_bid_history (market_lot_id, observed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sources_due ON collection_sources (enabled, next_scan_at);

    DROP VIEW IF EXISTS market_lot_analysis;
    CREATE VIEW market_lot_analysis AS
    SELECT
      ml.*,
      COALESCE(ml.final_bid, ml.current_bid) AS effective_bid,
      COALESCE(ml.commission_fee, 0) + COALESCE(ml.buyer_fee, 0) + COALESCE(ml.other_fees, 0) AS known_fees,
      COALESCE(
        ml.total_cost,
        COALESCE(ml.final_bid, ml.current_bid) + COALESCE(ml.commission_fee, 0) +
          COALESCE(ml.buyer_fee, 0) + COALESCE(ml.other_fees, 0)
      ) AS effective_total_cost,
      CASE
        WHEN ml.total_cost IS NOT NULL THEN 'reported_total'
        WHEN ml.commission_fee IS NOT NULL OR ml.buyer_fee IS NOT NULL OR ml.other_fees IS NOT NULL THEN 'partial_fees'
        ELSE 'bid_only'
      END AS financial_data_quality
    FROM market_lots ml;

    INSERT INTO lot_change_log (
      market_lot_id,change_key,change_type,field_name,value_type,old_value,new_value,observed_at
    )
    SELECT DISTINCT ON (s.market_lot_id)
      s.market_lot_id,'snapshot:'||s.id||':discovered','discovered',NULL,NULL,NULL,
      COALESCE(s.sale_status, s.current_bid::text),s.observed_at
    FROM lot_snapshots s
    WHERE NOT EXISTS (
      SELECT 1 FROM lot_change_log existing
      WHERE existing.market_lot_id=s.market_lot_id AND existing.change_type='discovered'
        AND existing.observed_at=s.observed_at
    )
    ORDER BY s.market_lot_id,s.observed_at,s.id
    ON CONFLICT(change_key) DO NOTHING;

    WITH ordered AS (
      SELECT s.*,
        LAG(s.id) OVER lot_order AS previous_id,
        LAG(s.current_bid) OVER lot_order AS previous_current_bid,
        LAG(s.final_bid) OVER lot_order AS previous_final_bid,
        LAG(s.total_cost) OVER lot_order AS previous_total_cost,
        LAG(s.sale_status) OVER lot_order AS previous_sale_status,
        LAG(s.auction_end) OVER lot_order AS previous_auction_end
      FROM lot_snapshots s
      WINDOW lot_order AS (PARTITION BY s.market_lot_id ORDER BY s.observed_at,s.id)
    )
    INSERT INTO lot_change_log (
      market_lot_id,change_key,change_type,field_name,value_type,old_value,new_value,observed_at
    )
    SELECT o.market_lot_id,'snapshot:'||o.id||':'||change.field_name,
      CASE WHEN change.field_name='sale_status' THEN 'status_changed'
           WHEN change.field_name='auction_end' THEN 'schedule_changed'
           ELSE 'value_changed' END,
      change.field_name,change.value_type,change.old_value,change.new_value,o.observed_at
    FROM ordered o
    CROSS JOIN LATERAL (VALUES
      ('current_bid','money',o.previous_current_bid::text,o.current_bid::text),
      ('final_bid','money',o.previous_final_bid::text,o.final_bid::text),
      ('total_cost','money',o.previous_total_cost::text,o.total_cost::text),
      ('sale_status','status',o.previous_sale_status,o.sale_status),
      ('auction_end','datetime',o.previous_auction_end::text,o.auction_end::text)
    ) AS change(field_name,value_type,old_value,new_value)
    WHERE o.previous_id IS NOT NULL AND change.old_value IS DISTINCT FROM change.new_value
      AND NOT EXISTS (
        SELECT 1 FROM lot_change_log existing
        WHERE existing.market_lot_id=o.market_lot_id AND existing.field_name=change.field_name
          AND existing.old_value IS NOT DISTINCT FROM change.old_value
          AND existing.new_value IS NOT DISTINCT FROM change.new_value
          AND existing.observed_at=o.observed_at
      )
    ON CONFLICT(change_key) DO NOTHING;

    DELETE FROM lot_change_log duplicate
    USING lot_change_log original
    WHERE duplicate.id>original.id
      AND duplicate.market_lot_id=original.market_lot_id
      AND duplicate.change_type=original.change_type
      AND duplicate.field_name IS NOT DISTINCT FROM original.field_name
      AND duplicate.old_value IS NOT DISTINCT FROM original.old_value
      AND duplicate.new_value IS NOT DISTINCT FROM original.new_value
      AND duplicate.observed_at=original.observed_at;
  `);
}
