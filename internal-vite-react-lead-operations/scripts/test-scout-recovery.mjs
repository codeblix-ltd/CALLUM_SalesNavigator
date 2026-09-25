import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const content = readFileSync(new URL("../chrome-extension/content.js", import.meta.url), "utf8");
const background = readFileSync(new URL("../chrome-extension/background.js", import.meta.url), "utf8");
const recoverySource = content.slice(content.indexOf("const COMMENT_RECEIPT_PREFIX"), content.indexOf("async function runConnectionRequest"));
const options = { leadId: "lead-one", expectedScout: "alice", profileUrl: "https://www.linkedin.com/in/example", profileLanguageStatus: "english", postEngagements: 2, postEngagementTarget: 2 };

function harness({ failSave = 0, failDraft = 0, submitted = true, maxReceiptKeys = Infinity } = {}) {
  const data = {}, publicPosts = [], drafts = [], saves = [];
  let owner = "alice", writeFailure = false;
  const posts = [1, 2, 3].map(id => ({ id, scrollIntoView() {} }));
  const sandbox = {
    Date, Error, encodeURIComponent, overlayContainer: null,
    TOP_POST_SCAN_LIMIT: 3, MAX_POST_AGE_DAYS: 92,
    window: { location: { pathname: "/in/example/recent-activity/all/" } },
    chrome: { storage: { local: {
      get: async key => key === null ? structuredClone(data) : typeof key === "string" ? { [key]: structuredClone(data[key]) } : {},
      set: async values => {
        const nextReceiptKeys = new Set([...Object.keys(data), ...Object.keys(values)]
          .filter(key => key.startsWith("callumCommentReceipts:")));
        if (writeFailure || nextReceiptKeys.size > maxReceiptKeys) throw new Error("QUOTA_BYTES quota exceeded");
        Object.assign(data, structuredClone(values));
      },
      remove: async keys => { for (const key of typeof keys === "string" ? [keys] : keys) delete data[key]; },
    } } },
    ScoutApi: {
      getAuth: async () => ({ username: owner, token: "fixture" }),
      authenticatedAction: async (path, args, requestOptions) => {
        if (path === "scouts:classifyLanguages") return { results: args.samples.map(sample => ({ id: sample.id, status: "english", languageCode: "en", confidence: 1 })) };
        if (path === "scouts:draftComment") {
          drafts.push(args.postText);
          if (failDraft && drafts.length === failDraft) throw new Error("The writing service is temporarily unavailable.");
          return { draft: `Thoughtful English comment on ${args.postText}`, languageStatus: "english" };
        }
        assert.equal(path, "scouts:recordPostActivity");
        assert.equal(requestOptions.expectedUsername, owner, "save must remain bound to the receipt owner during auth refresh");
        saves.push(args.postUrl);
        const persisted = Object.values(data).flatMap(value => value.posts || []).find(post => post.activity.postUrl === args.postUrl);
        assert.equal(persisted?.state, "confirmed", "local confirmation must exist before remote save");
        if (failSave-- > 0) throw new Error("Network unavailable");
        return {};
      },
    },
    clampInteger: (n, min, max) => Math.max(min, Math.min(max, Number(n))),
    initOverlay() {}, updateStatus() {}, addLog() {}, sleep: async () => {}, handleSeeMore: async () => {},
    findPostElements: async () => posts,
    isRepostPost: () => false, isPostWithinAgeLimit: () => true, extractPostAgeDays: () => 1,
    extractPostText: post => `Post ${post.id} is an original English discussion of improving business performance and team operations.`,
    extractPostUrl: post => `https://www.linkedin.com/feed/update/urn:li:activity:${post.id}`,
    handleLikeButton: async () => ({ success: true, changed: true }),
    openCommentBox: async () => true, typeCommentInQuill: async () => true,
    submitComment: async post => {
      const key = `callumCommentReceipts:alice:lead-one`;
      assert(data[key].posts.some(receipt => receipt.state === "submitting" && receipt.activity.postUrl.endsWith(`:${post.id}`)), "intent must be durable before public click");
      publicPosts.push(post.id);
      return submitted;
    },
    cleanError: error => error.message || String(error),
  };
  vm.runInNewContext(recoverySource, sandbox);
  return { sandbox, data, publicPosts, drafts, saves, setOwner: value => { owner = value; }, failWrites: () => { writeFailure = true; } };
}

