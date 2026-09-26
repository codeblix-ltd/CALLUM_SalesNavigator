// Older Store clients report this specific pre-engagement failure as text.
// Do not broaden this to network, sign-in, checkpoint or writing-service errors.
export const UNVERIFIED_PROFILE_LINK_ERROR =
  "LinkedIn did not provide a verified profile link. Scout paused without skipping this lead. Please use Report Bug so support can check the link.";

export const UNREADABLE_LINKEDIN_PAGE_ERROR =
  "The LinkedIn page could not be read. Scout paused without skipping this lead. Check that LinkedIn opens in a normal tab, then press Resume. If it still fails, use Report Bug.";

export const UNCERTAIN_INVITATION_ERROR =
  "The connection request could not be confirmed. Check LinkedIn Pending before this lead is retried; ask your manager to review it.";

export const LINKEDIN_EMAIL_REQUIRED_ERROR =
  "LinkedIn requires the person's email address to connect. No request was sent. This lead needs manual review.";

// Older extension versions report an anonymous invite dialog as a recipient
// verification failure. A run with several of these mixed with unreadable
// connection actions cannot safely keep consuming leads.
export function isUncompletedConnectionAction(eventType: string, error: string | null) {
  return eventType === "failed" && (
    error === "The connection state could not be confirmed. Nothing was sent for this lead." ||
    error === LINKEDIN_EMAIL_REQUIRED_ERROR ||
    /^We couldn.t check that the request is for .+\. Nothing was sent\.$/.test(error ?? "")
  );
}

export const PROFILE_LINK_REVIEW_MESSAGE =
  "This lead needs attention and is still saved. Please start a normal run to work on other leads. Support will check this lead before it is retried.";

export const ONLY_PROFILE_LINK_REVIEWS_MESSAGE =
  "The remaining leads need attention and are still saved. Support must check them before this run can continue.";

// Keep the assignment, status, activity receipts and counters intact. A verified
// readable replacement (or support clearing the diagnosed error) releases it.
// This prevents Resume/Start/Retry failed from repeatedly claiming the same
// known unresolved link, without treating every opaque import as a bad lead.
export function profileLinkNeedsReviewSql(leadAlias = "l", assignmentAlias = "a") {
  const error = UNVERIFIED_PROFILE_LINK_ERROR.replace(/'/g, "''");
  return `(coalesce(${assignmentAlias}.last_error, '') = '${error}'
    AND coalesce(${assignmentAlias}.resolved_linkedin_url, ${leadAlias}.linkedin_url, '')
      ~ '/in/AC[ow][A-Za-z0-9_-]{15,}/?([?#].*)?$')`;
}

// A single unreadable page can be transient. After two identical pauses on the
// same lead within 24 hours, keep that lead for support but let a normal run
// select another one. The hold persists until its diagnosed error is cleared.
export function repeatedUnreadablePageNeedsReviewSql(assignmentAlias = "a") {
  const error = UNREADABLE_LINKEDIN_PAGE_ERROR.replace(/'/g, "''");
  return `(coalesce(${assignmentAlias}.last_error, '') = '${error}'
    AND ${assignmentAlias}.last_error_at IS NOT NULL
    AND (SELECT count(*)
           FROM lead_assignment_events AS unreadable_events
          WHERE unreadable_events.lead_id = ${assignmentAlias}.lead_id
            AND unreadable_events.operator_id = ${assignmentAlias}.operator_id
            AND unreadable_events.event_type = 'error'
            AND unreadable_events.details->>'message' = '${error}'
            AND unreadable_events.created_at >= ${assignmentAlias}.last_error_at - INTERVAL '24 hours'
            AND unreadable_events.created_at <= ${assignmentAlias}.last_error_at + INTERVAL '1 minute') >= 2)`;
}

// If the page disappeared during an invitation attempt, LinkedIn may have
// accepted the request even though the extension never received confirmation.
// Keep this lead out of both normal and failed-only automatic queues until a
// human checks Pending and clears the diagnosed error.
export function uncertainInvitationNeedsReviewSql(assignmentAlias = "a") {
  const error = UNCERTAIN_INVITATION_ERROR.replace(/'/g, "''");
  return `coalesce(${assignmentAlias}.last_error, '') = '${error}'`;
}

// This is a real LinkedIn gate, not a transient selector failure. Reopening
// the same lead cannot bypass the email requirement; leave it for manual review.
export function emailRequiredNeedsReviewSql(assignmentAlias = "a") {
  const error = LINKEDIN_EMAIL_REQUIRED_ERROR.replace(/'/g, "''");
  return `coalesce(${assignmentAlias}.last_error, '') = '${error}'`;
}

export function leadNeedsReviewSql(leadAlias = "l", assignmentAlias = "a") {
  return `(${profileLinkNeedsReviewSql(leadAlias, assignmentAlias)}
    OR ${repeatedUnreadablePageNeedsReviewSql(assignmentAlias)}
    OR ${uncertainInvitationNeedsReviewSql(assignmentAlias)}
    OR ${emailRequiredNeedsReviewSql(assignmentAlias)})`;
}
