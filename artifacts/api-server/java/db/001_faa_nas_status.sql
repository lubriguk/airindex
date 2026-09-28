CREATE TABLE IF NOT EXISTS faa_nas_snapshots (
  id BIGSERIAL PRIMARY KEY,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_updated_at TIMESTAMPTZ,
  event_count INTEGER NOT NULL CHECK (event_count >= 0)
);

CREATE TABLE IF NOT EXISTS faa_nas_events (
  id BIGSERIAL PRIMARY KEY,
  snapshot_id BIGINT NOT NULL
    REFERENCES faa_nas_snapshots(id) ON DELETE CASCADE,
  airport VARCHAR(4) NOT NULL,
  event_type TEXT NOT NULL,
  reason TEXT,
  average_delay TEXT,
  maximum_delay TEXT,
  start_text TEXT,
  reopen_text TEXT
);

CREATE INDEX IF NOT EXISTS faa_nas_events_snapshot_airport_idx
  ON faa_nas_events (snapshot_id, airport);

CREATE INDEX IF NOT EXISTS faa_nas_snapshots_fetched_at_idx
  ON faa_nas_snapshots (fetched_at DESC);