ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

CREATE INDEX IF NOT EXISTS inventory_items_active_site_idx
  ON inventory_items(site_id, expiration_date)
  WHERE archived_at IS NULL;
