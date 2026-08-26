import { veblenMatchExistsSql } from "./veblenExclusions";

export function leadCanReturnToPoolSql(leadAlias = "l", assignmentAlias = "a") {
  return `
    ${assignmentAlias}.status = 'assigned'
    AND ${assignmentAlias}.viewed_at IS NULL
    AND ${assignmentAlias}.engaged_at IS NULL
    AND ${assignmentAlias}.connection_requested_at IS NULL
    AND ${assignmentAlias}.accepted_at IS NULL
    AND ${assignmentAlias}.email_collected_at IS NULL
    AND ${assignmentAlias}.withdrawn_at IS NULL
    AND ${assignmentAlias}.replied_at IS NULL
    AND ${assignmentAlias}.resolved_linkedin_url IS NULL
    AND ${assignmentAlias}.connection_request_reserved_on IS NULL
    AND nullif(trim(coalesce(${assignmentAlias}.email, '')), '') IS NULL
    AND nullif(trim(coalesce(${assignmentAlias}.last_error, '')), '') IS NULL
    AND ${assignmentAlias}.last_error_at IS NULL
    AND coalesce(${assignmentAlias}.qualification_status, 'pending') = 'pending'
    AND nullif(trim(coalesce(${assignmentAlias}.qualification_note, '')), '') IS NULL
    AND ${assignmentAlias}.recent_post_checked_at IS NULL
    AND ${assignmentAlias}.has_recent_post IS NULL
    AND ${assignmentAlias}.icp_score IS NULL
    AND nullif(trim(coalesce(${leadAlias}.original_email, '')), '') IS NULL
    AND ${leadAlias}.original_email_collected_at IS NULL
    AND coalesce(${leadAlias}.original_email_status, 'pending') = 'pending'
    AND ${leadAlias}.original_email_checked_at IS NULL
    AND nullif(trim(coalesce(${leadAlias}.work_email, '')), '') IS NULL
    AND ${leadAlias}.work_email_collected_at IS NULL
    AND coalesce(${leadAlias}.work_email_status, 'pending') = 'pending'
    AND ${leadAlias}.work_email_validation IS NULL
    AND ${leadAlias}.work_email_source IS NULL
    AND ${leadAlias}.work_email_checked_at IS NULL
    AND ${leadAlias}.work_email_resolved_linkedin_url IS NULL
    AND nullif(trim(coalesce(${leadAlias}.work_email_last_error, '')), '') IS NULL
    AND ${leadAlias}.work_email_http_status IS NULL
    AND nullif(trim(coalesce(${leadAlias}.lead_note, '')), '') IS NULL
    AND ${leadAlias}.lead_note_updated_at IS NULL
    AND NOT (${veblenMatchExistsSql(leadAlias, assignmentAlias)})
    AND NOT EXISTS (
      SELECT 1
        FROM lead_assignment_events AS unassign_events
       WHERE unassign_events.lead_id = ${assignmentAlias}.lead_id
         AND unassign_events.event_type <> 'admin_unassigned'
    )
    AND NOT EXISTS (
      SELECT 1 FROM lead_post_activities AS unassign_posts
       WHERE unassign_posts.lead_id = ${assignmentAlias}.lead_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM lead_followup_tasks AS unassign_followups
       WHERE unassign_followups.lead_id = ${assignmentAlias}.lead_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM scout_escalations AS unassign_escalations
       WHERE unassign_escalations.lead_id = ${assignmentAlias}.lead_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM crm_delivery_outbox AS unassign_crm
       WHERE unassign_crm.lead_id = ${assignmentAlias}.lead_id
    )
  `;
}