// A successful public comment with a failed database save is saved on Resume,
// never sent publicly twice, and remaining comments are still completed.
const saving = harness({ failSave: 1 });
await assert.rejects(saving.sandbox.runPostEngagement(options), /comment was posted but its progress/);
assert.deepEqual(saving.publicPosts, [1]);
assert.equal(saving.data["callumCommentReceipts:alice:lead-one"].posts[0].state, "confirmed");
const recovered = await saving.sandbox.runPostEngagement(options);
assert.deepEqual(saving.publicPosts, [1, 2]);
assert.equal(recovered.engagedCount, 2);
assert.equal(saving.drafts.length, 2, "do not regenerate or post comment one on Resume");
assert.equal(saving.data["callumCommentReceipts:alice:lead-one"].complete, true);

const partial = harness({ failDraft: 2 });
await assert.rejects(partial.sandbox.runPostEngagement(options), /writing service/);
assert.equal(partial.data["callumCommentReceipts:alice:lead-one"].complete, false);
assert.deepEqual(partial.publicPosts, [1]);
const finished = await partial.sandbox.runPostEngagement({ ...options, postEngagements: 1 });
assert.equal(finished.engagedCount, 2);
assert.deepEqual(partial.publicPosts, [1, 2], "remaining daily allowance and earlier completion are respected");

const uncertain = harness({ submitted: false });
const uncertainResult = await uncertain.sandbox.runPostEngagement(options);
assert.equal(uncertainResult.engagedCount, 0);
assert.equal(uncertain.saves.length, 0);
await uncertain.sandbox.runPostEngagement(options);
assert.deepEqual(uncertain.publicPosts, [1, 2], "uncertain comments are neither counted nor automatically retried");

const account = harness({ failSave: 1 });
await assert.rejects(account.sandbox.runPostEngagement(options));
account.setOwner("bob");
await assert.rejects(account.sandbox.runPostEngagement(options), /session changed/);
const bobReceipts = await account.sandbox.openCommentReceipts({ ...options, expectedScout: "bob" });
assert.equal(bobReceipts.data.posts.length, 0);
await account.sandbox.syncConfirmedComments(bobReceipts);
assert.equal(account.saves.length, 1, "a second scout never syncs the first scout's receipt");

const full = harness();
for (let i = 0; i < 100; i++) full.data[`callumCommentReceipts:alice:${i}`] = { owner: "alice", leadId: String(i), complete: false, posts: [{ state: "submitting", activity: { postUrl: `post-${i}` } }] };
await assert.rejects(full.sandbox.runPostEngagement(options), error => {
  assert.match(error.message, /progress could not be saved/);
  assert.equal(error.storageDiagnostics?.reason, "receipt_limit");
  assert.equal(error.storageDiagnostics?.stage, "prune");
  assert.equal(error.storageDiagnostics?.receiptCount, 100);
  return true;
});
assert.equal(full.publicPosts.length, 0);
assert.equal(Object.keys(full.data).length, 100);
full.data["callumCommentReceipts:alice:0"].complete = true;
full.data["callumCommentReceipts:alice:0"].posts[0].state = "synced";
await full.sandbox.saveCommentReceipts(await full.sandbox.openCommentReceipts(options));
assert.equal(Object.keys(full.data).length, 100, "only completed synced history may make room");
assert(full.data["callumCommentReceipts:alice:1"], "uncertain history is retained");

