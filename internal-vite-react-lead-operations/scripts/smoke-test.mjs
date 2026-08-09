import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

const convexUrl = process.env.VITE_CONVEX_URL;

if (!convexUrl) {
  throw new Error("VITE_CONVEX_URL is missing.");
}

const client = new ConvexHttpClient(convexUrl);
const signIn = makeFunctionReference("auth:signIn");
const signOut = makeFunctionReference("auth:signOut");
const getStats = makeFunctionReference("leads:getStats");
const listLeads = makeFunctionReference("leads:list");
const getOverview = makeFunctionReference("adminAnalytics:getOverview");
const listWorkEmailQueue = makeFunctionReference("workEmails:listQueue");
const saveWorkEmailResult = makeFunctionReference("workEmails:saveResult");
const credentials = {
  username: "callum2024",
  password: "callum2024",
};
let authResult;
try {
  authResult = await client.action(signIn, {
    provider: "admin",
    params: { ...credentials, flow: "signIn" },
  });
} catch {
  authResult = await client.action(signIn, {
    provider: "admin",
    params: { ...credentials, flow: "signUp" },
  });
}
if (!authResult?.tokens?.token) {
  throw new Error("Admin authentication did not return a session.");
}
client.setAuth(authResult.tokens.token);
const stats = await client.action(getStats, {});
const page = await client.action(listLeads, {
  niche: null,
  search: null,
  originalEmailFilter: "all",
  workEmailFilter: "all",
  cursor: null,
  limit: 1,
});
const workEmailPage = await client.action(listLeads, {
  niche: null,
  search: null,
  originalEmailFilter: "all",
  workEmailFilter: "present",
  cursor: null,
  limit: 5,
});
const overview = await client.action(getOverview, { range: "all" });
const workEmailQueue = await client.action(listWorkEmailQueue, { limit: 1 });
const unmatchedWorkEmail = await client.action(saveWorkEmailResult, {
  leadId: null,
  inputLinkedinUrl: "https://www.linkedin.com/in/callum-smoke-test-not-a-real-lead/",
  resolvedLinkedinUrl: "https://www.linkedin.com/in/callum-smoke-test-not-a-real-lead/",
  status: "not_found",
  email: null,
  validation: null,
  httpStatus: 200,
});

if (
  stats.total < 1 ||
  page.leads.length !== 1 ||
  page.filteredCount !== stats.total ||
  workEmailPage.leads.some((lead) => !lead.workEmail) ||
  overview.summary.totalLeads !== stats.total ||
  !Array.isArray(workEmailQueue.leads) ||
  typeof workEmailQueue.remaining !== "number" ||
  !("originalEmail" in page.leads[0]) ||
  !("workEmail" in page.leads[0]) ||
  unmatchedWorkEmail.saved !== false
) {
  throw new Error("Smoke-test invariants failed.");
}
await client.action(signOut, {});

console.log(
  `Smoke test passed: ${stats.total} leads, ${overview.summary.totalScouts} scouts, authenticated admin APIs healthy.`,
);
