CREATE TABLE IF NOT EXISTS operational_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), site_id uuid NOT NULL REFERENCES sites(id), organization_id uuid NOT NULL REFERENCES organizations(id),
 trigger_type text NOT NULL, status text NOT NULL CHECK(status IN ('running','awaiting_human','completed','failed')),
 initiated_by uuid NOT NULL REFERENCES users(id), summary jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
CREATE TABLE IF NOT EXISTS operational_steps (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), operational_run_id uuid NOT NULL REFERENCES operational_runs(id) ON DELETE CASCADE,
 agent_name text NOT NULL, sequence integer NOT NULL, status text NOT NULL, input jsonb NOT NULL DEFAULT '{}', output jsonb NOT NULL DEFAULT '{}', explanation text NOT NULL,
 requires_human_approval boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(operational_run_id,sequence)
);
CREATE TABLE IF NOT EXISTS disruption_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), site_id uuid NOT NULL REFERENCES sites(id), source text NOT NULL, external_id text NOT NULL,
 event_type text NOT NULL, severity text, headline text NOT NULL, starts_at timestamptz, ends_at timestamptz, payload jsonb NOT NULL,
 fetched_at timestamptz NOT NULL DEFAULT now(), UNIQUE(site_id,source,external_id)
);
CREATE TABLE IF NOT EXISTS transport_plans (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), operational_run_id uuid NOT NULL REFERENCES operational_runs(id), from_site_id uuid REFERENCES sites(id),
 to_site_id uuid NOT NULL REFERENCES sites(id), category text NOT NULL, quantity numeric NOT NULL, distance_miles numeric NOT NULL, estimated_minutes integer NOT NULL,
 status text NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','approved','rejected','dispatched','delivered')), requires_refrigeration boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS operational_runs_site_idx ON operational_runs(site_id,created_at DESC);
CREATE INDEX IF NOT EXISTS disruption_events_site_idx ON disruption_events(site_id,fetched_at DESC);
