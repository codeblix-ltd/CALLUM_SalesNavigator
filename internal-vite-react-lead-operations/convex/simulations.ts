"use node";

import { v } from "convex/values";
import type { PoolClient } from "pg";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import { getPool } from "./lib/cockroach";

type ScoutIdentity = {
  userId: string;
  username: string;
  operatorId: string;
};

type SimulationLead = {
  simulationRunId: string;
  id: string;
  fullName: string | null;
  currentTitle: string | null;
  companyName: string | null;
  status: string;
};

const optionalText = v.union(v.string(), v.null());
const simulationLeadValidator = v.object({
  simulationRunId: v.string(),
  id: v.string(),
  fullName: optionalText,
  currentTitle: optionalText,
  companyName: optionalText,
  status: v.string(),
});
const simulationStatusValidator = v.union(
  v.literal("engaged"),
  v.literal("connection_requested"),
  v.literal("accepted"),
  v.literal("email_collected"),
  v.literal("failed"),
);

export const claimNextLead = action({
  args: {},
  returns: v.union(simulationLeadValidator, v.null()),
  handler: async (ctx): Promise<SimulationLead | null> => {
    const scout: ScoutIdentity = await ctx.runQuery(
      internal.scoutIdentity.requireScout,
      {},
    );
    const database = getPool();

    // The unique key is the final concurrency guard. A short retry lets a
    // second simulator tab move to the next fixture if both select at once.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const client = await database.connect();
      try {
        await client.query("BEGIN");
        const claimed = await client.query(
          `INSERT INTO lead_simulation_runs (lead_id, operator_id, status)
           SELECT a.lead_id, a.operator_id, 'viewed'
             FROM lead_assignments AS a
            WHERE a.operator_id = $1
              AND NOT EXISTS (
                SELECT 1
                  FROM lead_simulation_runs AS r
                 WHERE r.operator_id = a.operator_id
                   AND r.lead_id = a.lead_id
              )
            ORDER BY a.assigned_at, a.lead_id
            LIMIT 1
           ON CONFLICT (operator_id, lead_id) DO NOTHING
           RETURNING id::STRING AS simulation_run_id, lead_id::STRING AS lead_id, status`,
          [scout.operatorId],
        );
        const run = claimed.rows[0];
        if (!run) {
          await client.query("COMMIT");
          continue;
        }

        await insertSimulationEvent(
          client,
          run.simulation_run_id,
          run.lead_id,
          scout.operatorId,
          "viewed",
          { source: "local_mock_linkedin" },
        );
        const result = await client.query(
          `SELECT
             $1::STRING AS simulation_run_id,
             l.id::STRING AS id,
             l.full_name,
             l.current_title,
             l.company_name,
             $2::STRING AS status
           FROM leads AS l
           WHERE l.id = $3::UUID`,
          [run.simulation_run_id, run.status, run.lead_id],
        );
        await client.query("COMMIT");
        return result.rows[0] ? mapSimulationLead(result.rows[0]) : null;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }

    return null;
  },
});

export const updateStatus = action({
  args: {
    simulationRunId: v.string(),
    status: simulationStatusValidator,
    postCount: v.union(v.number(), v.null()),
    note: optionalText,
    email: optionalText,
    error: optionalText,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const scout: ScoutIdentity = await ctx.runQuery(
      internal.scoutIdentity.requireScout,
      {},
    );
    if (!isUuid(args.simulationRunId)) {
      throw new Error("Invalid simulation run identifier.");
    }

    const postCount =
      args.postCount === null ? null : clampInteger(args.postCount, 0, 10);
    const note = args.note?.trim().slice(0, 1_000) || null;
    const email = args.email?.trim().toLowerCase().slice(0, 320) || null;
    const errorMessage = args.error?.trim().slice(0, 1_000) || null;
    if (args.status === "email_collected" && !isValidEmail(email)) {
      throw new Error("The simulation fixture must contain a valid email.");
    }

    const database = getPool();
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      const currentResult = await client.query(
        `SELECT lead_id::STRING AS lead_id, status
           FROM lead_simulation_runs
          WHERE id = $1::UUID AND operator_id = $2
          FOR UPDATE`,
        [args.simulationRunId, scout.operatorId],
      );
      const current = currentResult.rows[0];
      if (!current) throw new Error("Simulation run not found.");
      if (!isAllowedTransition(String(current.status), args.status)) {
        throw new Error(
          `Cannot move a simulation from ${current.status} to ${args.status}.`,
        );
      }

      await client.query(
        `UPDATE lead_simulation_runs
            SET status = $3,
                updated_at = now(),
                posts_engaged = CASE
                  WHEN $3 = 'engaged' THEN coalesce($4, posts_engaged)
                  ELSE posts_engaged
                END,
                invitation_note = CASE
                  WHEN $3 = 'connection_requested' THEN $5
                  ELSE invitation_note
                END,
                extracted_email = CASE
                  WHEN $3 = 'email_collected' THEN $6
                  ELSE extracted_email
                END,
                last_error = CASE WHEN $3 = 'failed' THEN $7 ELSE last_error END,
                completed_at = CASE
                  WHEN $3 IN ('email_collected', 'failed') THEN now()
                  ELSE completed_at
                END
          WHERE id = $1::UUID AND operator_id = $2`,
        [
          args.simulationRunId,
          scout.operatorId,
          args.status,
          postCount,
          note,
          email,
          errorMessage,
        ],
      );
      await insertSimulationEvent(
        client,
        args.simulationRunId,
        current.lead_id,
        scout.operatorId,
        args.status,
        {
          postCount: args.status === "engaged" ? postCount : undefined,
          note: args.status === "connection_requested" ? note : undefined,
          email: args.status === "email_collected" ? email : undefined,
          error: args.status === "failed" ? errorMessage : undefined,
        },
      );
      await client.query("COMMIT");
      return null;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },
});

function mapSimulationLead(row: Record<string, unknown>): SimulationLead {
  return {
    simulationRunId: String(row.simulation_run_id),
    id: String(row.id),
    fullName: nullableString(row.full_name),
    currentTitle: nullableString(row.current_title),
    companyName: nullableString(row.company_name),
    status: String(row.status),
  };
}

function nullableString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function clampInteger(value: number, minimum: number, maximum: number) {
  if (!Number.isFinite(value)) throw new Error("Post count must be a number.");
  return Math.max(minimum, Math.min(maximum, Math.trunc(value)));
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function isValidEmail(value: string | null): value is string {
  return Boolean(value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
}

function isAllowedTransition(current: string, next: string) {
  if (next === "failed") {
    return ["viewed", "engaged", "connection_requested", "accepted"].includes(
      current,
    );
  }
  const transitions: Record<string, string> = {
    viewed: "engaged",
    engaged: "connection_requested",
    connection_requested: "accepted",
    accepted: "email_collected",
  };
  return transitions[current] === next;
}

async function insertSimulationEvent(
  client: PoolClient,
  simulationRunId: unknown,
  leadId: unknown,
  operatorId: string,
  eventType: string,
  details: Record<string, unknown>,
) {
  await client.query(
    `INSERT INTO lead_simulation_events (
       simulation_run_id,
       lead_id,
       operator_id,
       event_type,
       details
     ) VALUES ($1::UUID, $2::UUID, $3, $4, $5::JSONB)`,
    [
      simulationRunId,
      leadId,
      operatorId,
      eventType,
      JSON.stringify(details),
    ],
  );
}
