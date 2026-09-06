CREATE TABLE IF NOT EXISTS board_operations (
  cursor BIGSERIAL PRIMARY KEY,
  board_id VARCHAR(80) NOT NULL,
  operation_id VARCHAR(170) NOT NULL,
  operation JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (board_id, operation_id)
);

CREATE INDEX IF NOT EXISTS board_operations_replay_idx
ON board_operations (board_id, cursor);
