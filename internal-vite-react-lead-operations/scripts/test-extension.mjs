import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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
const gatewayClientPath = path.join(
  projectRoot,
  "gateway",
  "app-server-client.mjs",
);
const gatewayClientSource = await readFile(gatewayClientPath, "utf8");
const { CodexAppServer, classifyLanguageLocally } = await import(
  pathToFileURL(gatewayClientPath).href
);

assert.equal(manifest.version, "0.10.27");
assert.deepEqual(manifest.content_scripts[0].matches, [
  "https://*.linkedin.com/*",
]);
assert.deepEqual(manifest.permissions, ["alarms", "power", "storage", "tabGroups", "tabs"]);
assert.deepEqual(manifest.web_accessible_resources[0].matches, [
  "https://*.linkedin.com/*",
]);
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
assert.match(popupSource, /id="retry-failed-leads"/);
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
assert.match(popupScript, /RETRY_FAILED_LEADS/);
assert.match(popupScript, /saved resume point was cleared/i);
assert.match(popupSource, /id="open-dashboard"/);
assert.match(popupScript, /dashboard\.html/);
assert.match(popupSource, /id="open-help"/);
assert.match(popupScript, /help\.html/);
assert.match(helpSource, /How Callum Scout works/);
assert.match(helpSource, /What happens after you click Start today’s work/);
assert.match(helpSource, /the connection request still continues/);
assert.match(helpSource, /You do not have to redo every failed lead/);
assert.match(helpSource, /prevents screen and computer sleep/);
assert.match(helpSource, /waits for up to 5 minutes/);
assert.match(helpSource, /Last week, Last month, Last 3 months, or Last 6 months/);
assert.match(helpStyles, /\.help-steps/);
assert.match(automationSource, /Dedicated automation window/);
assert.match(automationSource, /purple group/);
assert.match(automationSource, /id="pause-run"/);
assert.match(automationSource, /id="resume-run"/);
assert.match(automationSource, /id="stop-run"/);
assert.match(automationSource, /Want to pause\? Simply close this window/);
assert.match(automationSource, /keeps the screen and computer awake/);
assert.match(automationScript, /autoLeadRunState/);
assert.match(automationScript, /PAUSE_AUTO_LEAD/);
assert.match(automationScript, /RESUME_AUTO_LEAD/);
assert.match(automationScript, /status === "paused" \|\| status === "failed"/);
assert.match(automationScript, /STOP_AUTO_LEAD/);
assert.match(automationSource, /id="run-estimate"/);
assert.match(automationScript, /Estimated finish/);
assert.match(automationScript, /averageLeadDurationMs/);
assert.match(automationStyles, /#100b27/);
assert.match(automationStyles, /\.run-estimate/);
assert.match(dashboardSource, /All leads and steps/);
assert.match(dashboardSource, /id="retry-failed-leads"/);
assert.match(dashboardSource, /id="lead-drawer"/);
assert.match(dashboardScript, /scouts:getLeadProgress/);
assert.match(dashboardScript, /scouts:setLeadNote/);
assert.match(dashboardScript, /scouts:rejectFailedLead/);
assert.match(dashboardScript, /Retry this lead/);
assert.match(dashboardScript, /Mark rejected/);
assert.match(dashboardScript, /data-lead-note-form/);
assert.match(dashboardScript, /maxlength="10000"/);
assert.match(dashboardScript, /No email available/);
assert.match(dashboardScript, /originalEmailStatus/);
assert.match(popupSource, /id="reset-onboarding"/);
assert.match(popupSource, /id="onboarding-form"/);
assert.match(popupSource, /Do you have LinkedIn Premium\?/);
assert.doesNotMatch(popupSource, /Check your Premium plan|Check Premium/i);
assert.match(popupSource, /id="onboarding-next"[\s\S]*disabled/);
assert.match(popupSource, /id="connection-daily-limit"/);
assert.match(popupSource, /id="connection-review-lookback"/);
assert.match(popupScript, /connectionReviewLookbackDays/);
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
assert.doesNotMatch(popupSource, /id="invitation-note"/);
assert.match(popupSource, /id="include-note"/);
assert.match(popupSource, /id="onboarding-include-note"/);
assert.match(popupSource, /reads the lead’s profile and creates a different note/i);
assert.doesNotMatch(popupSource, /id="verify-premium"|Premium only/);
assert.doesNotMatch(popupScript, /CHECK_LINKEDIN_PREMIUM|verifyPremiumForNotes/);
assert.doesNotMatch(popupScript, /DEFAULT_INVITATION_NOTE/);
assert.match(popupScript, /onboardingCompleted: true/);
assert.match(popupScript, /connectionDailyLimit/);
assert.doesNotMatch(popupScript, /values\.engagementDailyLimit/);
assert.doesNotMatch(popupScript, /premiumVerified/);
assert.match(scoutSource, /premiumVerified: v\.optional\(v\.boolean\(\)\)/);
assert.doesNotMatch(scoutSource, /if \([^\n]*premiumVerified/);
assert.match(popupScript, /onboardingValidateComment\.checked/);
const saveOnboardingSource = popupScript.slice(
  popupScript.indexOf("async function saveOnboarding"),
  popupScript.indexOf("async function startAutoLead"),
);
assert.match(saveOnboardingSource, /const includeNote = premium && elements\.onboardingIncludeNote\.checked/);
assert.match(saveOnboardingSource, /includeNote,/);
assert.doesNotMatch(saveOnboardingSource, /includeNote:\s*false/);
assert.match(popupScript, /stored\.validateBeforeCommenting \?\? false/);
assert.match(popupScript, /scouts:resetOnboarding/);
assert.match(popupSource, /id="daily-checklist"/);
assert.doesNotMatch(popupSource, /id="first-dm-list"|Accepted leads ready for a personal first message/);
assert.doesNotMatch(popupScript, /DRAFT_FIRST_DM|Personalize with AI/);
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
assert.match(contentSource, /a\[href\*='\/preload\/custom-invite\/'\]/);
assert.match(contentSource, /isConnectActionLabel\([\s\S]*targetProfileSlug/);
assert.match(contentSource, /Connection state could not be confirmed\. Skipping safely/);
assert.match(contentSource, /Waiting for the profile actions to finish loading/);
assert.match(contentSource, /id="callum-run-summary"/);
assert.match(contentSource, /Estimated finish/);
assert.match(contentSource, /Simply close this purple automation window/);
assert.match(contentSource, /formatAutomationRunEta/);
assert.match(contentSource, /estimatedCompletionAt/);
assert.match(contentStyles, /#callum-scout-overlay\.callum-automation-context[\s\S]*top: 58px/);
assert.match(contentStyles, /\.callum-run-pause-note/);
assert.match(contentStyles, /\.callum-textarea[\s\S]*color: #1e293b !important/);
assert.match(contentStyles, /\.callum-review-timeout-note/);
assert.match(contentSource, /COMMENT_REVIEW_TIMEOUT_MS = 5 \* 60 \* 1_000/);
assert.match(contentSource, /If no choice is made, this post will be skipped/);
assert.match(contentSource, /finishReview\(null\)/);
let reviewTimeoutCallback = null;
let reviewTimeoutDelay = null;
const reviewEvents = [];
const reviewContainer = { style: { display: "none" }, innerHTML: "" };
const reviewEditor = { value: "Visible generated comment" };
const reviewButton = { addEventListener() {} };
const reviewContext = {
  COMMENT_REVIEW_TIMEOUT_MS: 5 * 60 * 1_000,
  addLog(...args) {
    reviewEvents.push(["log", ...args]);
  },
  clearTimeout() {},
  document: {
    getElementById(id) {
      if (id === "callum-validation-container") return reviewContainer;
      if (id === "callum-draft-editor") return reviewEditor;
      if (id === "callum-approve-btn" || id === "callum-skip-btn") {
        return reviewButton;
      }
      return null;
    },
  },
  escapeHtml(value) {
    return String(value);
  },
  setTimeout(callback, delay) {
    reviewTimeoutCallback = callback;
    reviewTimeoutDelay = delay;
    return 1;
  },
  updateStatus(value) {
    reviewEvents.push(["status", value]);
  },
};
const reviewFunctionSource = contentSource.slice(
  contentSource.indexOf("function promptValidationUI"),
  contentSource.indexOf("// --- Utility Functions ---"),
);
vm.runInNewContext(reviewFunctionSource, reviewContext);
const pendingReview = reviewContext.promptValidationUI(
  "Post excerpt",
  "Visible generated comment",
  1,
);
assert.equal(reviewContainer.style.display, "block");
assert.match(reviewContainer.innerHTML, /Visible generated comment/);
assert.equal(reviewTimeoutDelay, 5 * 60 * 1_000);
reviewTimeoutCallback();
assert.equal(await pendingReview, null);
assert.equal(reviewContainer.style.display, "none");
assert.ok(
  reviewEvents.some((event) => /timed out after 5 minutes/.test(event.join(" "))),
);
assert.match(contentSource, /a\[href\^='mailto:'\]/);
assert.match(contentSource, /ContactInfoDetailSection/);
assert.match(contentSource, /contactDetailsStartedAt/);
const connectLabelContext = {};
const personNameHelpers = contentSource.slice(
  contentSource.indexOf("function normalizePersonName"),
  contentSource.indexOf("function getLinkedInModalRoots"),
);
const connectLabelHelpers = contentSource.slice(
  contentSource.indexOf("function connectActionLabelMatches"),
  contentSource.indexOf("function findVisibleConnectionState"),
);
vm.runInNewContext(
  `${personNameHelpers}\n${connectLabelHelpers}`,
  connectLabelContext,
);
assert.equal(
  connectLabelContext.connectActionLabelMatches("+ Connect", "Gerard Seng"),
  true,
);
assert.equal(
  connectLabelContext.connectActionLabelMatches(
    "Connect with Gerard Seng",
    "Gerard Seng",
  ),
  true,
);
assert.equal(
  connectLabelContext.connectActionLabelMatches(
    "Invite Gerard Seng to connect",
    "Gerard Seng",
  ),
  true,
);
assert.equal(
  connectLabelContext.connectActionLabelMatches(
    "Connect with Another Person",
    "Gerard Seng",
  ),
  false,
);
assert.match(
  contentSource,
  /a\[aria-label\*='connect' i\]/,
  "Direct Connect discovery must include LinkedIn's current plain anchor markup.",
);
connectLabelContext.connectOptionMatchesTarget = () => false;
const liveTargetAnchor = {
  textContent: "Connect",
  getAttribute(name) {
    if (name === "aria-label") return "Invite Jordi Pasqualin to connect";
    if (name === "href") {
      return "https://www.linkedin.com/in/jordi-pasqualin-9a314353/";
    }
    return null;
  },
};
const unrelatedRecommendationButton = {
  textContent: "Connect",
  getAttribute(name) {
    return name === "aria-label" ? "Invite Zuzu Vorcaro to connect" : null;
  },
};
assert.equal(
  connectLabelContext.isConnectActionLabel(
    liveTargetAnchor,
    "Jordi Pasqualin",
    "jordi-pasqualin-9a314353",
  ),
  true,
);
assert.equal(
  connectLabelContext.isConnectActionLabel(
    unrelatedRecommendationButton,
    "Jordi Pasqualin",
    "jordi-pasqualin-9a314353",
  ),
  false,
  "A recommendation card for another person must not match the current profile.",
);
let directConnectClicks = 0;
const directConnectRetryContext = {
  addLog() {},
  clickElement() {
    directConnectClicks += 1;
  },
  findActiveInvitationDialog() {
    return null;
  },
  findConnectOption() {
    return null;
  },
  findDirectConnectButton() {
    return { id: "direct-connect" };
  },
  findMoreButton() {
    throw new Error("More should not be used while direct Connect remains visible.");
  },
  findVisibleConnectionState() {
    return "unavailable";
  },
  async sleep() {},
  updateStatus() {},
  async waitForMatch(find) {
    return find();
  },
};
const openConnectionInvitationSource = contentSource.slice(
  contentSource.indexOf("async function openConnectionInvitation"),
  contentSource.indexOf("function isProfileMoreButton"),
);
vm.runInNewContext(openConnectionInvitationSource, directConnectRetryContext);
const directConnectRetry =
  await directConnectRetryContext.openConnectionInvitation({
    targetProfileName: "Jordi Pasqualin",
    targetProfileSlug: "jordi-pasqualin",
  });
assert.equal(
  directConnectClicks,
  2,
  "A visible direct Connect button must receive one safe retry when the first click does not open LinkedIn's dialog.",
);
assert.deepEqual(
  JSON.parse(JSON.stringify(directConnectRetry.attemptedMethods)),
  ["the direct Connect button"],
);
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
assert.match(contentSource, /extractLinkedInActivityAgeDays/);
assert.match(contentSource, /BigInt\(match\[1\]\) >> 22n/);
assert.match(contentSource, /verifiedAgeDays/);
const postAgeContext = {};
const postAgeHelpers = contentSource.slice(
  contentSource.indexOf("function extractPostAgeDays"),
  contentSource.indexOf("function hasPostActions"),
);
vm.runInNewContext(postAgeHelpers, postAgeContext);
assert.equal(postAgeContext.parseLinkedInRelativeAgeDays("5y •"), 1825);
assert.equal(postAgeContext.parseLinkedInRelativeAgeDays("1yr •"), 365);
assert.equal(postAgeContext.parseLinkedInRelativeAgeDays("3mo •"), 91.3125);
assert.equal(postAgeContext.parseLinkedInRelativeAgeDays("2 weeks ago"), 14);
assert.equal(postAgeContext.parseLinkedInRelativeAgeDays("unknown"), null);
const nestedAgePost = {
  getAttribute() {
    return "";
  },
  querySelectorAll(selector) {
    return selector === ".update-components-actor__sub-description"
      ? [{ textContent: "1d •" }, { textContent: "5y •" }]
      : [];
  },
};
assert.equal(postAgeContext.extractPostAgeDays(nestedAgePost), 1825);
const oldActivityId = String(BigInt(Date.now() - 365 * 86_400_000) << 22n);
const oldActivityPost = {
  getAttribute(name) {
    return name === "data-urn" ? `urn:li:activity:${oldActivityId}` : "";
  },
  querySelectorAll() {
    return [];
  },
};
assert.ok(postAgeContext.extractPostAgeDays(oldActivityPost) > 360);
assert.match(contentSource, /EXTRACT_CONNECTION_NOTE_PROFILE/);
assert.match(contentSource, /runConnectionNoteProfileExtraction/);
assert.match(contentSource, /a\[href\*='\/messaging\/compose\/'\]/);
assert.match(contentSource, /contactSections[\s\S]*textContent\?\.length/);
assert.match(contentSource, /topAffiliations/);
assert.match(contentSource, /no like or comment was added/i);
assert.match(contentSource, /Checking post language before any interaction/);
assert.match(contentSource, /scouts:classifyLanguages/);
assert.match(contentSource, /leadLanguageDecision/);
const postEngagementSource = contentSource.slice(
  contentSource.indexOf("async function runPostEngagement"),
  contentSource.indexOf("async function runConnectionRequest"),
);
assert.ok(
  postEngagementSource.indexOf('context: "posts"') <
    postEngagementSource.indexOf("handleLikeButton(postEl)"),
  "Post language must be checked before LinkedIn receives a Like.",
);
assert.ok(
  postEngagementSource.indexOf('response?.languageStatus !== "english"') <
    postEngagementSource.indexOf("handleLikeButton(postEl)"),
  "The finished English draft must be validated before LinkedIn receives a Like.",
);
assert.match(contentSource, /TOP_POST_SCAN_LIMIT = 3/);
assert.match(contentSource, /\.slice\(0, TOP_POST_SCAN_LIMIT\)/);
const findPostElementsSource = contentSource.slice(
  contentSource.indexOf("async function findPostElements"),
  contentSource.indexOf("function queryPostElements"),
);
assert.doesNotMatch(findPostElementsSource, /scrollIntoView/);
assert.match(contentSource, /DEFAULT_CONNECTION_LOOKBACK_DAYS = 30/);
assert.match(contentSource, /MAX_CONNECTION_LOOKBACK_DAYS = 183/);
assert.match(contentSource, /Checking connections from \$\{lookbackLabel\}/);
assert.doesNotMatch(contentSource, /INSPECT_PREMIUM_ACCOUNT|LinkedIn kept the Premium page open/);
assert.match(contentSource, /SET_AUTOMATION_CONTEXT/);
assert.match(contentSource, /markAutomationContext/);
assert.match(contentStyles, /callum-automation-marker/);
assert.match(contentStyles, /data-callum-automation/);
assert.doesNotMatch(backgroundSource, /CHECK_LINKEDIN_PREMIUM/);
assert.doesNotMatch(backgroundSource, /DRAFT_FIRST_DM|scouts:draftFirstDm/);
assert.match(backgroundSource, /scouts:draftConnectionNote/);
assert.match(backgroundSource, /checkLeadProfileLanguage/);
assert.match(backgroundSource, /scouts:recordLeadLanguageDecision/);
assert.match(backgroundSource, /languageFiltered: true/);
const leadWorkflowSource = backgroundSource.slice(
  backgroundSource.indexOf("async function runLeadWorkflow"),
  backgroundSource.indexOf("function uniqueLeads"),
);
assert.ok(
  leadWorkflowSource.indexOf("checkLeadProfileLanguage") <
    leadWorkflowSource.indexOf("inspectConnectionStatus"),
  "Profile language must be checked before the connection workflow.",
);
assert.match(backgroundSource, /CONNECTION_NOTE_MAX_ATTEMPTS = 2/);
assert.match(backgroundSource, /The connection request will still continue without a note/);
assert.doesNotMatch(backgroundSource, /PREMIUM_CHECK_TTL_MS|force: true|cached: true/);
assert.match(backgroundSource, /maxProfiles: 1_000/);
assert.match(backgroundSource, /DEFAULT_CONNECTION_REVIEW_LOOKBACK_DAYS = 30/);
assert.match(backgroundSource, /lookbackDays,/);
assert.match(backgroundSource, /connectionReviewLookbackDays/);
assert.match(clientSource, /ACTION_TIMEOUT_MS = 45_000/);
assert.match(clientSource, /AI_ACTION_TIMEOUT_MS = 90_000/);
assert.match(clientSource, /signal: controller\.signal/);
assert.match(clientSource, /Callum Scout lost its internet connection/);
assert.match(backgroundSource, /recordCompletedLeadTiming/);
assert.match(backgroundSource, /estimatedCompletionAt/);
assert.match(popupScript, /ETA will appear after the first lead finishes/);
assert.match(popupScript, /Estimated finish/);
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
assert.match(backgroundSource, /chrome\.power\.requestKeepAwake\(AUTOMATION_KEEP_AWAKE_LEVEL\)/);
assert.match(backgroundSource, /chrome\.power\.releaseKeepAwake\(\)/);
assert.match(backgroundSource, /AUTOMATION_KEEP_AWAKE_LEVEL = "display"/);
assert.doesNotMatch(backgroundSource, /premium\/my-premium|isLinkedInPremiumUrl\(finalUrl\)/);
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
assert.match(backgroundSource, /remove\(\["temporaryLeadTest", "invitationNote"\]\)/);
assert.doesNotMatch(backgroundSource, /if \(!dashboard\.hasSentConnectionRequest\) return empty/);
assert.match(backgroundSource, /CHECK_ACCEPTED_CONNECTIONS/);
assert.match(backgroundSource, /forceReview: true/);
assert.match(backgroundSource, /checkpoint: plan\.checkpoint/);
assert.match(backgroundSource, /cutoffDate: plan\.cutoffDate/);
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
assert.match(contentSource, /No comment was added\. Continuing to the connection request/);
assert.match(contentSource, /No comment was added, but this lead will still be connected/);
assert.doesNotMatch(contentSource, /No connection request was sent for this lead/);
assert.match(contentSource, /connectionState === "pending"/);
assert.match(contentSource, /No duplicate will be sent/);
assert.match(contentSource, /openConnectionInvitation/);
assert.match(contentSource, /the direct Connect button/);
assert.match(contentSource, /Connect in the More menu/);
assert.doesNotMatch(contentSource, /directAttempted/);
assert.match(contentSource, /scroll: method !== "Connect in the More menu"/);
assert.match(contentSource, /stateBeforeClick = findVisibleConnectionState/);
assert.match(contentSource, /requestAlreadyPending: true/);
assert.match(
  contentSource,
  /\[data-test-modal-id='send-invite-modal'\], \[role='dialog'\], dialog/,
);
assert.match(contentSource, /Details: \$\{skippedReasons\.join\("; "\)\}/);
assert.match(backgroundSource, /runPostEngagementWithRecovery/);
assert.match(backgroundSource, /engagementSkipped/);
assert.match(backgroundSource, /No comment was added for \$\{lead\.fullName\}\. Continuing to the connection request/);
assert.doesNotMatch(backgroundSource, /throw new Error\("You’ve used all your likes for today\."\)/);
assert.match(backgroundSource, /executeConnectionRequestWithRecovery/);
assert.match(backgroundSource, /CONNECTION_STATE_MAX_ATTEMPTS = 3/);
assert.match(backgroundSource, /CONNECTION_STATE_RETRY_DELAYS_MS = \[2_000, 4_000\]/);
assert.match(backgroundSource, /failedOnly: retryFailedOnly/);
assert.match(backgroundSource, /Retry mode: only failed leads will be processed/);
assert.match(backgroundSource, /isClosedMessageChannelError/);
assert.match(backgroundSource, /retryOnClosedChannel: true/);
assert.match(backgroundSource, /chrome\.tabs\.reload\(tabId\)/);
assert.match(backgroundSource, /profile actions are still loading/);
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
assert.match(backgroundSource, /excludeLeadIds: \[\.\.\.attemptedLeadIds\]/);
assert.match(backgroundSource, /pendingConnectionLeadIds\.add\(lead\.id\)/);
assert.match(backgroundSource, /Resume will continue with the next lead while it syncs/);
assert.match(backgroundSource, /chrome\.tabs\.onRemoved/);
assert.match(backgroundSource, /The automation tab was closed/);
assert.match(backgroundSource, /ensureAutomationTabGroup/);
assert.match(backgroundSource, /protected tab group was repaired automatically/i);
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
assert.match(scoutSource, /export const draftConnectionNote/);
assert.match(scoutSource, /export const classifyLanguages/);
assert.match(scoutSource, /LANGUAGE_CHECK_GATEWAY_TIMEOUT_MS = 20_000/);
assert.match(scoutSource, /language_check_unavailable/);
assert.match(scoutSource, /model: "unavailable-fallback"/);
assert.match(
  scoutSource,
  /catch \(error\)[\s\S]*status: "uncertain" as const[\s\S]*confidence: 0/,
);
assert.match(gatewayClientSource, /LANGUAGE_TURN_TIMEOUT_MS = 12_000/);
assert.match(gatewayClientSource, /TURN_TIMEOUT_MS = 75_000/);
assert.match(gatewayClientSource, /"turn\/interrupt"/);
assert.deepEqual(
  classifyLanguageLocally(
    "Founder and CEO at RockWood Advisory Partners and Partner, Head of Europe at Jensen Partners.",
  ),
  { status: "english", languageCode: "en", confidence: 0.98 },
);
assert.deepEqual(
  classifyLanguageLocally(
    "أساعد الشركات على تحسين العمليات وتطوير فرق القيادة واتخاذ قرارات استراتيجية أفضل بناء على معلومات واضحة.",
  ),
  { status: "non_english", languageCode: "und", confidence: 0.99 },
);
assert.equal(
  classifyLanguageLocally(
    "Founder | Conseil | Strategy | Liderazgo | AI | Growth",
  ).status,
  "uncertain",
);
const gatewayTimeoutProbe = new CodexAppServer({
  codexHome: "",
  model: "gpt-5.6-luna",
  safeWorkspace: "",
  async onAuthChanged() {},
});
const interruptRequests = [];
gatewayTimeoutProbe.request = async (method, params, timeoutMs) => {
  interruptRequests.push({ method, params, timeoutMs });
  return {};
};
await assert.rejects(
  gatewayTimeoutProbe.waitForTurnAndInterrupt(
    "thread-language-timeout",
    "turn-language-timeout",
    1,
  ),
  /Timed out while waiting for the Codex draft/,
);
assert.deepEqual(interruptRequests, [
  {
    method: "turn/interrupt",
    params: {
      threadId: "thread-language-timeout",
      turnId: "turn-language-timeout",
    },
    timeoutMs: 5_000,
  },
]);
assert.match(scoutSource, /export const recordLeadLanguageDecision/);
assert.match(scoutSource, /language_filtered/);
assert.match(scoutSource, /profile_language_checked_at/);
assert.match(schemaSource, /profile_language_status STRING NOT NULL DEFAULT 'unchecked'/);
assert.match(schemaSource, /'english', 'non_english', 'uncertain'/);
assert.match(scoutSource, /composeConnectionNote/);
assert.match(scoutSource, /const detailLimit = 300 - prefix\.length - closing\.length - 2/);
assert.match(scoutSource, /I would be glad to connect\./);
assert.match(scoutSource, /followups: followupTasks/);
assert.doesNotMatch(scoutSource, /export const draftFirstDm|firstDms|first_dm_drafted/);
const connectionNoteHelpers = scoutSource
  .slice(
    scoutSource.indexOf("function profileText"),
    scoutSource.indexOf("function scoreIcp"),
  )
  .replace("value: unknown, maximumLength: number", "value, maximumLength")
  .replace("firstNameValue: unknown, draftValue: unknown", "firstNameValue, draftValue");
const connectionNoteContext = {
  nullableString(value) {
    return typeof value === "string" && value ? value : null;
  },
};
vm.runInNewContext(connectionNoteHelpers, connectionNoteContext);
const sampleConnectionNote = connectionNoteContext.composeConnectionNote(
  "Shaun",
  "Your experience across strategic HR consulting and organisation development gives you a broad view of effective organisations.",
);
assert.equal(
  sampleConnectionNote,
  "Hi Shaun, your experience across strategic HR consulting and organisation development gives you a broad view of effective organisations. I would be glad to connect.",
);
assert.ok(
  connectionNoteContext.composeConnectionNote("Shaun", "Leadership ".repeat(80))
    .length <= 300,
  "Personal connection notes must stay within LinkedIn's 300-character limit",
);
assert.match(scoutSource, /a\.accepted_at >= now\(\) - INTERVAL '30 days'/);
assert.match(scoutSource, /inspect at most 1,000 profiles/);
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
assert.match(scoutSource, /export const rejectFailedLead/);
assert.match(scoutSource, /source: "scout_dashboard"/);
assert.match(scoutSource, /failedOnly: v\.optional\(v\.boolean\(\)\)/);
assert.match(scoutSource, /\["viewed", "engaged", "failed"\]\.includes\(row\.status\)/);
assert.match(scoutSource, /export const completeFollowupTask/);
assert.match(scoutSource, /createFollowupTasks/);
assert.match(
  scoutSource,
  /profileUrl: v\.optional\(v\.string\(\)\)/,
);
assert.match(scoutSource, /recoveredFromFailed/);
assert.match(scoutSource, /status IN \('viewed', 'engaged', 'failed'\)/);
assert.match(scoutSource, /excludeLeadIds: v\.optional\(v\.array\(v\.string\(\)\)\)/);
assert.match(scoutSource, /resumeExisting: v\.optional\(v\.boolean\(\)\)/);
assert.match(scoutSource, /existingExclusionSql/);
assert.match(scoutSource, /selectedExclusionSql/);
assert.match(
  scoutSource,
  /a\.status IN \('viewed', 'engaged'\)[\s\S]*?a\.status = 'assigned'[\s\S]*?ORDER BY\s+a\.assigned_at DESC,\s+CASE WHEN a\.qualification_status = 'qualified' THEN 0 ELSE 1 END,\s+a\.lead_id/,
);
assert.match(scoutSource, /veblenMatchExistsSql/);
assert.match(scoutSource, /This lead is a Veblen member and has been excluded from scout work/);
assert.match(backgroundSource, /resumeExisting: retryFailedOnly \? false : resumeExistingLead/);
assert.match(backgroundSource, /resumeExistingLead = false/);
assert.match(adminSource, /export const exportCleanCsv/);
assert.match(adminSource, /export const retryCrmDelivery/);
assert.match(schemaSource, /CREATE TABLE IF NOT EXISTS lead_followup_tasks/);
assert.match(schemaSource, /CREATE TABLE IF NOT EXISTS operator_daily_tasks/);
assert.match(schemaSource, /CREATE TABLE IF NOT EXISTS scout_escalations/);
assert.match(schemaSource, /CREATE TABLE IF NOT EXISTS crm_delivery_outbox/);
assert.match(schemaSource, /CREATE TABLE IF NOT EXISTS veblen_members/);
assert.match(schemaSource, /CREATE TABLE IF NOT EXISTS veblen_lead_matches/);
assert.match(adminAppSource, /Protected member list/);
assert.ok(!adminAppSource.includes(">Veblen exclusions</button>"));
assert.ok(adminAppSource.includes("<VeblenExclusionsPage load={loadVeblenMatches} />"));
assert.match(adminAppSource, /className="sidebar"/);
assert.match(adminAppSource, /Overview sections/);
assert.match(adminAppSource, /Scout administration sections/);
assert.match(adminAppSource, /Weekly board sections/);
assert.match(adminAppSource, /Daily work sections/);
assert.match(adminAppSource, /Lead directory sections/);
assert.match(adminAppSource, /setDirectorySection\("veblen"\)/);
assert.match(adminAppSource, /section=\{overviewSection\}/);
assert.match(adminAppSource, /section=\{scoutsSection\}/);
assert.match(adminAppSource, /section=\{weeklySection\}/);
assert.match(adminAppSource, /section=\{operationsSection\}/);
assert.match(adminAppSource, /window\.scrollTo\(\{ top: 0, behavior: "smooth" \}\)/);
assert.match(adminAppSource, /scoutSnapshotRef\.current\?\.scrollIntoView\(\{ behavior: "smooth", block: "center" \}\)/);
assert.ok(!adminAppSource.includes("liveHistoryRef"));
assert.match(adminAppSource, /Veblen member · excluded/);

const storedAuth = {
  callumScoutAuth: {
    token: "expired-access-token",
    refreshToken: "valid-refresh-token",
    username: "scout",
  },
};
let refreshCalls = 0;
const clientContext = {
  AbortController,
  clearTimeout,
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
  setTimeout,
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
const networkClientContext = {
  ...clientContext,
  async fetch() {
    throw new TypeError("Failed to fetch");
  },
};
vm.runInNewContext(clientSource, networkClientContext);
await assert.rejects(
  networkClientContext.ScoutApi.authenticatedAction("scouts:getDashboard"),
  /lost its internet connection/,
);
const timeoutDelays = [];
const timeoutClientContext = {
  ...clientContext,
  clearTimeout() {},
  setTimeout(_callback, delay) {
    timeoutDelays.push(delay);
    return timeoutDelays.length;
  },
  async fetch() {
    const error = new Error("aborted");
    error.name = "AbortError";
    throw error;
  },
};
vm.runInNewContext(clientSource, timeoutClientContext);
await assert.rejects(
  timeoutClientContext.ScoutApi.authenticatedAction("scouts:getDashboard"),
  /longer than 45 seconds/,
);
await assert.rejects(
  timeoutClientContext.ScoutApi.authenticatedAction("scouts:draftComment"),
  /longer than 90 seconds/,
);
assert.deepEqual(timeoutDelays, [45_000, 90_000]);

const listenerStub = () => ({ addListener() {}, removeListener() {} });
const backgroundStorage = {};
const backgroundActions = [];
const powerCalls = { requested: [], released: 0 };
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
    power: {
      requestKeepAwake(level) {
        powerCalls.requested.push(level);
      },
      releaseKeepAwake() {
        powerCalls.released += 1;
      },
    },
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
assert.equal(backgroundContext.defaultAutoLeadRunState().retryFailedOnly, false);
assert.equal(backgroundContext.requestAutomationKeepAwake(), true);
assert.equal(backgroundContext.requestAutomationKeepAwake(), false);
assert.deepEqual(powerCalls.requested, ["display"]);
backgroundContext.releaseAutomationKeepAwake();
assert.equal(powerCalls.released, 1);
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
assert.deepEqual(
  JSON.parse(JSON.stringify(backgroundContext.resolvePostEngagementOutcome({
    ok: true,
    result: {
      engagedCount: 0,
      skipped: true,
      skipReason: "The reviewer skipped this comment.",
    },
  }))),
  {
    engagedCount: 0,
    skipped: true,
    skipReason: "The reviewer skipped this comment.",
  },
);
assert.deepEqual(
  JSON.parse(JSON.stringify(backgroundContext.resolvePostEngagementOutcome({
    ok: false,
    error: "No recent posts were suitable.",
  }))),
  {
    engagedCount: 0,
    skipped: true,
    skipReason: "No recent posts were suitable.",
  },
  "A failed or skipped comment stage must become a non-blocking connection outcome.",
);
assert.deepEqual(
  JSON.parse(JSON.stringify(backgroundContext.resolvePostEngagementOutcome({
    ok: true,
    result: { engagedCount: 1 },
  }))),
  { engagedCount: 1, skipped: false, skipReason: null },
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
    timedLeads: 0,
    totalLeadDurationMs: 0,
    averageLeadDurationMs: null,
    estimatedRemainingLeads: null,
    estimatedRemainingMs: null,
    estimatedCompletionAt: null,
    results: [],
    failedLeads: [],
    pendingConnectionRequests: [],
  },
);
const etaProgress = backgroundContext.normalizeRunProgress({
  targetRequests: 20,
  processedLeads: 1,
  requestsSent: 1,
});
backgroundContext.recordCompletedLeadTiming(etaProgress, 120_000, 1_000_000);
assert.equal(etaProgress.averageLeadDurationMs, 120_000);
assert.equal(etaProgress.estimatedRemainingLeads, 19);
assert.equal(etaProgress.estimatedRemainingMs, 2_280_000);
assert.equal(etaProgress.estimatedCompletionAt, 3_280_000);
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
  "Extension checks passed: old-post blocking, AI note controls, successful-request reconciliation, isolated automation, resumable controls, and auth recovery are wired correctly.",
);
