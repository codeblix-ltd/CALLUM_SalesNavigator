import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const extensionRoot = path.join(projectRoot, "chrome-extension");
const readExtensionFile = (name) =>
  readFile(path.join(extensionRoot, name), "utf8");

const [
  manifestSource,
  popupSource,
  popupScript,
  dashboardSource,
  dashboardScript,
  automationSource,
  automationScript,
  automationStyles,
  backgroundSource,
  contentSource,
  contentStyles,
  clientSource,
  scoutSource,
  adminSource,
  leadDirectorySource,
  adminAppSource,
  schemaSource,
] =
  await Promise.all([
    readExtensionFile("manifest.json"),
    readExtensionFile("popup.html"),
    readExtensionFile("popup.js"),
    readExtensionFile("dashboard.html"),
    readExtensionFile("dashboard.js"),
    readExtensionFile("automation.html"),
    readExtensionFile("automation.js"),
    readExtensionFile("automation.css"),
    readExtensionFile("background.js"),
    readExtensionFile("content.js"),
    readExtensionFile("content.css"),
    readExtensionFile("convex-client.js"),
    readFile(path.join(projectRoot, "convex", "scouts.ts"), "utf8"),
    readFile(path.join(projectRoot, "convex", "adminAnalytics.ts"), "utf8"),
    readFile(path.join(projectRoot, "convex", "leads.ts"), "utf8"),
    readFile(path.join(projectRoot, "src", "App.tsx"), "utf8"),
    readFile(path.join(projectRoot, "database", "schema.sql"), "utf8"),
  ]);
const manifest = JSON.parse(manifestSource);
const helpSource = await readExtensionFile("help.html");
const helpStyles = await readExtensionFile("help.css");

