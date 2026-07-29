import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

const convexUrl = process.env.VITE_CONVEX_URL;
const siteUrl = process.env.VITE_CONVEX_SITE_URL;
const accessToken = process.env.LEADS_API_TOKEN;

if (!convexUrl || !siteUrl || !accessToken) {
  throw new Error("Convex URL, site URL, or access token is missing.");
}

const client = new ConvexHttpClient(convexUrl);
const getStats = makeFunctionReference("leads:getStats");
const listLeads = makeFunctionReference("leads:list");
const stats = await client.action(getStats, {});
const page = await client.action(listLeads, {
  accessToken,
  niche: null,
  search: null,
  cursor: null,
  limit: 1,
});

const httpResponse = await fetch(`${siteUrl}/api/leads/stats`, {
  headers: { Accept: "application/json" },
});
if (!httpResponse.ok) {
  throw new Error(`HTTP stats endpoint returned ${httpResponse.status}.`);
}
const httpStats = await httpResponse.json();

if (stats.total < 1 || page.leads.length !== 1 || httpStats.total !== stats.total) {
  throw new Error("Smoke-test invariants failed.");
}

console.log(
  `Smoke test passed: ${stats.total} leads, ${stats.niches.length} niche, action + HTTP APIs healthy.`,
);
