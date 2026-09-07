"use node";

import { getPool } from "./cockroach";

const GHL_API_BASE_URL = "https://services.leadconnectorhq.com";
const GHL_API_VERSION = "v3";
const GHL_BASE_TAG = "dro_va";
const GHL_BATCH_SIZE = 20;
const GHL_AUDIT_BATCH_SIZE = 50;
const GHL_MAX_AUTOMATIC_ATTEMPTS = 5;
const GHL_OUTBOX_LEASE_MINUTES = 2;
const GHL_REQUEST_SPACING_MS = 150;
const GHL_REQUEST_TIMEOUT_MS = 20_000;

const scoutTagAliases: Record<string, string> = {
  "daniel-c-briongos": "daniel",
  "em-scout": "em",
  "gae-anne": "gaeanne",
  "hermervash-peligrina": "vash",
  "mae-ann-q-bacor": "mae",
  "micol-jezreel-amado": "micol",
  "risheil-nicole-jago": "risheil",
  rymaelie: "rymealie",
  "vinod-kaushal": "vinod",
};

type GhlConfig = {
  token: string;
  locationId: string;
  linkedinCustomFieldId: string;
};

type GhlTag = {
  id?: string;
  name?: string;
};

type GhlTagsResponse = {
  tags?: GhlTag[];
};

type GhlUpsertResponse = {
  new?: boolean;
  contact?: {
    id?: string;
  };
  traceId?: string;
};

type GhlContactSearchResponse = {
  contacts?: Array<{
    id?: string;
    email?: string;
  }>;
};

type DeliveryRow = {
  id: string;
  lead_id: string;
  operator_id: string;
  first_name: unknown;
  last_name: unknown;
  full_name: unknown;
  linkedin_url: unknown;
  original_email: unknown;
  attempt_count: unknown;
};

export type GhlDeliveryResult = {
  attempted: number;
  sent: number;
  failed: number;
  created: number;
  updated: number;
  maxAttemptCount: number;
};

export type GhlAuditResult = {
  attempted: number;
  linked: number;
  missing: number;
  duplicate: number;
  failed: number;
};

let knownTags: Set<string> | null = null;
let knownTagsExpiresAt = 0;
let nextGhlRequestAt = 0;
let requestSlot = Promise.resolve();

export function ghlBatchSize() {
  return GHL_BATCH_SIZE;
}

export function ghlAuditBatchSize() {
  return GHL_AUDIT_BATCH_SIZE;
}

export function ghlMaxAutomaticAttempts() {
  return GHL_MAX_AUTOMATIC_ATTEMPTS;
}

export function ghlRetryDelayMs(attemptCount: number) {
  const exponent = Math.max(0, Math.min(3, attemptCount - 1));
  return Math.max(130_000, 60_000 * (2 ** exponent));
}

export function isGhlCompatibleEmail(value: string | null): value is string {
  if (!value || value.length > 254 || value !== value.trim()) return false;
  const parts = value.split("@");
  if (parts.length !== 2) return false;
  const [local = "", domain = ""] = parts;
  if (!local || local.length > 64 || local.startsWith(".") || local.endsWith(".")) return false;
  if (local.includes("..") || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)) return false;
  if (!domain || domain.length > 253) return false;
  const labels = domain.split(".");
  if (labels.length < 2 || (labels.at(-1)?.length ?? 0) < 2) return false;
  return labels.every((label) => (
    label.length <= 63
    && /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label)
  ));
}

export function scoutTagName(operatorId: string) {
  const normalized = operatorId.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{1,79}$/.test(normalized)) {
    throw new Error("A valid scout username is required for GHL tagging.");
  }
  const slug = scoutTagAliases[normalized]
    ?? normalized.replace(/-scout$/, "").split("-")[0];
  if (!slug) throw new Error("The scout username cannot be mapped to a GHL tag.");
  return `dro/va/${slug}`;
}

export async function ensureGhlScoutTags(operatorIds: string[]) {
  const tagNames = [...new Set(operatorIds.map(scoutTagName))];
  await ensureGhlTags([GHL_BASE_TAG, ...tagNames]);
  return tagNames;
}

