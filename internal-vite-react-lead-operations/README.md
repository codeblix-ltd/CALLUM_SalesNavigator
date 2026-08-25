# Callum Leads

Callum Leads is a Vite/React lead-operations dashboard with a separate
Manifest V3 Chrome extension for scouts.

- CockroachDB stores the bulk lead inventory, exclusive assignments, scout
  settings, status history, errors, and collected email addresses.
- Convex provides authentication and the extension's authenticated server API.
- The Chrome extension shows each scout only their assigned queue and counts.
- A private VPS gateway runs the official Codex app-server with
  `gpt-5.6-luna` to create reviewable comment drafts from post text.

The browser never receives the CockroachDB connection string, the scout
provisioning key, the gateway secret, or the ChatGPT session tokens.

## Lead email fields

Each canonical `leads` row supports two separate addresses:

- `original_email` is the LinkedIn account/contact-info email collected after
  a connection is accepted.
- `work_email` is the company-domain address found by the separate Callum Work
  Email Finder extension through Mailmeteor.

The schema migration backfills existing assignment emails into
`original_email`. The legacy assignment `email` column remains only as a
compatibility bridge; current lead views and exports use the explicit fields.

## One-time setup

The repository is linked to its existing Convex development deployment.

```powershell
# Only needed when COCKROACH_DATABASE_URL is not already in .env.local:
$env:CRDB_PASSWORD="<CockroachDB SQL password>"

npm run setup:secrets
npx @convex-dev/auth --skip-git-check --web-server-url http://localhost:5173
npm run db:schema
npm run convex:push
npm run extension:config
```

`setup:secrets` generates the server-only scout provisioning key, the gateway
shared secret, and a 32-byte credential-encryption key. It copies only the
secrets Convex needs to the linked deployment.

## Run the Codex gateway on a VPS

The gateway is the one persistent process used by all scouts. Convex calls it;
the extension never connects to it directly.

1. Copy the repository to the VPS.
2. Copy `.env.gateway.example` to `.env.gateway`.
3. Copy `COCKROACH_DATABASE_URL`, `CODEX_GATEWAY_SHARED_SECRET`, and
   `CODEX_AUTH_ENCRYPTION_KEY` from the local `.env.local` into
   `.env.gateway`.
4. Start the container:

```bash
docker compose -f gateway/docker-compose.example.yml up -d --build
```

5. Put Caddy, nginx, or another TLS reverse proxy in front of
   `127.0.0.1:8787`. Only `/healthz` is public; all `/v1/*` routes require the
   shared bearer secret. `gateway/Caddyfile.example` is a minimal Caddy
   configuration; replace its hostname with your VPS domain.
6. Point Convex at that HTTPS address from the local machine:

```powershell
$env:CODEX_GATEWAY_URL="https://codex-gateway.example.com"
npm run setup:secrets
npm run convex:push
```

Open the React admin app, unlock it, choose **Access settings**, and select
**Connect ChatGPT subscription**. The app displays the official OpenAI device
URL and one-time code. After approval, the gateway stores the live Codex
session in its private Docker volume and mirrors an AES-256-GCM encrypted
backup to `codex_gateway_auth` in CockroachDB.

Keep exactly one gateway replica running. Draft requests are intentionally
serialized through that process so one managed ChatGPT session has only one
writer.

## Create scouts

Create accounts individually. Omitting `--password` generates a strong
password and prints it once.

```powershell
npm run scout:create -- --username scout01
npm run scout:create -- --username scout02
```

To choose the initial password:

```powershell
npm run scout:create -- --username scout03 --password "A-Strong-Password-123"
```

## Assign leads

Only a niche and count are required. The command verifies that the username is
an active scout, chooses any currently unassigned leads from the niche, and
reports the number assigned and remaining.

### test account for scout01:
user: scout01
pass: CaGFfSbA2mw5E7poTRwzLuFZgv7

