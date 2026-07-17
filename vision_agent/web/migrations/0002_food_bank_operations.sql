ALTER TABLE sites ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS service_radius_miles numeric(8,2) NOT NULL DEFAULT 15;

CREATE TABLE IF NOT EXISTS inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
  site_id uuid NOT NULL REFERENCES sites(id), product_name text NOT NULL, brand text, category text NOT NULL,
  subcategory text, quantity numeric(14,2) NOT NULL DEFAULT 0 CHECK(quantity>=0), unit text NOT NULL,
  lot_number text, expiration_date date, warehouse_zone text, bin_location text,
  condition text NOT NULL DEFAULT 'good' CHECK(condition IN ('good','damaged','quarantined','expired')),
  source_name text, barcode text, notes text, intake_method text NOT NULL DEFAULT 'manual' CHECK(intake_method IN ('manual','csv','vision')),
  vision_confidence numeric(6,5), row_version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES users(id), updated_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inventory_items_site_idx ON inventory_items(site_id,expiration_date);
CREATE TABLE IF NOT EXISTS inventory_item_changes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), inventory_item_id uuid NOT NULL REFERENCES inventory_items(id),
 organization_id uuid NOT NULL REFERENCES organizations(id), changed_by uuid NOT NULL REFERENCES users(id),
 before_value jsonb NOT NULL, after_value jsonb NOT NULL, change_reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