const sharedProfile = harness();
for (let i = 0; i < 100; i++) {
  sharedProfile.data[`callumCommentReceipts:former-scout:${i}`] = {
    owner: "former-scout", leadId: String(i), complete: true,
    updatedAt: i, posts: [{ state: "synced", activity: { postUrl: `post-${i}` } }],
  };
}
await sharedProfile.sandbox.saveCommentReceipts(
  await sharedProfile.sandbox.openCommentReceipts(options),
);
assert.equal(Object.keys(sharedProfile.data).length, 100,
  "completed, synced receipts from a previous login can safely make room");
assert(sharedProfile.data["callumCommentReceipts:alice:lead-one"],
  "the current scout can save progress despite another scout's completed history");
assert(!sharedProfile.data["callumCommentReceipts:former-scout:0"],
  "only the oldest fully synced receipt is pruned");

const quotaRecovery = harness({ maxReceiptKeys: 50 });
for (let i = 0; i < 50; i++) {
  quotaRecovery.data[`callumCommentReceipts:former-scout:${i}`] = {
    owner: "former-scout", leadId: String(i), complete: true,
    updatedAt: i, posts: [{ state: "synced", activity: { postUrl: `post-${i}` } }],
  };
}
quotaRecovery.data["callumCommentReceipts:former-scout:49"].complete = false;
quotaRecovery.data["callumCommentReceipts:former-scout:49"].posts[0].state = "uncertain";
await quotaRecovery.sandbox.saveCommentReceipts(
  await quotaRecovery.sandbox.openCommentReceipts(options),
);
assert(quotaRecovery.data["callumCommentReceipts:alice:lead-one"],
  "a quota rejection below the receipt-count cap should safely recover");
assert(quotaRecovery.data["callumCommentReceipts:former-scout:49"],
  "quota recovery must preserve uncertain comment history");
assert.equal(quotaRecovery.publicPosts.length, 0,
  "storage recovery itself must never submit a comment");

const storageFailure = harness();
storageFailure.failWrites();
await assert.rejects(storageFailure.sandbox.runPostEngagement(options), error => {
  assert.match(error.message, /progress could not be saved/);
  assert.equal(error.code, "COMMENT_RECEIPT_STORAGE_FAILED");
  assert.equal(error.storageDiagnostics?.stage, "write");
  assert.equal(error.storageDiagnostics?.reason, "quota");
  assert.equal(error.storageDiagnostics?.receiptCount, 0);
  return true;
});
assert.equal(storageFailure.publicPosts.length, 0);

const syncStorageFailure = harness();
const confirmed = await syncStorageFailure.sandbox.openCommentReceipts(options);
confirmed.data.posts.push({
  state: "confirmed",
  activity: { postUrl: "https://www.linkedin.com/feed/update/urn:li:activity:1" },
});
await syncStorageFailure.sandbox.saveCommentReceipts(confirmed);
syncStorageFailure.failWrites();
await assert.rejects(syncStorageFailure.sandbox.syncConfirmedComments(confirmed), error => {
  assert.match(error.message, /comment was posted but its progress could not be saved/i);
  assert.equal(error.code, "COMMENT_RECEIPT_STORAGE_FAILED");
  assert.equal(error.storageDiagnostics?.stage, "write");
  assert.equal(error.storageDiagnostics?.reason, "quota");
  return true;
});
assert.equal(syncStorageFailure.data[confirmed.key].posts[0].state, "confirmed",
  "a failed synced write retains the durable confirmation for safe recovery");
assert.equal(syncStorageFailure.saves.length, 1);
assert.equal(syncStorageFailure.publicPosts.length, 0,
  "sync recovery must not post a second public comment");

const visibleWorkflowSource = content.slice(
  content.indexOf("function runVisibleWorkflow"),
  content.indexOf("// --- Core Automation Functions ---"),
);
const visibleWorkflow = { Promise, overlayContainer: null, initOverlay() {},
  cleanError: error => error.message || String(error), showWorkflowError() {} };
