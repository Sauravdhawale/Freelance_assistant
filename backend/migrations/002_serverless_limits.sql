CREATE TABLE IF NOT EXISTS request_limits (
  bucket text PRIMARY KEY,
  hits integer NOT NULL,
  reset_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS request_limits_expiry ON request_limits(reset_at);
