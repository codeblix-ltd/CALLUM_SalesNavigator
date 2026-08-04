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

const [manifestSource, popupSource, popupScript, backgroundSource, contentSource, clientSource, scoutSource, adminSource, schemaSource] =
  await Promise.all([
    readExtensionFile("manifest.json"),
    readExtensionFile("popup.html"),
    readExtensionFile("popup.js"),
    readExtensionFile("background.js"),
    readExtensionFile("content.js"),
    readExtensionFile("convex-client.js"),
    readFile(path.join(projectRoot, "convex", "scouts.ts"), "utf8"),
    readFile(path.join(projectRoot, "convex", "adminAnalytics.ts"), "utf8"),
    readFile(path.join(projectRoot, "database", "schema.sql"), "utf8"),
  ]);
const manifest = JSON.parse(manifestSource);

assert.equal(manifest.version, "0.7.3");
assert.deepEqual(manifest.content_scripts[0].matches, [
  "https://*.linkedin.com/*",
]);
assert.deepEqual(manifest.permissions, ["alarms", "storage", "tabs"]);
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
assert.match(popupScript, /stored\.validateBeforeCommenting \?\? false/);
assert.match(popupScript, /scouts:resetOnboarding/);
assert.match(popupSource, /id="daily-checklist"/);
assert.match(popupSource, /id="followup-list"/);
assert.match(popupSource, /id="lead-check-list"/);
assert.match(popupSource, /id="old-request-list"/);
assert.match(popupSource, /id="question-form"/);
assert.match(popupScript, /scouts:getScoutOperations/);
assert.match(popupScript, /scouts:setDailyTask/);
assert.match(popupScript, /scouts:completeFollowupTask/);
assert.match(popupScript, /scouts:setLeadQualification/);
assert.match(popupScript, /scouts:markOldRequestWithdrawn/);
assert.match(popupScript, /scouts:createEscalation/);
assert.doesNotMatch(backgroundSource, /markOldRequestWithdrawn|invitation-manager\/sent/);
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
assert.match(contentSource, /Connected on\\s\+/);
assert.match(contentSource, /EXTRACT_CONTACT_INFO/);
assert.match(contentSource, /a\[href\^='mailto:'\]/);
assert.match(contentSource, /recordPostActivity/);
assert.match(contentSource, /options\.validateBeforeCommenting/);
assert.match(contentSource, /feed\/update\/urn:li:activity/);
assert.match(contentSource, /INSPECT_PREMIUM_ACCOUNT/);
assert.match(contentSource, /plan recommendation/i);
assert.match(contentSource, /manage-premium-account/);
assert.match(backgroundSource, /CHECK_LINKEDIN_PREMIUM/);
assert.match(backgroundSource, /premium\/my-premium/);
assert.match(backgroundSource, /INSPECT_PREMIUM_ACCOUNT/);
assert.match(backgroundSource, /localSettings\.validateBeforeCommenting \?\? false/);
assert.match(backgroundSource, /settings\.includeNote && settings\.linkedinPremium/);
assert.match(backgroundSource, /getConnectionReviewPlan/);
assert.match(backgroundSource, /recordConnectionReview/);
assert.match(backgroundSource, /recordContactInfo/);
assert.match(backgroundSource, /reserveConnectionRequest/);
assert.match(backgroundSource, /completeConnectionRequest/);
assert.match(backgroundSource, /dashboard\.usage\.requestRemaining/);
assert.match(clientSource, /error\?\.status === 401/);
assert.match(clientSource, /refreshOnce/);
assert.match(clientSource, /clearAuthIfUnchanged/);
assert.match(scoutSource, /export const getScoutOperations/);
assert.match(scoutSource, /export const markOldRequestWithdrawn/);
assert.match(scoutSource, /export const completeFollowupTask/);
assert.match(scoutSource, /createFollowupTasks/);
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
const backgroundContext = {
  URL,
  clearTimeout,
  console,
  importScripts() {},
  setTimeout,
  chrome: {
    action: {},
    alarms: { create() {}, onAlarm: listenerStub() },
    runtime: {
      onInstalled: listenerStub(),
      onMessage: listenerStub(),
      onStartup: listenerStub(),
    },
    tabs: { onUpdated: listenerStub() },
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

console.log(
  "Extension checks passed: production UI, invitation notes, Premium detection, and auth recovery are wired correctly.",
);
