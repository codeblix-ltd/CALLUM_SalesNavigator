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
  -- The address exposed by LinkedIn contact info belongs to the member's
  -- LinkedIn account. Mailmeteor's company-domain result is stored separately.
  original_email STRING NULL,
  original_email_collected_at TIMESTAMPTZ NULL,
  work_email STRING NULL,
  work_email_collected_at TIMESTAMPTZ NULL,
  work_email_status STRING NOT NULL DEFAULT 'pending',
  work_email_validation STRING NULL,
  work_email_source STRING NULL,
  work_email_checked_at TIMESTAMPTZ NULL,
  work_email_resolved_linkedin_url STRING NULL,
  work_email_last_error STRING NULL,
  work_email_http_status INT4 NULL,
  search_text STRING NOT NULL DEFAULT '',
  source_file STRING NOT NULL,
  source_row INT8 NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS original_email STRING NULL,
  ADD COLUMN IF NOT EXISTS original_email_collected_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS work_email STRING NULL,
  ADD COLUMN IF NOT EXISTS work_email_collected_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS work_email_status STRING NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS work_email_validation STRING NULL,
  ADD COLUMN IF NOT EXISTS work_email_source STRING NULL,
  ADD COLUMN IF NOT EXISTS work_email_checked_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS work_email_resolved_linkedin_url STRING NULL,
  ADD COLUMN IF NOT EXISTS work_email_last_error STRING NULL,
  ADD COLUMN IF NOT EXISTS work_email_http_status INT4 NULL;

ALTER TABLE leads
  DROP CONSTRAINT IF EXISTS leads_work_email_status_check;

ALTER TABLE leads
  ADD CONSTRAINT leads_work_email_status_check
  CHECK (work_email_status IN ('pending', 'processing', 'found', 'not_found', 'error'));

CREATE INDEX IF NOT EXISTS leads_search_text_trgm_idx
  ON leads USING GIN (search_text gin_trgm_ops);

CREATE INDEX IF NOT EXISTS leads_by_work_email_status
  ON leads (work_email_status, work_email_checked_at, id);

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
      'withdrawn',
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
  resolved_linkedin_url STRING NULL,
  connection_request_reserved_on DATE NULL,
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
  ADD COLUMN IF NOT EXISTS resolved_linkedin_url STRING NULL,
  ADD COLUMN IF NOT EXISTS connection_request_reserved_on DATE NULL,
  ADD COLUMN IF NOT EXISTS email STRING NULL,
  ADD COLUMN IF NOT EXISTS last_error_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS withdrawn_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS replied_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS qualification_status STRING NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS qualification_note STRING NULL,
  ADD COLUMN IF NOT EXISTS recent_post_checked_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS has_recent_post BOOL NULL,
  ADD COLUMN IF NOT EXISTS icp_score INT4 NULL;

-- Preserve every address collected before the two explicit lead email fields
-- were introduced. The legacy assignment column remains as a compatibility
-- bridge while all current reads and writes use leads.original_email.
UPDATE leads AS l
   SET original_email = a.email,
       original_email_collected_at = a.email_collected_at
  FROM lead_assignments AS a
 WHERE a.lead_id = l.id
   AND l.original_email IS NULL
   AND a.email IS NOT NULL;

ALTER TABLE lead_assignments
  DROP CONSTRAINT IF EXISTS lead_assignments_qualification_status_check;

ALTER TABLE lead_assignments
  ADD CONSTRAINT lead_assignments_qualification_status_check
  CHECK (qualification_status IN ('pending', 'qualified', 'not_qualified'));

ALTER TABLE lead_assignments
  DROP CONSTRAINT IF EXISTS lead_assignments_icp_score_check;

ALTER TABLE lead_assignments
  ADD CONSTRAINT lead_assignments_icp_score_check
  CHECK (icp_score IS NULL OR icp_score BETWEEN 0 AND 100);

ALTER TABLE lead_assignments
  DROP CONSTRAINT IF EXISTS check_status;

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
    'withdrawn',
    'skipped',
    'failed'
  ));

CREATE INDEX IF NOT EXISTS lead_assignments_by_operator_id_and_status
  ON lead_assignments (operator_id, status, lead_id);

CREATE INDEX IF NOT EXISTS lead_assignments_by_operator_id_and_qualification
  ON lead_assignments (operator_id, qualification_status, assigned_at, lead_id);

CREATE INDEX IF NOT EXISTS lead_assignments_by_status_and_request_time
  ON lead_assignments (status, connection_requested_at, lead_id);