assert.equal(manifest.version, "0.10.16");
assert.deepEqual(manifest.content_scripts[0].matches, [
  "https://*.linkedin.com/*",
]);
assert.deepEqual(manifest.permissions, ["alarms", "storage", "tabGroups", "tabs"]);
for (const source of [manifestSource, popupSource, popupScript, contentSource]) {
  assert.doesNotMatch(
    source,
    /GPT-5\.6|Real Mode|Real Auto-Lead|Automatic simulation|Run simulation/i,
  );
}
assert.doesNotMatch(popupSource, /Automate Active LinkedIn Tab/i);
assert.doesNotMatch(
  popupSource,
  /Open next fresh lead|Current lead|Open profile|Generate draft|Mark engaged|Connection sent|Skip lead/i,
);
assert.doesNotMatch(
  popupScript,
  /claimNextLead|updateLeadStatus|generateDraft|copyDraft|contactInfoUrl/,
);
assert.match(popupSource, /id="start-auto-lead"/);
assert.match(popupSource, /id="automation-run-status"/);
assert.match(popupSource, /id="pause-auto-lead"/);
assert.match(popupSource, /id="resume-auto-lead"/);
assert.match(popupSource, /id="stop-auto-lead"/);
assert.match(popupSource, /id="manual-lead"/);
assert.match(popupSource, /id="manual-lead-panel"/);
assert.match(popupSource, /id="manual-lead-search"/);
assert.match(popupSource, /id="manual-lead-list"/);
assert.match(popupScript, /In progress/);
assert.match(popupScript, /PAUSE_AUTO_LEAD/);
assert.match(popupScript, /RESUME_AUTO_LEAD/);
assert.match(popupScript, /startAutoLead\(\)\)/);
assert.match(popupScript, /STOP_AUTO_LEAD/);
assert.match(popupScript, /saved resume point was cleared/i);
assert.match(popupSource, /id="open-dashboard"/);
assert.match(popupScript, /dashboard\.html/);
assert.match(popupSource, /id="open-help"/);
assert.match(popupScript, /help\.html/);
assert.match(helpSource, /How Callum Scout works/);
assert.match(helpSource, /What happens after you click Start today’s work/);
assert.match(helpStyles, /\.help-steps/);
assert.match(automationSource, /Dedicated automation window/);
assert.match(automationSource, /purple group/);
assert.match(automationSource, /id="pause-run"/);
assert.match(automationSource, /id="resume-run"/);
assert.match(automationSource, /id="stop-run"/);
assert.match(automationScript, /autoLeadRunState/);
assert.match(automationScript, /PAUSE_AUTO_LEAD/);
assert.match(automationScript, /RESUME_AUTO_LEAD/);
assert.match(automationScript, /status === "paused" \|\| status === "failed"/);
assert.match(automationScript, /STOP_AUTO_LEAD/);
assert.match(automationStyles, /#100b27/);
assert.match(dashboardSource, /All leads and steps/);
assert.match(dashboardSource, /id="lead-drawer"/);
assert.match(dashboardScript, /scouts:getLeadProgress/);
assert.match(dashboardScript, /scouts:setLeadNote/);
assert.match(dashboardScript, /data-lead-note-form/);
assert.match(dashboardScript, /maxlength="10000"/);
assert.match(dashboardScript, /No email available/);
assert.match(dashboardScript, /originalEmailStatus/);
assert.match(popupSource, /id="reset-onboarding"/);
assert.match(popupSource, /id="onboarding-form"/);
assert.match(popupSource, /Do you have LinkedIn Premium\?/);
assert.match(popupSource, /Check your Premium plan/i);
assert.match(popupSource, /id="onboarding-next"[\s\S]*disabled/);
assert.match(popupSource, /id="connection-daily-limit"/);
assert.doesNotMatch(popupSource, /id="engagement-daily-limit"/);
assert.match(popupSource, /Likes each day/);
assert.match(popupSource, /id="onboarding-validate-comment"/);
assert.doesNotMatch(
  popupSource,
  /id="onboarding-validate-comment"[^>]*disabled/,
);
assert.doesNotMatch(popupSource, /id="validate-comment"[^>]*disabled/);
assert.doesNotMatch(popupSource, /id="validate-comment"[^>]*checked/);
assert.match(popupScript, /Math\.floor\(limits\.likes \/ requests\)/);
assert.doesNotMatch(
  popupSource,
  /Review interval|Wait before connecting/i,
);
assert.match(popupSource, /id="invitation-note"[\s\S]*maxlength="300"/);
assert.doesNotMatch(popupSource, /id="include-note"|Include a note when you send a request/);
assert.match(popupSource, /id="verify-premium"/);
assert.match(popupSource, /Premium only/);
assert.match(popupScript, /CHECK_LINKEDIN_PREMIUM/);
assert.match(popupScript, /verifyPremiumAndUnlockNote/);
assert.match(popupScript, /invitationNote/);
assert.match(popupScript, /onboardingCompleted: true/);
assert.match(popupScript, /connectionDailyLimit/);
assert.doesNotMatch(popupScript, /values\.engagementDailyLimit/);
assert.match(popupScript, /premiumVerified/);
assert.match(popupScript, /onboardingValidateComment\.checked/);
const saveOnboardingSource = popupScript.slice(
  popupScript.indexOf("async function saveOnboarding"),
  popupScript.indexOf("async function startAutoLead"),
);
assert.match(saveOnboardingSource, /const includeNote = premium && premiumVerified/);
assert.match(saveOnboardingSource, /includeNote,/);
assert.doesNotMatch(saveOnboardingSource, /includeNote:\s*false/);
assert.match(popupScript, /stored\.validateBeforeCommenting \?\? false/);
assert.match(popupScript, /scouts:resetOnboarding/);
assert.match(popupSource, /id="daily-checklist"/);
assert.match(popupSource, /id="first-dm-list"/);
assert.match(popupSource, /Accepted leads ready for a personal first message/);
assert.match(popupScript, /DRAFT_FIRST_DM/);
assert.match(popupScript, /Personalize with AI/);
assert.match(popupSource, /id="followup-list"/);
assert.match(popupSource, /id="lead-check-list"/);
assert.match(popupSource, /id="old-request-list"/);
assert.match(popupSource, /id="question-form"/);
assert.match(popupSource, /id="toggle-advanced"/);
assert.match(popupSource, /id="advanced-panel"/);
assert.match(popupSource, /<details id="work-tools" class="card work-tools">/);
assert.doesNotMatch(popupSource, /<details id="work-tools"[^>]*\bopen\b/);
assert.ok(
  popupSource.indexOf('<details id="work-tools"') >
    popupSource.indexOf('</form>', popupSource.indexOf('<form id="settings-form"')),
  "Your work should stay at the end of the popup",
);
assert.match(popupSource, /id="check-accepted-connections"/);
assert.match(popupSource, /<details id="connection-review-tools" class="card connection-review-tools">/);
assert.doesNotMatch(
  popupSource,
  /<details id="connection-review-tools"[^>]*\bopen\b/,
);
assert.match(popupSource, /id="connection-review-status"/);
assert.match(popupSource, /rejects matching sent requests older than 30 days/);
assert.match(popupScript, /CHECK_ACCEPTED_CONNECTIONS/);
assert.match(popupScript, /rejectedCount/);
assert.match(popupScript, /old requests rejected/);
assert.match(popupScript, /lastAcceptedConnectionReview/);
assert.match(popupScript, /renderConnectionReviewStatus/);
assert.match(popupScript, /connectionWindowKeptOpen/);
assert.match(popupScript, /protected LinkedIn window is still open/);
assert.match(popupScript, /email addresses/);
assert.match(popupScript, /scouts:getScoutOperations/);
assert.match(popupScript, /scouts:setDailyTask/);
assert.match(popupScript, /scouts:completeFollowupTask/);
assert.match(popupScript, /scouts:setLeadQualification/);
assert.match(popupScript, /scouts:markOldRequestWithdrawn/);
assert.match(popupScript, /scouts:createEscalation/);
assert.match(backgroundSource, /markOldRequestWithdrawn/);
assert.match(backgroundSource, /invitation-manager\/sent/);
assert.match(backgroundSource, /const rejectedRequests = await autoWithdrawOldRequests\(runContext\)/);
assert.match(backgroundSource, /rejectedCount: Number\(rejectedRequests\.withdrawnCount/);
assert.match(popupScript, /It will not remove your leads or past work/);
assert.doesNotMatch(
  popupSource,
  /Execute daily workflow|Execute workflow|Restart onboarding|Scout queue connected|Secure lead workspace|Calculated daily likes/,
);
assert.doesNotMatch(
  contentSource,
  /Ready for LinkedIn automation|Automation script attached to page|Awaiting user validation|configured post engagements|invitation modal/,
);

for (const selectorContract of [
  "button[aria-label='Add a note']",
  "textarea#custom-message",
  "textarea[name='message']",
  "button[aria-label='Send invitation']",
  "button[aria-label='Send without a note']",
  "data-testid='interop-shadowdom'",
]) {
  assert.ok(
    contentSource.includes(selectorContract),
    `LinkedIn automation is missing selector contract: ${selectorContract}`,
  );
}
assert.match(contentSource, /fillInvitationNote/);
assert.match(contentSource, /options\.includeNote/);
assert.match(contentSource, /SCAN_RECENT_CONNECTIONS/);
assert.match(contentSource, /invitations: \[\.\.\.invitations\.values\(\)\]/);
assert.match(contentSource, /Syncing sent connection requests/);
assert.match(contentSource, /Connected on\\s\+/);
assert.match(contentSource, /EXTRACT_CONTACT_INFO/);
assert.match(contentSource, /INSPECT_CONNECTION_STATUS/);
assert.match(contentSource, /runConnectionStatusInspection/);
assert.match(contentSource, /findDirectConnectButton/);
assert.match(contentSource, /Connection state could not be confirmed\. Skipping safely/);
assert.match(contentSource, /a\[href\^='mailto:'\]/);
assert.match(contentSource, /ContactInfoDetailSection/);
assert.match(contentSource, /contactDetailsStartedAt/);
assert.match(contentSource, /recordPostActivity/);
assert.match(contentSource, /options\.validateBeforeCommenting/);
assert.match(contentSource, /feed\/update\/urn:li:activity/);
assert.match(contentSource, /function isRepostPost/);
assert.match(contentSource, /\.update-components-header/);
assert.match(contentSource, /\.feed-shared-header/);
assert.match(contentSource, /reposted this/);
assert.match(contentSource, /isPostWithinAgeLimit\(post\)/);
assert.match(contentSource, /MAX_POST_AGE_DAYS = 92/);
assert.match(contentSource, /parseLinkedInRelativeAgeDays/);
assert.match(contentSource, /EXTRACT_FIRST_DM_PROFILE/);
assert.match(contentSource, /runFirstDmProfileExtraction/);
assert.match(contentSource, /a\[href\*='\/messaging\/compose\/'\]/);
assert.match(contentSource, /no like or comment was added/i);
assert.match(contentSource, /INSPECT_PREMIUM_ACCOUNT/);
assert.match(contentSource, /LinkedIn kept the Premium page open/);
assert.match(contentSource, /SET_AUTOMATION_CONTEXT/);
assert.match(contentSource, /markAutomationContext/);
assert.match(contentStyles, /callum-automation-marker/);
assert.match(contentStyles, /data-callum-automation/);
assert.match(backgroundSource, /CHECK_LINKEDIN_PREMIUM/);
assert.match(backgroundSource, /DRAFT_FIRST_DM/);
assert.match(backgroundSource, /scouts:draftFirstDm/);
assert.match(backgroundSource, /PREMIUM_CHECK_TTL_MS/);
assert.match(backgroundSource, /force: true/);
assert.match(backgroundSource, /cached: true/);
assert.match(backgroundSource, /GET_AUTO_LEAD_RUN_STATE/);
assert.match(backgroundSource, /PAUSE_AUTO_LEAD/);
assert.match(backgroundSource, /RESUME_AUTO_LEAD/);
assert.match(backgroundSource, /STOP_AUTO_LEAD/);
assert.match(backgroundSource, /autoLeadRunState/);
assert.match(backgroundSource, /Pausing after the current safe step/);
assert.match(backgroundSource, /lead\.status !== "engaged"/);
assert.match(backgroundSource, /progress: null/);
assert.match(backgroundSource, /chrome\.windows\.create/);
assert.match(backgroundSource, /windowId: runContext\.automationWindowId/);
assert.match(backgroundSource, /chrome\.tabs\.group/);
assert.match(backgroundSource, /CALLUM AUTOMATION/);
assert.match(backgroundSource, /color: "purple"/);
assert.match(backgroundSource, /assertAutomationTab/);
assert.match(backgroundSource, /SET_AUTOMATION_CONTEXT/);
assert.match(backgroundSource, /outside the protected window/);
assert.match(backgroundSource, /premium\/my-premium/);
assert.match(backgroundSource, /isLinkedInPremiumUrl\(finalUrl\)/);
assert.match(backgroundSource, /premium: true/);
assert.match(backgroundSource, /LINKEDIN_TAB_LOAD_TIMEOUT_MS = 90_000/);
assert.match(backgroundSource, /type: "GET_PAGE_INFO"/);
assert.match(backgroundSource, /isExpectedLinkedInPage/);
assert.match(backgroundSource, /localSettings\.validateBeforeCommenting \?\? false/);
assert.match(backgroundSource, /settings\.includeNote && settings\.linkedinPremium/);
assert.match(
  adminSource,
  /coalesce\(e\.details->>'comment', e\.details->>'message', e\.details->>'error'\)/,
);
assert.match(backgroundSource, /getConnectionReviewPlan/);
assert.match(backgroundSource, /recordConnectionReview/);
assert.match(backgroundSource, /recordSentInvitationReview/);
assert.match(backgroundSource, /sentInvitationsScanned/);
assert.match(backgroundSource, /phase: "syncing_sent_invitations"/);
assert.match(backgroundSource, /recordKnownConnection/);
assert.match(backgroundSource, /collectKnownConnectionContact/);
assert.match(backgroundSource, /connectionInspection\.result\.connectAvailable/);
assert.match(backgroundSource, /connectionAlreadyPresent: true/);
assert.match(backgroundSource, /accepted_contact_check_failed/);
assert.match(backgroundSource, /isolatedLeadRun/);
assert.match(backgroundSource, /Manual mode: only the selected lead will be processed/);
assert.match(backgroundSource, /leadId: specificLeadId/);
assert.match(backgroundSource, /\["paused", "failed"\]/);
assert.match(backgroundSource, /The previous lead selection was invalid/);
assert.match(backgroundSource, /The previous run failed before completion/);
assert.doesNotMatch(backgroundSource, /TEMPORARY_LEAD_TEST_KEY|temporaryTestOnly|claimTemporaryTestLead/);
assert.match(backgroundSource, /remove\("temporaryLeadTest"\)/);
assert.doesNotMatch(backgroundSource, /if \(!dashboard\.hasSentConnectionRequest\) return empty/);
assert.match(backgroundSource, /CHECK_ACCEPTED_CONNECTIONS/);
assert.match(backgroundSource, /forceReview: true/);
assert.match(backgroundSource, /checkpoint: forceReview/);
assert.match(backgroundSource, /cutoffDate: forceReview \? null/);
assert.match(backgroundSource, /keepConnectionTab: true/);
assert.match(backgroundSource, /collectContacts: true/);
assert.match(backgroundSource, /canCloseReviewWindow/);
assert.match(backgroundSource, /closeManagedAutomationWindow/);
assert.match(backgroundSource, /connectionWindowKeptOpen: !reviewWindowClosed/);
assert.match(backgroundSource, /Wait for the accepted connection check to finish/);
assert.match(backgroundSource, /source: "daily"/);
assert.match(backgroundSource, /lastAcceptedConnectionReview/);
assert.match(
  scoutSource,
  /status IN \('engaged', 'connected', 'connection_requested', 'failed'\)/,
);
assert.match(scoutSource, /a\.status <> 'failed'/);
assert.match(scoutSource, /requiresFullScan/);
assert.match(
  scoutSource,
  /SET status = 'accepted',[\s\S]*connection_request_reserved_on = NULL,[\s\S]*last_error = NULL/,
);
assert.match(
  schemaSource,
  /ALTER TABLE lead_assignments\s+DROP CONSTRAINT IF EXISTS check_status/,
);
assert.match(backgroundSource, /recordContactInfo/);
assert.match(scoutSource, /export const recordKnownConnection/);
assert.match(scoutSource, /export const recordSentInvitationReview/);
assert.match(scoutSource, /export const recordPendingConnectionRequest/);
assert.match(scoutSource, /source: "linkedin_profile_pending"/);
assert.match(scoutSource, /export const getLeadAutomationCheckpoint/);
assert.match(scoutSource, /\["assigned", "viewed", "engaged", "failed"\]/);
assert.match(scoutSource, /Sent Invitations is the source of truth/);
assert.match(scoutSource, /connection_requested_at >= current_date/);
assert.match(scoutSource, /requests_sent = greatest/);
assert.match(scoutSource, /linkedin_sent_invitations_sync/);
assert.match(scoutSource, /connection_detected/);
assert.match(contentSource, /if \(engagedCount < 1\)/);
assert.doesNotMatch(contentSource, /engagedCount !== countToEngage/);
assert.match(contentSource, /Finished \$\{engagedCount\} of \$\{countToEngage\} posts\. Continuing safely/);
assert.match(contentSource, /connectionState === "pending"/);
assert.match(contentSource, /No duplicate will be sent/);
assert.match(contentSource, /openConnectionInvitation/);
assert.match(contentSource, /the direct Connect button/);
assert.match(contentSource, /Connect in the More menu/);
assert.match(contentSource, /scroll: method !== "Connect in the More menu"/);
assert.match(contentSource, /stateBeforeClick = findVisibleConnectionState/);
assert.match(contentSource, /requestAlreadyPending: true/);
assert.match(
  contentSource,
  /\[data-test-modal-id='send-invite-modal'\], \[role='dialog'\], dialog/,
);
assert.match(contentSource, /Details: \$\{skippedReasons\.join\("; "\)\}/);
assert.match(backgroundSource, /runPostEngagementWithRecovery/);
assert.match(backgroundSource, /executeConnectionRequestWithRecovery/);
assert.match(backgroundSource, /isClosedMessageChannelError/);
assert.match(backgroundSource, /retryOnClosedChannel: true/);
assert.match(backgroundSource, /chrome\.tabs\.reload\(tabId\)/);
assert.match(backgroundSource, /profile actions did not finish loading/);
assert.match(backgroundSource, /recordPendingConnectionRequest/);
assert.match(backgroundSource, /progress\.requestsSent \+ dashboard\.usage\.requestRemaining/);
assert.match(backgroundSource, /return \{ status: state\.status, state \};/);
assert.doesNotMatch(backgroundSource, /return workflowPromise;/);
assert.match(popupScript, /Automation started\. Follow progress in the protected purple window/);
assert.match(backgroundSource, /reserveConnectionRequest/);
assert.match(backgroundSource, /completeConnectionRequest/);
assert.match(backgroundSource, /completeConnectionRequestWithRetry/);
assert.match(backgroundSource, /CONNECTION_COMPLETION_RETRY_DELAYS_MS/);
assert.match(backgroundSource, /reconcileLocallyConfirmedConnectionRequests/);
assert.match(backgroundSource, /pendingConnectionRequests/);
assert.match(backgroundSource, /excludeLeadIds: \[\.\.\.pendingConnectionLeadIds\]/);
assert.match(backgroundSource, /pendingConnectionLeadIds\.add\(lead\.id\)/);
assert.match(backgroundSource, /Resume will continue with the next lead while it syncs/);
assert.match(backgroundSource, /chrome\.tabs\.onRemoved/);
assert.match(backgroundSource, /The automation tab was closed/);
assert.match(backgroundSource, /dashboard\.usage\.requestRemaining/);
assert.match(backgroundSource, /no recent posts\|no supported post permalink/);
assert.match(backgroundSource, /failedLeads\.push/);
assert.match(backgroundSource, /error\?\.requestSubmitted === true/);
assert.match(backgroundSource, /workflowError\.requestSubmitted = requestSubmitted/);
assert.match(backgroundSource, /workflowError\.persistencePending/);
assert.match(backgroundSource, /if \(specificLeadId\) break/);
assert.doesNotMatch(backgroundSource, /if \(specificLeadId \|\| connectionSyncPending\) break/);
assert.match(
  backgroundSource,
  /if \(workflowTabId\) \{[\s\S]*?clearActiveWorkflowTab\(workflowTabId\);[\s\S]*?chrome\.tabs\.remove\(workflowTabId\)/,
);
assert.doesNotMatch(
  backgroundSource,
  /if \(requestSent\) progress\.requestsSent \+= 1;[\s\S]{0,300}scouts:updateLeadStatus/,
);
assert.match(popupScript, /the run continued automatically/);
assert.match(clientSource, /error\?\.status === 401/);
assert.match(clientSource, /refreshOnce/);
assert.match(clientSource, /clearAuthIfUnchanged/);
assert.match(scoutSource, /export const getScoutOperations/);
assert.match(scoutSource, /export const draftFirstDm/);
assert.match(scoutSource, /firstDms/);
assert.match(scoutSource, /first_dm_drafted/);
assert.match(scoutSource, /a\.accepted_at >= now\(\) - INTERVAL '30 days'/);
assert.match(schemaSource, /personalized_at TIMESTAMPTZ NULL/);
assert.match(scoutSource, /export const getLeadProgress/);
assert.match(scoutSource, /automation_ready/);
assert.match(scoutSource, /leadId: v\.optional\(v\.string\(\)\)/);
assert.match(scoutSource, /source: "manual_picker"/);
assert.match(scoutSource, /export const setLeadNote/);
assert.match(scoutSource, /UPDATE leads AS l/);
assert.match(scoutSource, /lead_note_updated_at/);
assert.match(scoutSource, /original_email_status = CASE/);
assert.match(scoutSource, /coalesce\(l\.original_email_status, 'pending'\) = 'pending'/);
assert.match(leadDirectorySource, /l\.lead_note/);
assert.match(leadDirectorySource, /originalEmailStatus/);
assert.match(adminAppSource, /Lead note/);
assert.match(adminAppSource, /lead\.leadNote/);
assert.match(adminAppSource, /No email available/);
assert.match(schemaSource, /ADD COLUMN IF NOT EXISTS lead_note STRING NULL/);
assert.match(schemaSource, /original_email_status IN \('pending', 'found', 'not_found'\)/);
assert.match(schemaSource, /event_type = 'contact_info_checked'/);
assert.match(scoutSource, /export const markOldRequestWithdrawn/);
assert.match(scoutSource, /export const completeFollowupTask/);
assert.match(scoutSource, /createFollowupTasks/);
assert.match(
  scoutSource,
  /profileUrl: v\.optional\(v\.string\(\)\)/,
);
assert.match(scoutSource, /recoveredFromFailed/);
assert.match(scoutSource, /status IN \('engaged', 'failed'\)/);
assert.match(scoutSource, /excludeLeadIds: v\.optional\(v\.array\(v\.string\(\)\)\)/);
assert.match(scoutSource, /resumeExisting: v\.optional\(v\.boolean\(\)\)/);
assert.match(scoutSource, /existingExclusionSql/);
assert.match(scoutSource, /selectedExclusionSql/);
assert.match(
  scoutSource,
  /status IN \('viewed', 'engaged'\)[\s\S]*?status = 'assigned'[\s\S]*?ORDER BY\s+assigned_at DESC,\s+CASE WHEN qualification_status = 'qualified' THEN 0 ELSE 1 END,\s+lead_id/,
);
assert.match(backgroundSource, /resumeExisting: resumeExistingLead/);
assert.match(backgroundSource, /resumeExistingLead = false/);
assert.match(adminSource, /export const exportCleanCsv/);
assert.match(adminSource, /export const retryCrmDelivery/);
assert.match(schemaSource, /CREATE TABLE IF NOT EXISTS lead_followup_tasks/);
assert.match(schemaSource, /CREATE TABLE IF NOT EXISTS operator_daily_tasks/);
assert.match(schemaSource, /CREATE TABLE IF NOT EXISTS scout_escalations/);
assert.match(schemaSource, /CREATE TABLE IF NOT EXISTS crm_delivery_outbox/);

const storedAuth = {
  callumScoutAuth: {
    token: "expired-access-token",
    refreshToken: "valid-refresh-token",
    username: "scout",
  },
};
let refreshCalls = 0;
const clientContext = {
  console,
  LEADS_EXTENSION_CONFIG: {
    CONVEX_URL: "https://example.convex.cloud",
  },
  chrome: {
    storage: {
      local: {
        async get(key) {
          return { [key]: storedAuth[key] };
        },
        async set(values) {
          Object.assign(storedAuth, values);
        },
        async remove(key) {
          delete storedAuth[key];
        },
      },
    },
  },
  async fetch(_url, request) {
    const body = JSON.parse(request.body);
    if (body.path === "auth:signIn") {
      refreshCalls += 1;
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            status: "success",
            value: {
              tokens: {
                token: "fresh-access-token",
                refreshToken: "fresh-refresh-token",
              },
            },
          };
        },
      };
    }
    if (request.headers.Authorization === "Bearer expired-access-token") {
      return {
        ok: false,
        status: 401,
        async json() {
          return { status: "error", errorMessage: "Unauthorized" };
        },
      };
    }
    return {
      ok: true,
      status: 200,
      async json() {
        return { status: "success", value: { path: body.path } };
      },
    };
  },
};
vm.runInNewContext(clientSource, clientContext);
const refreshedResults = await Promise.all([
  clientContext.ScoutApi.authenticatedAction("scouts:getDashboard"),
  clientContext.ScoutApi.authenticatedAction("scouts:claimNextLead"),
]);
assert.equal(refreshCalls, 1, "Concurrent 401s must share one token refresh.");
assert.equal(storedAuth.callumScoutAuth.token, "fresh-access-token");
assert.deepEqual(
  refreshedResults.map((result) => result.path),
  ["scouts:getDashboard", "scouts:claimNextLead"],
);

