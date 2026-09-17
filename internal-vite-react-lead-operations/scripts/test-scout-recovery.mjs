import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const content = readFileSync(new URL("../chrome-extension/content.js", import.meta.url), "utf8");
const background = readFileSync(new URL("../chrome-extension/background.js", import.meta.url), "utf8");
const recoverySource = content.slice(content.indexOf("const COMMENT_RECEIPT_PREFIX"), content.indexOf("async function runConnectionRequest"));
const options = { leadId: "lead-one", expectedScout: "alice", profileUrl: "https://www.linkedin.com/in/example", profileLanguageStatus: "english", postEngagements: 2, postEngagementTarget: 2 };

function harness({ failSave = 0, failDraft = 0, submitted = true } = {}) {
  const data = {}, publicPosts = [], drafts = [], saves = [];
  let owner = "alice", writeFailure = false;
  const posts = [1, 2, 3].map(id => ({ id, scrollIntoView() {} }));
  const sandbox = {
    Date, Error, encodeURIComponent, overlayContainer: null,
    TOP_POST_SCAN_LIMIT: 3, MAX_POST_AGE_DAYS: 92,
    window: { location: { pathname: "/in/example/recent-activity/all/" } },
    chrome: { storage: { local: {
      get: async key => key === null ? structuredClone(data) : typeof key === "string" ? { [key]: structuredClone(data[key]) } : {},
      set: async values => { if (writeFailure) throw new Error("Storage full"); Object.assign(data, structuredClone(values)); },
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
await assert.rejects(full.sandbox.runPostEngagement(options), /progress could not be saved/);
assert.equal(full.publicPosts.length, 0);
assert.equal(Object.keys(full.data).length, 100);
full.data["callumCommentReceipts:alice:0"].complete = true;
full.data["callumCommentReceipts:alice:0"].posts[0].state = "synced";
await full.sandbox.saveCommentReceipts(await full.sandbox.openCommentReceipts(options));
assert.equal(Object.keys(full.data).length, 100, "only completed synced history may make room");
assert(full.data["callumCommentReceipts:alice:1"], "uncertain history is retained");

const storageFailure = harness();
storageFailure.failWrites();
await assert.rejects(storageFailure.sandbox.runPostEngagement(options), /progress could not be saved/);
assert.equal(storageFailure.publicPosts.length, 0);

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