CREATE TABLE IF NOT EXISTS operator_settings (
  operator_id STRING PRIMARY KEY,
  post_engagements INT4 NOT NULL DEFAULT 3
    CHECK (post_engagements BETWEEN 1 AND 10),
  linkedin_premium BOOL NOT NULL DEFAULT false,
  linkedin_premium_verified_at TIMESTAMPTZ NULL,
  connection_daily_limit INT4 NOT NULL DEFAULT 20
    CHECK (connection_daily_limit BETWEEN 1 AND 40),
  engagement_daily_limit INT4 NOT NULL DEFAULT 150
    CHECK (engagement_daily_limit BETWEEN 1 AND 250),
  onboarding_completed BOOL NOT NULL DEFAULT false,
  include_note BOOL NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE operator_settings
  ADD COLUMN IF NOT EXISTS linkedin_premium BOOL NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS linkedin_premium_verified_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS connection_daily_limit INT4 NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS engagement_daily_limit INT4 NOT NULL DEFAULT 150,
  ADD COLUMN IF NOT EXISTS onboarding_completed BOOL NOT NULL DEFAULT false;

-- Review/connection intervals never controlled the extension execution flow.
-- Daily, per-scout counters now provide the pacing contract instead.
ALTER TABLE operator_settings
  DROP COLUMN IF EXISTS engagement_interval_minutes,
  DROP COLUMN IF EXISTS connection_delay_minutes;

ALTER TABLE operator_settings
  DROP CONSTRAINT IF EXISTS check_post_engagements;

UPDATE operator_settings
   SET post_engagements = 1
 WHERE post_engagements < 1;

ALTER TABLE operator_settings
  ADD CONSTRAINT check_post_engagements
  CHECK (post_engagements BETWEEN 1 AND 10);

ALTER TABLE operator_settings
  DROP CONSTRAINT IF EXISTS check_connection_daily_limit;

ALTER TABLE operator_settings
  ADD CONSTRAINT check_connection_daily_limit
  CHECK (
    connection_daily_limit BETWEEN 1 AND
      CASE WHEN linkedin_premium THEN 40 ELSE 20 END
  );

ALTER TABLE operator_settings
  DROP CONSTRAINT IF EXISTS check_engagement_daily_limit;

-- The likes limit is a plan cap, not a separate operator setting. Every run can
-- like at most one post engagement for each request × recent-post combination.
UPDATE operator_settings
   SET connection_daily_limit = LEAST(
         connection_daily_limit,
         CASE WHEN linkedin_premium THEN 40 ELSE 20 END
       ),
       engagement_daily_limit = CASE
         WHEN linkedin_premium THEN 250
         ELSE 150
       END;

ALTER TABLE operator_settings
  ADD CONSTRAINT check_engagement_daily_limit
  CHECK (
    engagement_daily_limit =
      CASE WHEN linkedin_premium THEN 250 ELSE 150 END
  );

UPDATE operator_settings
   SET post_engagements = LEAST(
         post_engagements,
         CASE
           WHEN linkedin_premium
             THEN floor(250.0 / connection_daily_limit)::INT4
           ELSE floor(150.0 / connection_daily_limit)::INT4
         END
       );

ALTER TABLE operator_settings
  DROP CONSTRAINT IF EXISTS check_daily_engagement_product;

ALTER TABLE operator_settings
  ADD CONSTRAINT check_daily_engagement_product
  CHECK (
    connection_daily_limit * post_engagements <=
      CASE WHEN linkedin_premium THEN 250 ELSE 150 END
  );

-- Premium rows saved before live-account verification must pass through the new
-- gated setup once before automation can run again.
UPDATE operator_settings
   SET onboarding_completed = false,
       include_note = false
 WHERE linkedin_premium
   AND linkedin_premium_verified_at IS NULL;

CREATE TABLE IF NOT EXISTS operator_daily_usage (
  operator_id STRING NOT NULL,
  usage_date DATE NOT NULL,
  requests_sent INT4 NOT NULL DEFAULT 0 CHECK (requests_sent >= 0),
  likes_used INT4 NOT NULL DEFAULT 0 CHECK (likes_used >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (operator_id, usage_date)
);

CREATE TABLE IF NOT EXISTS operator_connection_review_checkpoints (
  operator_id STRING PRIMARY KEY,
  top_profile_url STRING NULL,
  top_connected_on DATE NULL,
  last_reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lead_post_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  operator_id STRING NOT NULL,
  profile_url STRING NOT NULL,
  post_url STRING NOT NULL,
  post_text STRING NOT NULL,
  comment_text STRING NOT NULL,
  liked BOOL NOT NULL DEFAULT false,
  liked_at TIMESTAMPTZ NULL,
  commented_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (operator_id, lead_id, post_url)
);

CREATE INDEX IF NOT EXISTS lead_post_activities_by_operator_id_and_commented_at
  ON lead_post_activities (operator_id, commented_at DESC);

CREATE INDEX IF NOT EXISTS lead_post_activities_by_lead_id_and_commented_at
  ON lead_post_activities (lead_id, commented_at DESC);

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

-- Each accepted lead gets three small, manual follow-up tasks. The extension
-- only helps the scout copy the message and record the outcome; it does not
-- send LinkedIn messages for them.
CREATE TABLE IF NOT EXISTS lead_followup_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  operator_id STRING NOT NULL,
  step INT4 NOT NULL CHECK (step BETWEEN 1 AND 3),
  due_at TIMESTAMPTZ NOT NULL,
  status STRING NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'skipped', 'cancelled')),
  message_text STRING NOT NULL,
  completed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (lead_id, operator_id, step)
);

