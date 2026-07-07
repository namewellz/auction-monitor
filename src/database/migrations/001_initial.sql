CREATE TABLE IF NOT EXISTS lots (
  id TEXT PRIMARY KEY,
  site TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  title TEXT,
  current_bid REAL,
  next_bid REAL,
  auction_end DATETIME,
  city TEXT,
  state TEXT,
  address TEXT,
  yard_name TEXT,
  observations TEXT,
  lot_number TEXT,
  external_code TEXT,
  running_at_entry INTEGER,
  origin TEXT,
  max_bid_limit REAL,
  monitoring_enabled INTEGER DEFAULT 1,
  last_check DATETIME,
  last_bid_change DATETIME,
  last_end_change DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS lot_alerts (
  lot_id TEXT NOT NULL,
  alert_key TEXT NOT NULL,
  sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (lot_id, alert_key),
  FOREIGN KEY (lot_id) REFERENCES lots(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_lots_monitoring ON lots (monitoring_enabled, auction_end);
