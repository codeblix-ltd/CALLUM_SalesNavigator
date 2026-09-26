-- A target can have several historical intents from the pre-guard test period.
-- Preserve them as evidence, then reserve each target once for all future V2 actions.
CREATE TABLE IF NOT EXISTS callum_v2.action_targets (
  action_type STRING NOT NULL CHECK (action_type IN ('connect','comment','withdraw')),
  target_key STRING NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (action_type, target_key)
);

INSERT INTO callum_v2.action_targets (action_type, target_key)
SELECT DISTINCT action_type, target_key FROM callum_v2.action_intents
ON CONFLICT (action_type, target_key) DO NOTHING;
