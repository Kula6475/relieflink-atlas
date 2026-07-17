CREATE TABLE IF NOT EXISTS operational_consignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operational_run_id uuid NOT NULL UNIQUE REFERENCES operational_runs(id) ON DELETE CASCADE,
  source_site_id uuid NOT NULL REFERENCES sites(id),
  destination_site_id uuid NOT NULL REFERENCES sites(id),
  category text NOT NULL,
  requested_quantity numeric NOT NULL CHECK(requested_quantity>0),
  offered_quantity numeric NOT NULL CHECK(offered_quantity>0),
  approved_quantity numeric,
  status text NOT NULL DEFAULT 'proposed' CHECK(status IN('proposed','approved','reserved','rejected','cancelled')),
  negotiation_mode text NOT NULL DEFAULT 'rules',
  negotiation_explanation text NOT NULL,
  approved_by uuid REFERENCES users(id),
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS operational_consignments_destination_idx ON operational_consignments(destination_site_id,created_at DESC);