CREATE INDEX IF NOT EXISTS lead_followup_tasks_by_operator_and_due_at
  ON lead_followup_tasks (operator_id, status, due_at, id);

-- Daily tasks are created lazily when a scout opens the extension. The keys
-- keep the checklist idempotent if the extension is refreshed many times.
CREATE TABLE IF NOT EXISTS operator_daily_tasks (
  operator_id STRING NOT NULL,
  task_date DATE NOT NULL,
  task_key STRING NOT NULL,
  label STRING NOT NULL,
  help_text STRING NOT NULL,
  completed BOOL NOT NULL DEFAULT false,
  completed_at TIMESTAMPTZ NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (operator_id, task_date, task_key)
);

CREATE TABLE IF NOT EXISTS scout_escalations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id STRING NOT NULL,
  lead_id UUID NULL REFERENCES leads(id) ON DELETE SET NULL,
  subject STRING NOT NULL,
  message STRING NOT NULL,
  status STRING NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'resolved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ NULL,
  resolved_by STRING NULL
);

CREATE INDEX IF NOT EXISTS scout_escalations_by_status_and_created_at
  ON scout_escalations (status, created_at DESC);

CREATE INDEX IF NOT EXISTS scout_escalations_by_operator_and_created_at
  ON scout_escalations (operator_id, created_at DESC);

-- Valid email records are queued for an optional CRM webhook. If no webhook
-- is configured, admins can still download the same clean rows as CSV.
CREATE TABLE IF NOT EXISTS crm_delivery_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  operator_id STRING NOT NULL,
  status STRING NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed')),
  attempt_count INT4 NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_attempt_at TIMESTAMPTZ NULL,
  sent_at TIMESTAMPTZ NULL,
  last_error STRING NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (lead_id, operator_id)
);

CREATE INDEX IF NOT EXISTS crm_delivery_outbox_by_status_and_created_at
  ON crm_delivery_outbox (status, created_at, id);

-- Pick up valid emails collected before this outbox was introduced. Values
-- such as "No Email" do not match and are never queued.
INSERT INTO crm_delivery_outbox (lead_id, operator_id, status)
SELECT lead_id, operator_id, 'pending'
  FROM lead_assignments
 WHERE email IS NOT NULL
   AND email LIKE '%_@_%._%'
   AND email NOT LIKE '% %'
ON CONFLICT (lead_id, operator_id) DO NOTHING;

-- Simulation runs are deliberately isolated from lead_assignments. The local
-- mock LinkedIn workflow may use an assigned lead as a fixture seed, but none
-- of its reactions, invitations, acceptances, or fixture contact data may
-- change the production lead lifecycle.
CREATE TABLE IF NOT EXISTS lead_simulation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  operator_id STRING NOT NULL,
  status STRING NOT NULL DEFAULT 'viewed'
    CHECK (status IN (
      'viewed',
      'engaged',
      'connection_requested',
      'accepted',
      'email_collected',
      'failed'
    )),
  posts_engaged INT4 NOT NULL DEFAULT 0
    CHECK (posts_engaged BETWEEN 0 AND 10),
  invitation_note STRING NULL,
  extracted_email STRING NULL,
  last_error STRING NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ NULL,
  UNIQUE (operator_id, lead_id)
);

CREATE INDEX IF NOT EXISTS lead_simulation_runs_by_operator_id_and_status
  ON lead_simulation_runs (operator_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS lead_simulation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  simulation_run_id UUID NOT NULL
    REFERENCES lead_simulation_runs(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  operator_id STRING NOT NULL,
  event_type STRING NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lead_simulation_events_by_run_id_and_created_at
  ON lead_simulation_events (simulation_run_id, created_at);

CREATE INDEX IF NOT EXISTS lead_simulation_events_by_operator_id_and_created_at
  ON lead_simulation_events (operator_id, created_at DESC);

-- The VPS gateway keeps the live Codex session in a private Docker volume and
-- mirrors auth.json here only after encrypting it with a gateway-only key.
CREATE TABLE IF NOT EXISTS codex_gateway_auth (
  id STRING PRIMARY KEY,
  encrypted_auth BYTES NOT NULL,
  nonce BYTES NOT NULL,
  auth_tag BYTES NOT NULL,
  plaintext_sha256 STRING NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT codex_gateway_auth_singleton CHECK (id = 'primary')
);

UPSERT INTO lead_stats (key, total_count, updated_at)
SELECT 'all', count(*), now() FROM leads;
