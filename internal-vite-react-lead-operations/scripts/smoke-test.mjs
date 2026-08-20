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
const exportLeads = makeFunctionReference("leads:exportCsv");
const getOverview = makeFunctionReference("adminAnalytics:getOverview");
const getNicheAssignments = makeFunctionReference("adminScouts:getNicheAssignments");
const listUnassignedLeads = makeFunctionReference("adminScouts:listUnassignedLeads");
const createScout = makeFunctionReference("adminScouts:createScout");
const assignLeadCount = makeFunctionReference("adminScouts:assignLeadCount");
const setScoutActive = makeFunctionReference("adminScouts:setScoutActive");
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
  niches: [],
  search: null,
  originalEmailFilters: [],
  workEmailFilters: [],
  workEmailValidationFilters: [],
  cursor: null,
  limit: 1,
});
const workEmailPage = await client.action(listLeads, {
  niches: [],
  search: null,
  originalEmailFilters: [],
  workEmailFilters: ["present"],
  workEmailValidationFilters: [],
  cursor: null,
  limit: 5,
});
const validatedWorkEmailPage = await client.action(listLeads, {
  niches: [],
  search: null,
  originalEmailFilters: [],
  workEmailFilters: ["present"],
  workEmailValidationFilters: ["validated"],
  cursor: null,
  limit: 5,
});
const filteredExport = await client.action(exportLeads, {
  niches: [],
  search: null,
  originalEmailFilters: [],
  workEmailFilters: ["present"],
  workEmailValidationFilters: ["validated"],
});
const overview = await client.action(getOverview, { range: "all" });
const nicheAssignments = await client.action(getNicheAssignments, {});
const firstNiche = nicheAssignments.niches[0] ?? null;
const unassignedLeads = firstNiche
  ? await client.action(listUnassignedLeads, {
      niche: firstNiche.name,
      search: null,
      page: 1,
      pageSize: 10,
    })
  : null;
const existingScout = overview.scouts.find((scout) => scout.hasAccount);
let duplicateScoutRejected = existingScout === undefined;
if (existingScout) {
  try {
    await client.action(createScout, { username: existingScout.operatorId });
  } catch (error) {
    duplicateScoutRejected = String(error).toLowerCase().includes("already exists");
  }
}
let invalidQuantityRejected = existingScout === undefined || firstNiche === null;
if (existingScout && firstNiche) {
  try {
    await client.action(assignLeadCount, {
      operatorId: existingScout.operatorId,
      niche: firstNiche.name,
      count: 0,
    });
  } catch (error) {
    invalidQuantityRejected = String(error).toLowerCase().includes("between 1 and 100,000");
  }
}
let scoutToggleHealthy = existingScout === undefined;
if (existingScout) {
  const toggleResult = await client.action(setScoutActive, {
    operatorId: existingScout.operatorId,
    active: existingScout.active,
  });
  scoutToggleHealthy = toggleResult.operatorId === existingScout.operatorId && toggleResult.active === existingScout.active;
}
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
  validatedWorkEmailPage.leads.some((lead) => lead.workEmailValidation?.trim().toLowerCase() !== "valid") ||
  typeof filteredExport.csv !== "string" ||
  !filteredExport.csv.startsWith('"LinkedIn URL"') ||
  filteredExport.rowCount > 25000 ||
  typeof filteredExport.truncated !== "boolean" ||
  overview.summary.totalLeads !== stats.total ||
  !Array.isArray(nicheAssignments.niches) ||
  nicheAssignments.niches.some((niche) => niche.total !== niche.assigned + niche.unassigned) ||
  (unassignedLeads !== null && unassignedLeads.leads.length > 10) ||
  !duplicateScoutRejected ||
  !invalidQuantityRejected ||
  !scoutToggleHealthy ||
  !Array.isArray(workEmailQueue.leads) ||
  typeof workEmailQueue.remaining !== "number" ||
  !("originalEmail" in page.leads[0]) ||
  !("workEmail" in page.leads[0]) ||
  !("workEmailValidation" in page.leads[0]) ||
  unmatchedWorkEmail.saved !== false
) {
  throw new Error("Smoke-test invariants failed.");
}
await client.action(signOut, {});

console.log(
  `Smoke test passed: ${stats.total} leads, ${overview.summary.totalScouts} scouts, authenticated admin APIs healthy.`,
);
