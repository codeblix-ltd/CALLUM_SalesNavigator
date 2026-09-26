ALTER TABLE callum_v2.installations ADD COLUMN IF NOT EXISTS actor_profile_key STRING NULL;

ALTER TABLE callum_v2.commands DROP CONSTRAINT IF EXISTS check_type;
ALTER TABLE callum_v2.commands ADD CONSTRAINT check_type CHECK
  (type IN ('INSPECT_PROFILE','EXECUTE_CONNECT','INSPECT_COMMENT_STATE','EXTRACT_CONTACT_INFO','INSPECT_PENDING_INVITATION','EXECUTE_WITHDRAW','EXECUTE_COMMENT'));

CREATE TABLE IF NOT EXISTS callum_v2.comment_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES callum_v2.runs(id),
  lead_id UUID NOT NULL,
  inspection_command_id UUID NOT NULL REFERENCES callum_v2.commands(id),
  post_url STRING NOT NULL,
  body STRING NOT NULL,
  body_sha256 STRING NOT NULL,
  status STRING NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','rejected')),
  reviewer STRING NULL,
  action_intent_id UUID NULL UNIQUE REFERENCES callum_v2.action_intents(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ NULL
);
CREATE INDEX IF NOT EXISTS comment_drafts_by_run ON callum_v2.comment_drafts (run_id,created_at DESC);