const listenerStub = () => ({ addListener() {}, removeListener() {} });
const backgroundStorage = {};
const backgroundActions = [];
const backgroundContext = {
  URL,
  clearTimeout,
  console,
  importScripts() {},
  setTimeout,
  ScoutApi: {
    async authenticatedAction(pathname, args) {
      backgroundActions.push({ pathname, args });
      return null;
    },
  },
  chrome: {
    action: {},
    alarms: { create() {}, onAlarm: listenerStub() },
    runtime: {
      getURL(pathname) {
        return `chrome-extension://test/${pathname}`;
      },
      onInstalled: listenerStub(),
      onMessage: listenerStub(),
      onStartup: listenerStub(),
    },
    storage: {
      local: {
        async get(key) {
          return { [key]: backgroundStorage[key] };
        },
        async set(values) {
          Object.assign(backgroundStorage, values);
        },
      },
    },
    tabs: { onUpdated: listenerStub(), onRemoved: listenerStub() },
    windows: { onRemoved: listenerStub() },
  },
};
vm.runInNewContext(backgroundSource, backgroundContext);
assert.equal(
  backgroundContext.isLinkedInPremiumUrl(
    "https://www.linkedin.com/premium/my-premium/?from=extension",
  ),
  true,
);
assert.equal(
  backgroundContext.isLinkedInPremiumUrl(
    "https://www.linkedin.com/premium/survey/?referenceId=test",
  ),
  false,
);
assert.equal(
  backgroundContext.normalizeLinkedInProfileUrl(
    "https://linkedin.com/in/taylor-example/recent-activity/all/?x=1",
  ),
  "https://www.linkedin.com/in/taylor-example",
);
assert.equal(
  backgroundContext.isExpectedLinkedInPage(
    "https://www.linkedin.com/in/resolved-profile/",
    "https://www.linkedin.com/in/requested-profile",
  ),
  true,
);
assert.equal(
  backgroundContext.isExpectedLinkedInPage(
    "https://www.linkedin.com/in/resolved-profile/recent-activity/all/",
    "https://www.linkedin.com/in/requested-profile/recent-activity/all/",
  ),
  true,
);
assert.equal(
  backgroundContext.isExpectedLinkedInPage(
    "https://www.linkedin.com/feed/",
    "https://www.linkedin.com/in/requested-profile",
  ),
  false,
);
assert.equal(backgroundContext.defaultAutoLeadRunState().status, "idle");
assert.equal(
  backgroundContext.isClosedMessageChannelError(
    "A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received",
  ),
  true,
);
assert.equal(
  backgroundContext.isClosedMessageChannelError("LinkedIn did not open the profile."),
  false,
);
assert.equal(
  backgroundContext.isProtectedAutomationTab(
    { windowId: 42, groupId: 7 },
    { automationWindowId: 42, automationTabGroupId: 7 },
  ),
  true,
);
assert.equal(
  backgroundContext.isProtectedAutomationTab(
    { windowId: 99, groupId: 7 },
    { automationWindowId: 42, automationTabGroupId: 7 },
  ),
  false,
  "A LinkedIn tab in another Chrome window must never be treated as protected.",
);
assert.equal(
  backgroundContext.isProtectedAutomationTab(
    { windowId: 42, groupId: 8 },
    { automationWindowId: 42, automationTabGroupId: 7 },
  ),
  false,
  "An ungrouped or differently grouped tab must never receive automation.",
);
assert.equal(
  backgroundContext.isManagedAutomationHomeTab(
    { windowId: 42, url: "chrome-extension://test/automation.html" },
    42,
  ),
  true,
);
assert.equal(
  backgroundContext.isManagedAutomationHomeTab(
    { windowId: 99, url: "chrome-extension://test/automation.html" },
    42,
  ),
  false,
  "Stop must not close a window unless the extension home tab proves ownership.",
);
assert.deepEqual(
  JSON.parse(JSON.stringify(backgroundContext.normalizeRunProgress({
    processedLeads: 3,
    requestsSent: 2,
    targetRequests: 10,
  }))),
  {
    reviewComplete: false,
    review: {
      reviewed: false,
      acceptedMatched: 0,
      contactsChecked: 0,
      emailsCollected: 0,
      connectionsScanned: 0,
    },
    autoWithdrawComplete: false,
    autoWithdraw: { withdrawnCount: 0 },
    targetRequests: 10,
    processedLeads: 3,
    requestsSent: 2,
    results: [],
    failedLeads: [],
    pendingConnectionRequests: [],
  },
);
const stateWithConfirmedRequest = await backgroundContext.writeAutoLeadRunState({
  ...backgroundContext.defaultAutoLeadRunState(),
  status: "completed",
  runId: "run-with-confirmed-request",
  progress: backgroundContext.normalizeRunProgress({
    failedLeads: [
      { leadId: "sent-lead", requestSent: true },
      { leadId: "real-problem", requestSent: false },
    ],
  }),
  result: {
    failedLeads: [
      { leadId: "sent-lead", requestSent: true },
      { leadId: "real-problem", requestSent: false },
    ],
  },
});
const reconciledState =
  await backgroundContext.reconcileLocallyConfirmedConnectionRequests(
    stateWithConfirmedRequest,
  );