```powershell
npm run leads:assign -- --username scout01 --niche "Institute of Directors" --count 100
npm run leads:assign -- --username scout01 --niche "Institute of Directors" --count 10000
```

`lead_assignments.lead_id` is the primary key. That database constraint is the
final concurrency guard: one lead can never belong to two scouts. Re-running
the command adds more previously unassigned leads without changing earlier
assignments.

## Load the extension

1. Run `npm run extension:config`.
2. Open `chrome://extensions`.
3. Enable Developer mode.
4. Choose **Load unpacked** and select the `chrome-extension` directory.
5. Sign in using a generated scout username and password.

For scouts who cannot use Developer mode while the unlisted Chrome Web Store
release is under review, a signed Windows self-hosted release can be generated:

```powershell
npm run extension:test
npm run extension:selfhost
```

The hosting bundle is written to `self-hosted-extension`. It targets
`https://extensions.codeblix.com/` and contains the install page,
signed CRX, update manifest, scoped Windows policy files, and Apache/Cloudflare
header configurations. The signing key is created once at
`.secrets/callum-scout-selfhost.pem`; it is Git-ignored and must never be
uploaded or committed. See `self-hosted-extension/README.md` for deployment and
update instructions.

The popup shows fresh, engaged, connection-requested, accepted,
email-collected, and failed counts. It also lets a scout:

- configure daily request and engagement limits; Premium scouts can turn unique
  AI connection notes on or off without an account check;
- run the assigned-lead engagement and connection workflow on LinkedIn;
- open LinkedIn's sent-invitations page.

All writes are authenticated and checked against the signed-in scout's own
assignment. Status changes and extension errors are recorded in
`lead_assignment_events`.

## Internal admin analytics

The React dashboard is private. Sign in with the internal administrator
credentials (`callum2024` / `callum2024`) to view lead inventory and scout
analytics. The browser receives an authenticated Convex session; aggregate
counts, per-scout activity, lead details, and Codex gateway controls all verify
the admin role on the server. The former lead access token is no longer used.

The overview includes all-time or 7/30/90-day activity, assigned and fresh
queues, engaged leads, connection requests, pending requests, acceptances,
collected emails, failures, conversion rates, recent events, and searchable
per-scout drill-downs.

Run the extension's deterministic production checks without opening LinkedIn
or making model calls:

```powershell
pnpm extension:test
```

## LinkedIn automation boundary

The extension operates against the visible DOM in the scout's signed-in
LinkedIn tabs and does not call private LinkedIn network endpoints. It verifies
the selected profile and invitation recipient before posting comments or
sending a request. A scout who selects Premium can turn AI invitation notes on
or off directly. When enabled, the note is generated from the current lead’s
visible headline, role, company, location, and About text, then limited to
LinkedIn’s 300-character invitation field. Post engagement checks only the top
three cards and verifies both the visible age and LinkedIn activity timestamp;
anything older than 92 days or without a verifiable date is skipped.

## Import leads

Run the streaming importer once per niche:

```powershell
npm run db:import -- --niche "Institute of Directors" --copy-chunk-size 5000 --defer-search-index "C:\path\to\leads.csv"
```

The importer saves a durable checkpoint after every committed chunk. If the
database connection drops, it retries temporary connection and transaction
errors automatically. If the process still exits, rerun the same command and
it skips all committed rows before continuing. The importer also deduplicates
by normalized LinkedIn URL, so replaying the current chunk is safe.

Fast COPY mode defaults to 5,000 rows per chunk and accepts values from 250 to
20,000. Larger chunks reduce database round trips but need longer transactions.
Use `--force` only when you intentionally want to discard a saved checkpoint
and reimport a completed file from row 1. The retry count defaults to 12 and can
be changed with `--max-retries`.

## Development and verification

```powershell
npm run convex:dev
npm run dev

npx tsc --noEmit
npm run build
npm run check
npm run smoke
```

The admin dashboard uses the fixed internal credentials documented above; no
lead access token is required.
