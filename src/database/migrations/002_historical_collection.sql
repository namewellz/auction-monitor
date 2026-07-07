CREATE TABLE IF NOT EXISTS auction_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site TEXT NOT NULL,
  external_code TEXT,
  name TEXT,
  url TEXT,
  starts_at DATETIME,
  ends_at DATETIME,
  city TEXT,
  state TEXT,
  first_seen_at DATETIME NOT NULL,
  last_seen_at DATETIME NOT NULL,
  UNIQUE(site, external_code)
);

CREATE TABLE IF NOT EXISTS market_lots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER,
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
  running_at_entry INTEGER,
  origin TEXT,
  consignor TEXT,
  city TEXT,
  state TEXT,
  address TEXT,
  yard_name TEXT,
  observations TEXT,
  sale_status TEXT,
  current_bid REAL,
  next_bid REAL,
  final_bid REAL,
  commission_fee REAL,
  buyer_fee REAL,
  other_fees REAL,
  total_cost REAL,
  auction_start DATETIME,
  auction_end DATETIME NOT NULL,
  sold_at DATETIME,
  first_seen_at DATETIME NOT NULL,
  last_seen_at DATETIME NOT NULL,
  last_checked_at DATETIME NOT NULL,
  next_check_at DATETIME NOT NULL,
  recheck_count INTEGER NOT NULL DEFAULT 0,
  finalized_at DATETIME,
  raw_data_json TEXT NOT NULL,
  FOREIGN KEY (event_id) REFERENCES auction_events(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS lot_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  market_lot_id INTEGER NOT NULL,
  observed_at DATETIME NOT NULL,
  current_bid REAL,
  next_bid REAL,
  final_bid REAL,
  sale_status TEXT,
  commission_fee REAL,
  buyer_fee REAL,
  other_fees REAL,
  total_cost REAL,
  auction_end DATETIME NOT NULL,
  data_hash TEXT NOT NULL,
  raw_data_json TEXT NOT NULL,
  FOREIGN KEY (market_lot_id) REFERENCES market_lots(id) ON DELETE CASCADE,
  UNIQUE(market_lot_id, data_hash)
);

CREATE TABLE IF NOT EXISTS lot_media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  market_lot_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  source_url TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  first_seen_at DATETIME NOT NULL,
  last_seen_at DATETIME NOT NULL,
  FOREIGN KEY (market_lot_id) REFERENCES market_lots(id) ON DELETE CASCADE,
  UNIQUE(market_lot_id, source_url)
);

CREATE TABLE IF NOT EXISTS collection_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1,
  scan_interval_minutes INTEGER NOT NULL DEFAULT 360,
  last_scan_at DATETIME,
  next_scan_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS collection_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER,
  started_at DATETIME NOT NULL,
  finished_at DATETIME,
  status TEXT NOT NULL,
  discovered_count INTEGER NOT NULL DEFAULT 0,
  collected_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  FOREIGN KEY (source_id) REFERENCES collection_sources(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_market_lots_due ON market_lots (finalized_at, next_check_at);
CREATE INDEX IF NOT EXISTS idx_market_lots_analysis ON market_lots (brand, model, model_year, sale_status);
CREATE INDEX IF NOT EXISTS idx_market_lots_event ON market_lots (event_id, lot_number);
CREATE INDEX IF NOT EXISTS idx_snapshots_lot_time ON lot_snapshots (market_lot_id, observed_at);
CREATE INDEX IF NOT EXISTS idx_lot_media_lot ON lot_media (market_lot_id, type, position);
CREATE INDEX IF NOT EXISTS idx_sources_due ON collection_sources (enabled, next_scan_at);

CREATE VIEW IF NOT EXISTS market_lot_analysis AS
SELECT
  ml.*,
  COALESCE(ml.final_bid, ml.current_bid) AS effective_bid,
  COALESCE(ml.commission_fee, 0) + COALESCE(ml.buyer_fee, 0) + COALESCE(ml.other_fees, 0) AS known_fees,
  COALESCE(
    ml.total_cost,
    COALESCE(ml.final_bid, ml.current_bid) +
      COALESCE(ml.commission_fee, 0) +
      COALESCE(ml.buyer_fee, 0) +
      COALESCE(ml.other_fees, 0)
  ) AS effective_total_cost,
  CASE
    WHEN ml.total_cost IS NOT NULL THEN 'reported_total'
    WHEN ml.commission_fee IS NOT NULL OR ml.buyer_fee IS NOT NULL OR ml.other_fees IS NOT NULL THEN 'partial_fees'
    ELSE 'bid_only'
  END AS financial_data_quality
FROM market_lots ml;
