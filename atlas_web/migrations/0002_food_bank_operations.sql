ALTER TABLE sites ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS service_radius_miles numeric NOT NULL DEFAULT 25;

CREATE TABLE IF NOT EXISTS inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  site_id uuid NOT NULL REFERENCES sites(id),
  product_name text NOT NULL,
  brand text,
  category text NOT NULL,
  subcategory text,
  quantity numeric NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  unit text NOT NULL DEFAULT 'units',
  lot_number text,
  expiration_date date,
  warehouse_zone text,
  bin_location text,
  condition text NOT NULL DEFAULT 'good' CHECK (condition IN ('good','damaged','quarantined','expired')),
  source_name text,
  barcode text,
  notes text,
  row_version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES users(id),
  updated_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inventory_item_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_item_id uuid NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  changed_by uuid NOT NULL REFERENCES users(id),
  before_value jsonb,
  after_value jsonb NOT NULL,
  change_reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES agents(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  site_id uuid NOT NULL REFERENCES sites(id),
  recommendation_type text NOT NULL CHECK (recommendation_type IN ('expiration','low_stock','missing_location','quarantine_review')),
  title text NOT NULL,
  explanation text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}',
  proposed_action jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','dismissed')),
  decided_by uuid REFERENCES users(id),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_items_site ON inventory_items(site_id, category, expiration_date);
CREATE INDEX IF NOT EXISTS idx_inventory_items_location ON inventory_items(site_id, warehouse_zone, bin_location);
CREATE INDEX IF NOT EXISTS idx_inventory_changes_item ON inventory_item_changes(inventory_item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_recommendations_site ON agent_recommendations(site_id, status, created_at DESC);
