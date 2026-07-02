-- Migration 002: Add UNIQUE constraint on tx_hash to prevent duplicate/replayed payments

-- Drop the existing non-unique index if present
DROP INDEX IF EXISTS idx_tx_hash;

-- Remove duplicates before adding the constraint (keep the earliest)
DELETE FROM transactions a USING transactions b
WHERE a.tx_hash = b.tx_hash AND a.id > b.id;

ALTER TABLE transactions ADD CONSTRAINT uq_tx_hash UNIQUE (tx_hash);
