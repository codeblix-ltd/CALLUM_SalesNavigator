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

-- COPY lands normalized rows here before chunked, idempotent merges. Keeping the
-- staging table separate avoids maintaining the expensive lead search index
-- while the local CSV is still streaming over the network.
CREATE TABLE IF NOT EXISTS lead_import_staging (
  import_id UUID NOT NULL,
  profile_key STRING NOT NULL,
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
  search_text STRING NOT NULL,
  source_file STRING NOT NULL,
  source_row INT8 NOT NULL
);

-- Staging is deliberately unindexed. Fast mode keeps only one small COPY chunk
-- here at a time, so an index would add write amplification without helping the
-- merge enough to justify it.
DROP INDEX IF EXISTS lead_import_staging@lead_import_staging_by_import_id_and_profile_key;

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
    CHECK (status IN (
      'assigned',
      'viewed',
      'engaged',
      'connected',
      'connection_requested',
      'accepted',
      'email_collected',
      'skipped',
      'failed'
    )),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  viewed_at TIMESTAMPTZ NULL,
  engaged_at TIMESTAMPTZ NULL,
  connection_requested_at TIMESTAMPTZ NULL,
  accepted_at TIMESTAMPTZ NULL,
  email_collected_at TIMESTAMPTZ NULL,
  email STRING NULL,
  last_error STRING NULL,
  last_error_at TIMESTAMPTZ NULL
);

ALTER TABLE lead_assignments
  ADD COLUMN IF NOT EXISTS viewed_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS engaged_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS connection_requested_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS email_collected_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS email STRING NULL,
  ADD COLUMN IF NOT EXISTS last_error_at TIMESTAMPTZ NULL;

ALTER TABLE lead_assignments
  DROP CONSTRAINT IF EXISTS lead_assignments_status_check;

ALTER TABLE lead_assignments
  ADD CONSTRAINT lead_assignments_status_check
  CHECK (status IN (
    'assigned',
    'viewed',
    'engaged',
    'connected',
    'connection_requested',
    'accepted',
    'email_collected',
    'skipped',
    'failed'
  ));

CREATE INDEX IF NOT EXISTS lead_assignments_by_operator_id_and_status
  ON lead_assignments (operator_id, status, lead_id);

CREATE TABLE IF NOT EXISTS operator_settings (
  operator_id STRING PRIMARY KEY,
  post_engagements INT4 NOT NULL DEFAULT 3
    CHECK (post_engagements BETWEEN 1 AND 10),
  engagement_interval_minutes INT8 NOT NULL DEFAULT 60
    CHECK (engagement_interval_minutes BETWEEN 1 AND 43200),
  connection_delay_minutes INT8 NOT NULL DEFAULT 1440
    CHECK (connection_delay_minutes BETWEEN 0 AND 43200),
  include_note BOOL NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lead_assignment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  operator_id STRING NOT NULL,
  event_type STRING NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lead_assignment_events_by_operator_id_and_created_at
  ON lead_assignment_events (operator_id, created_at DESC);

CREATE INDEX IF NOT EXISTS lead_assignment_events_by_lead_id_and_created_at
  ON lead_assignment_events (lead_id, created_at DESC);

UPSERT INTO lead_stats (key, total_count, updated_at)
SELECT 'all', count(*), now() FROM leads;
