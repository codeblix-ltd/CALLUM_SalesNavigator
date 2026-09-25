-- V2-only expansion. Reapplying this migration replaces the same V2 constraint.
ALTER TABLE callum_v2.commands DROP CONSTRAINT IF EXISTS check_type;
ALTER TABLE callum_v2.commands ADD CONSTRAINT check_type CHECK
  (type IN ('INSPECT_PROFILE','EXECUTE_CONNECT','INSPECT_COMMENT_STATE','EXTRACT_CONTACT_INFO','INSPECT_PENDING_INVITATION'));