vm.runInNewContext(visibleWorkflowSource, visibleWorkflow);
let reportedFailure;
await new Promise(resolve => visibleWorkflow.runVisibleWorkflow(
  async () => {
    const error = new Error("Comment progress could not be saved.");
    error.code = "COMMENT_RECEIPT_STORAGE_FAILED";
    error.storageDiagnostics = { stage: "write", reason: "quota", receiptCount: 0 };
    throw error;
  },
  response => { reportedFailure = response; resolve(); },
));
assert.equal(reportedFailure.errorCode, "COMMENT_RECEIPT_STORAGE_FAILED");
assert.equal(reportedFailure.storageDiagnostics.reason, "quota");
assert.match(background, /scouts:recordCommentStorageFailure/,
  "the background must persist only the sanitized storage failure classification");

// Run the actual submit confirmation function with minimal DOM fixtures.
const submitSource = content.slice(content.indexOf("async function submitComment("), content.indexOf("function countVisibleMatchingComments("));
for (const appearance of ["new-comment", "refresh", "existing-comment"]) {
  let clicked = false;
  const button = { disabled: false, isConnected: false };
  const editor = { textContent: "", closest: () => null };
  const post = { querySelector: selector => selector.includes("editor") ? editor : button };
  const ctx = { COMMENT_SUBMIT_CONFIRM_TIMEOUT_MS: 30000, sleep: async () => {},
    countVisibleMatchingComments: () => appearance === "existing-comment" || (clicked && appearance === "new-comment") ? 1 : 0,
    clickElement: () => { clicked = true; }, waitForMatch: async predicate => predicate(), isElementVisible: () => false };
  vm.runInNewContext(submitSource, ctx);
  assert.equal(await ctx.submitComment(post, "comment"), appearance === "new-comment", "button removal / editor clearing is not confirmation");
  if (appearance === "existing-comment") assert.equal(clicked, false);
}

const classifier = background.slice(background.indexOf("function cleanError("), background.indexOf("function isClosedMessageChannelError("));
const ctx = { Error };
vm.runInNewContext(classifier, ctx);
for (const message of ["The writing service is temporarily unavailable.", "The AI job timed out. Please retry.", "The AI job failed.", "Callum Scout took longer than 45 seconds to respond.", "Callum Scout lost its internet connection.", "A comment was posted but its progress could not be saved."]) {
  assert.equal(ctx.isRecoverableServiceError(new Error(message)), true, message);
}
assert.equal(ctx.isRecoverableServiceError(new Error("No recent posts; reposts were skipped.")), false);
assert.equal(ctx.isRecoverableServiceError({ code: "AI_UNAVAILABLE" }), true);

const noteSource = background.slice(background.indexOf("async function createPersonalizedConnectionNoteWithRetry("), background.indexOf("async function checkLeadProfileLanguage("));
let notes = 0;
Object.assign(ctx, { CONNECTION_NOTE_MAX_ATTEMPTS: 2, CONNECTION_NOTE_RETRY_DELAY_MS: 1000,
  throwIfWorkflowControlled() {}, isWorkflowControlError: () => false,
  sendAutomationMessageToTab: async () => ({ ok: true, result: {} }),
  sleep: async () => { throw new Error("Service errors must not blindly retry"); },
  ScoutApi: { authenticatedAction: async () => { notes++; throw new Error("The writing service is temporarily unavailable."); } },
});
vm.runInNewContext(noteSource, ctx);
await assert.rejects(ctx.createPersonalizedConnectionNoteWithRetry({}, 1, { id: "lead", fullName: "Example" }, "https://www.linkedin.com/in/example"), /writing service/);
assert.equal(notes, 1);
console.log("Scout recovery checks passed: save-after-post failure, remaining comments, uncertain-submit protection, account isolation, bounded storage, strict visible confirmation, service classification and note fail-fast.");
