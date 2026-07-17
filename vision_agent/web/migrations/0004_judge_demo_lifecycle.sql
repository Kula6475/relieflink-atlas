ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS inventory_item_id uuid REFERENCES inventory_items(id);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS demo_key text;
ALTER TABLE transfer_proposals ADD COLUMN IF NOT EXISTS minimum_quantity numeric;
ALTER TABLE transfer_proposals ADD COLUMN IF NOT EXISTS maximum_quantity numeric;
ALTER TABLE shipment_events ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS shipment_events_idempotency_idx ON shipment_events(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS inventory_transactions_item_idx ON inventory_transactions(inventory_item_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS organizations_demo_key_idx ON organizations(demo_key) WHERE demo_key IS NOT NULL;