export async function deliverGhlOutboxRows(args: {
  outboxId: string | null;
  includeFailed: boolean;
  limit?: number;
}): Promise<GhlDeliveryResult> {
  const rows = await claimDeliveryRows({
    outboxId: args.outboxId,
    includeFailed: args.includeFailed,
    limit: Math.max(1, Math.min(GHL_BATCH_SIZE, Math.trunc(args.limit ?? GHL_BATCH_SIZE))),
  });
  if (rows.length === 0) return emptyDeliveryResult();

  const requiredTags = [
    GHL_BASE_TAG,
    ...rows.map((row) => scoutTagName(row.operator_id)),
  ];
  try {
    await ensureGhlTags(requiredTags);
  } catch (error) {
    const message = errorMessage(error);
    await Promise.all(rows.map((row) => markDeliveryFailed(row.id, message)));
    return {
      attempted: rows.length,
      sent: 0,
      failed: rows.length,
      created: 0,
      updated: 0,
      maxAttemptCount: maximumAttemptCount(rows),
    };
  }

  const outcomes = await mapWithConcurrency(rows, 4, deliverGhlRow);
  return {
    attempted: rows.length,
    sent: outcomes.filter((outcome) => outcome.status === "sent").length,
    failed: outcomes.filter((outcome) => outcome.status === "failed").length,
    created: outcomes.filter((outcome) => outcome.status === "sent" && outcome.created).length,
    updated: outcomes.filter((outcome) => outcome.status === "sent" && !outcome.created).length,
    maxAttemptCount: maximumAttemptCount(rows),
  };
}

export async function auditGhlOutboxRows(limit = GHL_AUDIT_BATCH_SIZE): Promise<GhlAuditResult> {
  const database = getPool();
  const result = await database.query(
    `SELECT o.id::STRING AS id, lower(l.original_email) AS email
       FROM crm_delivery_outbox AS o
       INNER JOIN leads AS l ON l.id = o.lead_id
      WHERE o.status = 'sent'
        AND o.ghl_checked_at IS NULL
        AND l.original_email IS NOT NULL
      ORDER BY o.sent_at, o.id
      LIMIT $1`,
    [Math.max(1, Math.min(GHL_AUDIT_BATCH_SIZE, Math.trunc(limit)))],
  );
  const rows = result.rows.map((row) => ({
    id: String(row.id),
    email: String(row.email ?? "").trim().toLowerCase(),
  }));
  if (rows.length === 0) {
    return { attempted: 0, linked: 0, missing: 0, duplicate: 0, failed: 0 };
  }

  const idsByEmail = new Map<string, string[]>();
  for (const row of rows) {
    const ids = idsByEmail.get(row.email) ?? [];
    ids.push(row.id);
    idsByEmail.set(row.email, ids);
  }
  const outcomes = await mapWithConcurrency(
    [...idsByEmail.entries()],
    4,
    async ([email, ids]) => auditGhlEmail(database, email, ids),
  );
  return outcomes.reduce<GhlAuditResult>(
    (summary, outcome) => ({
      attempted: summary.attempted + outcome.attempted,
      linked: summary.linked + outcome.linked,
      missing: summary.missing + outcome.missing,
      duplicate: summary.duplicate + outcome.duplicate,
      failed: summary.failed + outcome.failed,
    }),
    { attempted: 0, linked: 0, missing: 0, duplicate: 0, failed: 0 },
  );
}

