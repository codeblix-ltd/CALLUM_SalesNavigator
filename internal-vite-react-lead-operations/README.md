# Callum Leads

Callum Leads is a Vite/React lead-operations dashboard with a separate
Manifest V3 Chrome extension for scouts.

- CockroachDB stores the bulk lead inventory, exclusive assignments, scout
  settings, status history, errors, and collected email addresses.
- Convex provides authentication and the extension's authenticated server API.
- The Chrome extension shows each scout only their assigned queue and counts.
- OpenAI's Responses API with `gpt-5.6-luna` creates reviewable comment drafts
  from post text.

The browser never receives the CockroachDB connection string, the scout
provisioning key, or the OpenAI API key.

## One-time setup

The repository is linked to its existing Convex development deployment.

```powershell
# Only needed when COCKROACH_DATABASE_URL is not already in .env.local:
$env:CRDB_PASSWORD="<CockroachDB SQL password>"

# Optional, required for GPT comment drafts:
$env:OPENAI_API_KEY="<OpenAI API key>"

npm run setup:secrets
npx @convex-dev/auth --skip-git-check --web-server-url http://localhost:5173
npm run db:schema
npm run convex:push
npm run extension:config
```

`setup:secrets` generates the server-only scout provisioning key and copies
the configured secrets to Convex. A ChatGPT subscription is not an API
credential; comment drafting requires a platform API key.

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
