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
  cursor: null,
  limit: 1,
});
const overview = await client.action(getOverview, { range: "all" });

if (
  stats.total < 1 ||
  page.leads.length !== 1 ||
  overview.summary.totalLeads !== stats.total
) {
  throw new Error("Smoke-test invariants failed.");
}
await client.action(signOut, {});

console.log(
  `Smoke test passed: ${stats.total} leads, ${overview.summary.totalScouts} scouts, authenticated admin APIs healthy.`,
);