async function claimDeliveryRows(args: {
  outboxId: string | null;
  includeFailed: boolean;
  limit: number;
}) {
  const database = getPool();
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    const candidates = await client.query(
      `SELECT o.id::STRING AS id
         FROM crm_delivery_outbox AS o
         INNER JOIN leads AS l ON l.id = o.lead_id
         INNER JOIN lead_assignments AS a
           ON a.lead_id = o.lead_id AND a.operator_id = o.operator_id
        WHERE (o.status = 'pending' OR ($2::BOOL AND o.status = 'failed'))
          AND ($1::UUID IS NULL OR o.id = $1::UUID)
          AND ($1::UUID IS NOT NULL OR o.attempt_count < $3)
          AND (
            o.last_attempt_at IS NULL
            OR o.last_attempt_at <= now() - ($4::INT * INTERVAL '1 minute')
          )
          AND l.original_email IS NOT NULL
        ORDER BY CASE WHEN o.status = 'pending' THEN 0 ELSE 1 END, o.created_at, o.id
        LIMIT $5
        FOR UPDATE`,
      [
        args.outboxId,
        args.includeFailed,
        GHL_MAX_AUTOMATIC_ATTEMPTS,
        GHL_OUTBOX_LEASE_MINUTES,
        args.limit,
      ],
    );
    const ids = candidates.rows.map((row) => String(row.id));
    if (ids.length === 0) {
      await client.query("COMMIT");
      return [] as DeliveryRow[];
    }
    await client.query(
      `UPDATE crm_delivery_outbox
          SET attempt_count = attempt_count + 1,
              last_attempt_at = now(),
              updated_at = now()
        WHERE id = ANY($1::UUID[])`,
      [ids],
    );
    const result = await client.query(
      `SELECT
         o.id::STRING AS id,
         o.lead_id::STRING AS lead_id,
         o.operator_id,
         o.attempt_count::FLOAT8 AS attempt_count,
         l.first_name,
         l.last_name,
         l.full_name,
         coalesce(a.resolved_linkedin_url, l.linkedin_url) AS linkedin_url,
         l.original_email
       FROM crm_delivery_outbox AS o
       INNER JOIN leads AS l ON l.id = o.lead_id
       INNER JOIN lead_assignments AS a
         ON a.lead_id = o.lead_id AND a.operator_id = o.operator_id
       WHERE o.id = ANY($1::UUID[])
       ORDER BY o.created_at, o.id`,
      [ids],
    );
    await client.query("COMMIT");
    return result.rows as DeliveryRow[];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function deliverGhlRow(row: DeliveryRow) {
  try {
    const email = cleanEmail(row.original_email);
    const linkedinUrl = cleanLinkedInUrl(row.linkedin_url);
    const names = cleanNames(row.first_name, row.last_name, row.full_name);
    const config = ghlConfig();
    const body: Record<string, unknown> = {
      email,
      locationId: config.locationId,
      createNewIfDuplicateAllowed: false,
      customFields: [{
        id: config.linkedinCustomFieldId,
        fieldValue: linkedinUrl,
      }],
    };
    if (names.firstName) body.firstName = names.firstName;
    if (names.lastName) body.lastName = names.lastName;
    if (names.fullName) body.name = names.fullName;

    const upsert = await ghlRequest<GhlUpsertResponse>(
      "/contacts/upsert",
      {
        method: "POST",
        body: JSON.stringify(body),
      },
      "contacts.write",
    );
    const contactId = String(upsert.contact?.id ?? "").trim();
    if (!contactId) throw new Error("GHL upsert did not return a contact ID.");

    await ghlRequest(
      `/contacts/${encodeURIComponent(contactId)}/tags`,
      {
        method: "POST",
        body: JSON.stringify({
          tags: [GHL_BASE_TAG, scoutTagName(row.operator_id)],
        }),
      },
      "contacts.write",
    );
    await markDeliverySent(
      row.id,
      contactId,
      upsert.new === true ? "created" : "updated",
      nullableTrimmedString(upsert.traceId),
    );
    return { status: "sent" as const, created: upsert.new === true };
  } catch (error) {
    await markDeliveryFailed(row.id, errorMessage(error));
    return { status: "failed" as const, created: false };
  }
}

async function ensureGhlTags(tagNames: string[]) {
  const requested = [...new Set(tagNames.map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
  if (requested.length === 0) return;
  let tags = await getKnownTags();
  for (const tagName of requested) {
    if (tags.has(tagName)) continue;
    try {
      await ghlRequest(
        `/locations/${encodeURIComponent(ghlConfig().locationId)}/tags`,
        {
          method: "POST",
          body: JSON.stringify({ name: tagName }),
        },
        "locations/tags.write",
      );
      tags.add(tagName);
    } catch (error) {
      if (!(error instanceof GhlApiError) || error.status !== 422) throw error;
      knownTags = null;
      tags = await getKnownTags();
      if (!tags.has(tagName)) throw error;
    }
  }
}

async function getKnownTags() {
  if (knownTags && knownTagsExpiresAt > Date.now()) return knownTags;
  const config = ghlConfig();
  const response = await ghlRequest<GhlTagsResponse>(
    `/locations/${encodeURIComponent(config.locationId)}/tags`,
    { method: "GET" },
    "locations/tags.readonly",
  );
  knownTags = new Set(
    (response.tags ?? [])
      .map((tag) => String(tag.name ?? "").trim().toLowerCase())
      .filter(Boolean),
  );
  knownTagsExpiresAt = Date.now() + 5 * 60_000;
  return knownTags;
}

async function ghlRequest<T = unknown>(
  path: string,
  init: RequestInit,
  requiredScope: string,
): Promise<T> {
  const config = ghlConfig();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await reserveGhlRequestSlot();
    let response: Response;
    try {
      response = await fetch(`${GHL_API_BASE_URL}${path}`, {
        ...init,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${config.token}`,
          "content-type": "application/json",
          version: GHL_API_VERSION,
          ...init.headers,
        },
        signal: AbortSignal.timeout(GHL_REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      if (attempt < 2) {
        await sleep(1_000 * (2 ** attempt));
        continue;
      }
      throw error;
    }

    const text = (await response.text()).trim();
    if (response.ok) {
      if (!text) return {} as T;
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new Error("GHL returned an unreadable success response.");
      }
    }

    if ((response.status === 429 || response.status >= 500) && attempt < 2) {
      await sleep(retryDelayFromResponse(response, attempt));
      continue;
    }
    throw new GhlApiError(
      response.status,
      `GHL returned ${response.status} for ${requiredScope}: ${safeResponseDetail(text)}`,
    );
  }
  throw new Error("GHL request retries were exhausted.");
}

async function reserveGhlRequestSlot() {
  let release = () => {};
  const previous = requestSlot;
  requestSlot = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  const waitMs = Math.max(0, nextGhlRequestAt - Date.now());
  if (waitMs > 0) await sleep(waitMs);
  nextGhlRequestAt = Date.now() + GHL_REQUEST_SPACING_MS;
  release();
}

async function markDeliverySent(
  outboxId: string,
  contactId: string,
  outcome: "created" | "updated",
  traceId: string | null,
) {
  await getPool().query(
    `UPDATE crm_delivery_outbox
        SET status = 'sent',
            sent_at = now(),
            last_error = NULL,
            ghl_contact_id = $2,
            delivery_outcome = $3,
            ghl_trace_id = $4,
            ghl_checked_at = now(),
            ghl_lookup_error = NULL,
            updated_at = now()
      WHERE id = $1::UUID`,
    [outboxId, contactId, outcome, traceId],
  );
}

async function auditGhlEmail(
  database: ReturnType<typeof getPool>,
  email: string,
  outboxIds: string[],
): Promise<GhlAuditResult> {
  const attempted = outboxIds.length;
  try {
    const config = ghlConfig();
    const query = new URLSearchParams({
      locationId: config.locationId,
      query: email,
      limit: "100",
    });
    const response = await ghlRequest<GhlContactSearchResponse>(
      `/contacts/?${query.toString()}`,
      { method: "GET" },
      "contacts.readonly",
    );
    const exactMatches = (response.contacts ?? []).filter(
      (contact) => String(contact.email ?? "").trim().toLowerCase() === email,
    );
    if (exactMatches.length === 1) {
      const contactId = String(exactMatches[0]?.id ?? "").trim();
      if (!contactId) throw new Error("GHL contact search returned an empty contact ID.");
      await database.query(
        `UPDATE crm_delivery_outbox
            SET ghl_contact_id = $2,
                ghl_checked_at = now(),
                ghl_lookup_error = NULL,
                updated_at = now()
          WHERE id = ANY($1::UUID[])`,
        [outboxIds, contactId],
      );
      return { attempted, linked: attempted, missing: 0, duplicate: 0, failed: 0 };
    }

    const missing = exactMatches.length === 0 ? attempted : 0;
    const duplicate = exactMatches.length > 1 ? attempted : 0;
    const message = exactMatches.length === 0
      ? "No exact GHL contact was found for this sent email."
      : `GHL contains ${exactMatches.length} exact contacts for this email.`;
    await database.query(
      `UPDATE crm_delivery_outbox
          SET ghl_contact_id = NULL,
              ghl_checked_at = now(),
              ghl_lookup_error = $2,
              updated_at = now()
        WHERE id = ANY($1::UUID[])`,
      [outboxIds, message],
    );
    return { attempted, linked: 0, missing, duplicate, failed: 0 };
  } catch (error) {
    await database.query(
      `UPDATE crm_delivery_outbox
          SET ghl_lookup_error = $2, updated_at = now()
        WHERE id = ANY($1::UUID[])`,
      [outboxIds, errorMessage(error)],
    );
    return { attempted, linked: 0, missing: 0, duplicate: 0, failed: attempted };
  }
}

async function markDeliveryFailed(outboxId: string, message: string) {
  await getPool().query(
    `UPDATE crm_delivery_outbox
        SET status = 'failed', last_error = $2, updated_at = now()
      WHERE id = $1::UUID`,
    [outboxId, message.slice(0, 1000)],
  );
}

function ghlConfig(): GhlConfig {
  const token = process.env.GHL_PRIVATE_INTEGRATION_TOKEN?.trim();
  const locationId = process.env.GHL_LOCATION_ID?.trim();
  const linkedinCustomFieldId = process.env.GHL_LINKEDIN_CUSTOM_FIELD_ID?.trim();
  if (!token) throw new Error("GHL_PRIVATE_INTEGRATION_TOKEN is not configured.");
  if (!locationId) throw new Error("GHL_LOCATION_ID is not configured.");
  if (!linkedinCustomFieldId) {
    throw new Error("GHL_LINKEDIN_CUSTOM_FIELD_ID is not configured.");
  }
  if (!/^[A-Za-z0-9]{10,80}$/.test(locationId)) {
    throw new Error("GHL_LOCATION_ID is invalid.");
  }
  if (!/^[A-Za-z0-9]{10,80}$/.test(linkedinCustomFieldId)) {
    throw new Error("GHL_LINKEDIN_CUSTOM_FIELD_ID is invalid.");
  }
  return { token, locationId, linkedinCustomFieldId };
}

function cleanEmail(value: unknown) {
  const email = String(value ?? "").trim().toLowerCase();
  if (!isGhlCompatibleEmail(email)) {
    throw new Error("The saved original email is not valid.");
  }
  return email;
}

function cleanLinkedInUrl(value: unknown) {
  const raw = String(value ?? "").trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("The saved LinkedIn profile URL is not valid.");
  }
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || !/(^|\.)linkedin\.com$/.test(hostname)) {
    throw new Error("The saved LinkedIn profile URL is not valid.");
  }
  url.hash = "";
  url.search = "";
  return url.toString();
}

function cleanNames(firstValue: unknown, lastValue: unknown, fullValue: unknown) {
  let firstName = String(firstValue ?? "").trim();
  let lastName = String(lastValue ?? "").trim();
  const suppliedFullName = String(fullValue ?? "").trim();
  if (!firstName && suppliedFullName) firstName = suppliedFullName.split(/\s+/)[0] ?? "";
  if (!lastName && suppliedFullName) {
    lastName = suppliedFullName.split(/\s+/).slice(1).join(" ");
  }
  const fullName = suppliedFullName || [firstName, lastName].filter(Boolean).join(" ");
  return { firstName, lastName, fullName };
}

function nullableTrimmedString(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function maximumAttemptCount(rows: DeliveryRow[]) {
  return rows.reduce((maximum, row) => {
    const value = Number(row.attempt_count ?? 0);
    return Number.isFinite(value) ? Math.max(maximum, value) : maximum;
  }, 0);
}

function retryDelayFromResponse(response: Response, attempt: number) {
  const retryAfter = Number(response.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(30_000, retryAfter * 1_000);
  }
  return Math.min(10_000, 1_000 * (2 ** attempt));
}

function safeResponseDetail(text: string) {
  if (!text) return "no response detail";
  return text.replace(/\s+/g, " ").slice(0, 300);
}

function errorMessage(error: unknown) {
  return String(error instanceof Error ? error.message : error).slice(0, 1000);
}

function emptyDeliveryResult(): GhlDeliveryResult {
  return {
    attempted: 0,
    sent: 0,
    failed: 0,
    created: 0,
    updated: 0,
    maxAttemptCount: 0,
  };
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
) {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (nextIndex < values.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(values[index]!);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

class GhlApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "GhlApiError";
    this.status = status;
  }
}
