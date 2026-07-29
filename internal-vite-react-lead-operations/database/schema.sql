CREATE TABLE IF NOT EXISTS lead_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_file STRING NOT NULL,
  niche STRING NOT NULL,
  sha256 STRING NOT NULL,
  file_bytes INT8 NOT NULL,
  status STRING NOT NULL CHECK (status IN ('importing', 'completed', 'failed')),
  processed_rows INT8 NOT NULL DEFAULT 0,
  error_message STRING NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ NULL,
  UNIQUE (sha256, niche)
);

CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_key STRING NOT NULL UNIQUE,
  full_name STRING NULL,
  first_name STRING NULL,
  last_name STRING NULL,
  domain STRING NULL,
  company_name STRING NULL,
  current_title STRING NULL,
  linkedin_url STRING NOT NULL,
  geographic_region STRING NULL,
  company_industry STRING NULL,
  company_size STRING NULL,
  company_linkedin STRING NULL,
  employee_count INT8 NULL,
  company_location STRING NULL,
  founded_year INT4 NULL,
  connection_degree STRING NULL,
  premium BOOL NULL,
  company_description STRING NULL,
  summary STRING NULL,
  search_text STRING NOT NULL DEFAULT '',
  source_file STRING NOT NULL,
  source_row INT8 NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS leads_search_text_trgm_idx
  ON leads USING GIN (search_text gin_trgm_ops);

CREATE TABLE IF NOT EXISTS lead_niches (
  niche STRING NOT NULL,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  first_seen_import_id UUID NULL REFERENCES lead_imports(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (niche, lead_id)
);

CREATE INDEX IF NOT EXISTS lead_niches_by_lead_id
  ON lead_niches (lead_id);

CREATE TABLE IF NOT EXISTS niches (
  name STRING PRIMARY KEY,
  lead_count INT8 NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lead_stats (
  key STRING PRIMARY KEY,
  total_count INT8 NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT lead_stats_singleton CHECK (key = 'all')
);

CREATE TABLE IF NOT EXISTS lead_assignments (
  lead_id UUID PRIMARY KEY REFERENCES leads(id) ON DELETE CASCADE,
  operator_id STRING NOT NULL,
  status STRING NOT NULL DEFAULT 'assigned'
    CHECK (status IN ('assigned', 'viewed', 'engaged', 'connected', 'skipped', 'failed')),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error STRING NULL
);

CREATE INDEX IF NOT EXISTS lead_assignments_by_operator_id_and_status
  ON lead_assignments (operator_id, status, lead_id);

UPSERT INTO lead_stats (key, total_count, updated_at)
SELECT 'all', count(*), now() FROM leads;