export function leadReturnToPoolBlockedReasonSql(leadAlias = "l", assignmentAlias = "a") {
  return `CASE
    WHEN nullif(trim(coalesce(${leadAlias}.original_email, '')), '') IS NOT NULL
      OR nullif(trim(coalesce(${leadAlias}.work_email, '')), '') IS NOT NULL
      OR nullif(trim(coalesce(${assignmentAlias}.email, '')), '') IS NOT NULL
      OR ${leadAlias}.original_email_collected_at IS NOT NULL
      OR ${leadAlias}.work_email_collected_at IS NOT NULL
      OR ${assignmentAlias}.email_collected_at IS NOT NULL
      OR coalesce(${leadAlias}.original_email_status, 'pending') = 'found'
      OR coalesce(${leadAlias}.work_email_status, 'pending') = 'found'
      THEN 'Email or contact information has been recorded, so this lead must stay assigned.'
    WHEN ${veblenMatchExistsSql(leadAlias, assignmentAlias)}
      THEN 'This protected Veblen member cannot be returned to the assignment pool.'
    WHEN ${assignmentAlias}.status <> 'assigned'
      OR ${assignmentAlias}.viewed_at IS NOT NULL
      OR ${assignmentAlias}.engaged_at IS NOT NULL
      OR ${assignmentAlias}.connection_requested_at IS NOT NULL
      OR ${assignmentAlias}.accepted_at IS NOT NULL
      OR ${assignmentAlias}.withdrawn_at IS NOT NULL
      OR ${assignmentAlias}.replied_at IS NOT NULL
      OR ${assignmentAlias}.resolved_linkedin_url IS NOT NULL
      OR ${assignmentAlias}.connection_request_reserved_on IS NOT NULL
      OR nullif(trim(coalesce(${assignmentAlias}.last_error, '')), '') IS NOT NULL
      OR ${assignmentAlias}.last_error_at IS NOT NULL
      OR coalesce(${assignmentAlias}.qualification_status, 'pending') <> 'pending'
      OR nullif(trim(coalesce(${assignmentAlias}.qualification_note, '')), '') IS NOT NULL
      OR ${assignmentAlias}.recent_post_checked_at IS NOT NULL
      OR ${assignmentAlias}.has_recent_post IS NOT NULL
      OR ${assignmentAlias}.icp_score IS NOT NULL
      OR coalesce(${leadAlias}.original_email_status, 'pending') <> 'pending'
      OR ${leadAlias}.original_email_checked_at IS NOT NULL
      OR coalesce(${leadAlias}.work_email_status, 'pending') <> 'pending'
      OR ${leadAlias}.work_email_validation IS NOT NULL
      OR ${leadAlias}.work_email_source IS NOT NULL
      OR ${leadAlias}.work_email_checked_at IS NOT NULL
      OR ${leadAlias}.work_email_resolved_linkedin_url IS NOT NULL
      OR nullif(trim(coalesce(${leadAlias}.work_email_last_error, '')), '') IS NOT NULL
      OR ${leadAlias}.work_email_http_status IS NOT NULL
      OR nullif(trim(coalesce(${leadAlias}.lead_note, '')), '') IS NOT NULL
      OR ${leadAlias}.lead_note_updated_at IS NOT NULL
      OR EXISTS (
        SELECT 1 FROM lead_assignment_events AS blocked_events
         WHERE blocked_events.lead_id = ${assignmentAlias}.lead_id
           AND blocked_events.event_type <> 'admin_unassigned'
      )
      OR EXISTS (
        SELECT 1 FROM lead_post_activities AS blocked_posts
         WHERE blocked_posts.lead_id = ${assignmentAlias}.lead_id
      )
      OR EXISTS (
        SELECT 1 FROM lead_followup_tasks AS blocked_followups
         WHERE blocked_followups.lead_id = ${assignmentAlias}.lead_id
      )
      OR EXISTS (
        SELECT 1 FROM scout_escalations AS blocked_escalations
         WHERE blocked_escalations.lead_id = ${assignmentAlias}.lead_id
      )
      OR EXISTS (
        SELECT 1 FROM crm_delivery_outbox AS blocked_crm
         WHERE blocked_crm.lead_id = ${assignmentAlias}.lead_id
      )
      THEN 'Work has already been recorded for this lead, so it must stay with the scout.'
    ELSE 'This lead is no longer eligible to return to the pool.'
  END`;
}
