CREATE SCHEMA IF NOT EXISTS callum_v2;

CREATE TABLE IF NOT EXISTS callum_v2.schema_migrations (
  version STRING PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS callum_v2.operators (
  id STRING PRIMARY KEY,
  enabled BOOL NOT NULL DEFAULT true,
  daily_connection_limit INT4 NOT NULL DEFAULT 1 CHECK (daily_connection_limit BETWEEN 0 AND 40),
  cohort STRING NOT NULL DEFAULT 'dev',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS callum_v2.installations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id STRING NOT NULL REFERENCES callum_v2.operators(id),
  token_hash STRING NOT NULL UNIQUE,
  extension_version STRING NOT NULL,
  build_sha STRING NOT NULL,
  protocol_version INT4 NOT NULL,
  disabled BOOL NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NULL
);

CREATE TABLE IF NOT EXISTS callum_v2.runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id STRING NOT NULL REFERENCES callum_v2.operators(id),
  installation_id UUID NULL REFERENCES callum_v2.installations(id),
  mode STRING NOT NULL CHECK (mode IN ('synthetic','shadow','live_canary')),
  status STRING NOT NULL DEFAULT 'running' CHECK (status IN ('running','paused','completed','failed')),
  config_version INT8 NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS callum_v2.run_leads (
  run_id UUID NOT NULL REFERENCES callum_v2.runs(id),
  lead_id UUID NOT NULL,
  profile_key STRING NOT NULL,
  linkedin_url STRING NOT NULL,
  full_name STRING NULL,
  niche STRING NULL,
  stage STRING NOT NULL DEFAULT 'awaiting_observation',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, lead_id)
);

CREATE TABLE IF NOT EXISTS callum_v2.action_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES callum_v2.runs(id),
  operator_id STRING NOT NULL REFERENCES callum_v2.operators(id),
  lead_id UUID NOT NULL,
  action_type STRING NOT NULL CHECK (action_type IN ('connect','comment','withdraw')),
  target_key STRING NOT NULL,
  state STRING NOT NULL CHECK (state IN ('reserved','submitted','reconcile_required','confirmed','not_observed','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (operator_id, lead_id, action_type, target_key)
);

CREATE TABLE IF NOT EXISTS callum_v2.commands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES callum_v2.runs(id),
  operator_id STRING NOT NULL REFERENCES callum_v2.operators(id),
  lead_id UUID NOT NULL,
  installation_id UUID NULL REFERENCES callum_v2.installations(id),
  action_intent_id UUID NULL REFERENCES callum_v2.action_intents(id),
  type STRING NOT NULL CHECK (type IN ('INSPECT_PROFILE','EXECUTE_CONNECT','INSPECT_COMMENT_STATE','EXTRACT_CONTACT_INFO')),
  status STRING NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','leased','completed','uncertain','cancelled')),
  idempotency_key STRING NOT NULL UNIQUE,
  target_profile_key STRING NOT NULL,
  target_url STRING NOT NULL,
  config_version INT8 NOT NULL,
  protocol_version INT4 NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  result JSONB NULL,
  trace_id UUID NOT NULL DEFAULT gen_random_uuid(),
  expires_at TIMESTAMPTZ NOT NULL,
  lease_expires_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS commands_by_operator_status ON callum_v2.commands (operator_id, status, created_at, id);
CREATE INDEX IF NOT EXISTS commands_by_run ON callum_v2.commands (run_id, created_at, id);

CREATE TABLE IF NOT EXISTS callum_v2.command_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  command_id UUID NOT NULL REFERENCES callum_v2.commands(id),
  installation_id UUID NOT NULL REFERENCES callum_v2.installations(id),
  attempt_number INT4 NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ NULL,
  outcome STRING NULL,
  UNIQUE (command_id, attempt_number)
);

CREATE TABLE IF NOT EXISTS callum_v2.observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  command_id UUID NOT NULL UNIQUE REFERENCES callum_v2.commands(id),
  run_id UUID NOT NULL REFERENCES callum_v2.runs(id),
  lead_id UUID NOT NULL,
  facts JSONB NOT NULL,
  diagnostic_code STRING NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS callum_v2.events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key STRING NOT NULL UNIQUE,
  event_type STRING NOT NULL,
  operator_id STRING NULL,
  installation_id UUID NULL,
  run_id UUID NULL,
  lead_id UUID NULL,
  command_id UUID NULL,
  action_intent_id UUID NULL,
  extension_version STRING NULL,
  build_sha STRING NULL,
  protocol_version INT4 NULL,
  config_version INT8 NULL,
  diagnostic_code STRING NULL,
  details JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS events_by_run ON callum_v2.events (run_id, created_at DESC, id);
CREATE INDEX IF NOT EXISTS events_by_operator ON callum_v2.events (operator_id, created_at DESC, id);

CREATE TABLE IF NOT EXISTS callum_v2.remote_configs (
  version INT8 PRIMARY KEY,
  status STRING NOT NULL CHECK (status IN ('draft','canary','stable','disabled')),
  min_extension_version STRING NOT NULL,
  rollout_percent INT4 NOT NULL DEFAULT 0 CHECK (rollout_percent BETWEEN 0 AND 100),
  config JSONB NOT NULL,
  checksum STRING NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_at TIMESTAMPTZ NULL
);

CREATE TABLE IF NOT EXISTS callum_v2.feature_flags (
  flag_key STRING PRIMARY KEY,
  disabled BOOL NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS callum_v2.release_channels (
  channel STRING PRIMARY KEY,
  min_extension_version STRING NOT NULL,
  active_config_version INT8 NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS callum_v2.pay_rules (
  version INT8 PRIMARY KEY,
  event_type STRING NOT NULL,
  amount_minor INT8 NOT NULL CHECK (amount_minor >= 0),
  currency STRING NOT NULL,
  enabled BOOL NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS callum_v2.pay_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_intent_id UUID NOT NULL UNIQUE REFERENCES callum_v2.action_intents(id),
  operator_id STRING NOT NULL,
  run_id UUID NOT NULL,
  lead_id UUID NOT NULL,
  source_event_id UUID NOT NULL REFERENCES callum_v2.events(id),
  pay_rule_version INT8 NOT NULL REFERENCES callum_v2.pay_rules(version),
  amount_minor INT8 NOT NULL,
  currency STRING NOT NULL,
  status STRING NOT NULL DEFAULT 'pending_review',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS callum_v2.support_diagnostics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id STRING NOT NULL,
  installation_id UUID NULL,
  run_id UUID NULL,
  lead_id UUID NULL,
  command_id UUID NULL,
  action_intent_id UUID NULL,
  stage STRING NOT NULL,
  code STRING NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS diagnostics_by_operator ON callum_v2.support_diagnostics (operator_id, created_at DESC, id);

CREATE TABLE IF NOT EXISTS callum_v2.test_lead_snapshots (
  cohort STRING NOT NULL,
  lead_id UUID NOT NULL,
  profile_key STRING NOT NULL,
  linkedin_url STRING NOT NULL,
  full_name STRING NULL,
  niche STRING NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (cohort, lead_id)
);
