import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";
import { auth } from "./auth";

const http = httpRouter();
auth.addHttpRoutes(http);

http.route({
  path: "/api/leads/stats",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const stats = await ctx.runAction(api.leads.getStats, {});
    return json(stats, request, 200);
  }),
});

http.route({
  path: "/api/leads/stats",
  method: "OPTIONS",
  handler: httpAction(async (_ctx, request) =>
    new Response(null, {
      status: 204,
      headers: corsHeaders(request),
    })),
});

function json(value: unknown, request: Request, status: number) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      ...corsHeaders(request),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=30",
    },
  });
}

function corsHeaders(request: Request) {
  const origin = request.headers.get("Origin") ?? "*";
  const allowedOrigin = origin.startsWith("chrome-extension://") ? origin : "*";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

export default http;
