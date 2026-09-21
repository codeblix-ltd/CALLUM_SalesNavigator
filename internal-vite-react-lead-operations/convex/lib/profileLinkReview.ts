// Older Store clients report this specific pre-engagement failure as text.
// Do not broaden this to network, sign-in, checkpoint or writing-service errors.
export const UNVERIFIED_PROFILE_LINK_ERROR =
  "LinkedIn did not provide a verified profile link. Scout paused without skipping this lead. Please use Report Bug so support can check the link.";

export const PROFILE_LINK_REVIEW_MESSAGE =
  "This lead needs a profile-link review and is still saved. Please start a normal run to work on other leads. Support must check this link before it is retried.";

export const ONLY_PROFILE_LINK_REVIEWS_MESSAGE =
  "The remaining leads need profile-link review and are still saved. Support must check their links before this run can continue.";

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
