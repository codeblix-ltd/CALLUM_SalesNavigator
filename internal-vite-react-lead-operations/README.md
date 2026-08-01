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

The popup shows fresh, engaged, connection-requested, accepted,
email-collected, and failed counts. It also lets a scout:

- open the next assigned profile;
- save manually confirmed engagement/request/acceptance stages;
- open LinkedIn's sent-invitations and contact-info pages;
- save a manually observed email address;
- configure engagement count, pacing, connection delay, and note preference;
- paste post text, generate a `gpt-5.6-luna` draft, review it, and copy it.

All writes are authenticated and checked against the signed-in scout's own
assignment. Status changes and extension errors are recorded in
`lead_assignment_events`.

## Run the automatic mock simulator

The signed-in extension popup includes **Automatic simulation**. Choose a
batch size from 1 to 10 and select **Run simulation**. The extension opens its
own mock LinkedIn page and automatically completes the whole fixture workflow:

- render and visit a local fixture profile;
- read the configured number of fixture posts;
- ask the connected `gpt-5.6-luna` gateway for each fixture comment;
- react and post those comments into the local DOM;
- send and accept a simulated invitation;
- open the fixture contact-info overlay and extract its `.simulated.example`
  email address;
- record every simulated status or error in CockroachDB.

Simulation uses assigned lead names, titles, and companies only to seed the
fixtures. Its state is stored separately in `lead_simulation_runs` and
`lead_simulation_events`; it never changes `lead_assignments`, real lifecycle
timestamps, or collected lead emails. Timers are compressed to keep a test run
short. Reload the unpacked extension after pulling simulator changes.

Run the deterministic workflow and safety checks without making model calls:

```powershell
npm run extension:simulator:test
```

## LinkedIn safety boundary

The extension intentionally does not scrape LinkedIn, call private LinkedIn
network endpoints, auto-scroll result pages, or automatically like, comment,
send invitations, detect acceptances, or extract contact details. Those steps
remain human-confirmed because LinkedIn prohibits third-party software that
scrapes or automates activity on its service.

## Import leads

Run the streaming importer once per niche:

```powershell
npm run db:import -- --niche "Institute of Directors" --copy-chunk-size 2000 --defer-search-index "C:\path\to\leads.csv"
```

The importer deduplicates by normalized LinkedIn URL and can safely be rerun
after an interruption.

## Development and verification

```powershell
npm run convex:dev
npm run dev

npx tsc --noEmit
npm run build
npm run check
npm run smoke
```

The existing React admin dashboard continues to use `LEADS_API_TOKEN` from
`.env.local` for its unlock screen.