assert.deepEqual(
  JSON.parse(JSON.stringify(backgroundActions)),
  [
    {
      pathname: "scouts:completeConnectionRequest",
      args: { leadId: "sent-lead" },
    },
  ],
);
assert.deepEqual(
  JSON.parse(JSON.stringify(reconciledState.progress.failedLeads)),
  [{ leadId: "real-problem", requestSent: false }],
);
assert.deepEqual(
  JSON.parse(JSON.stringify(reconciledState.result.failedLeads)),
  [{ leadId: "real-problem", requestSent: false }],
);
await backgroundContext.writeAutoLeadRunState({
  ...backgroundContext.defaultAutoLeadRunState(),
  status: "running",
  runId: "run-1",
  progress: backgroundContext.normalizeRunProgress({
    processedLeads: 3,
    requestsSent: 2,
    targetRequests: 10,
  }),
});
const recoveredRun = await backgroundContext.getAutoLeadRunState();
assert.equal(recoveredRun.status, "paused");
assert.equal(recoveredRun.progress.processedLeads, 3);
const stoppedRun = await backgroundContext.requestWorkflowControl("stop");
assert.equal(stoppedRun.status, "stopped");
assert.equal(stoppedRun.progress, null);
assert.equal(stoppedRun.specificLeadId, null);

console.log(
  "Extension checks passed: repost skipping, successful-request reconciliation, isolated automation, resumable controls, Premium detection, and auth recovery are wired correctly.",
);
