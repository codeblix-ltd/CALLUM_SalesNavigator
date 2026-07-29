# Callum Leads

A Vite React lead operations dashboard and separate Manifest V3 Chrome extension.
Convex is the public API/orchestration layer; CockroachDB is the bulk lead store.
The design is intended for 900k+ Sales Navigator leads without copying them into
Convex.

## Architecture

```text
CSV exports ──streaming importer──> CockroachDB
                                      ▲
                                      │ server-only PostgreSQL connection
React dashboard ──Convex action────> Convex
Chrome extension ──HTTP stats──────> Convex
```

- CockroachDB stores normalized lead records, niche membership, import history,
  future operator assignments, and fast aggregate counts.
- Convex actions enforce access and perform paginated SQL queries.
- The browser never receives the CockroachDB password or connection string.
- The extension exposes only aggregate lead totals. Lead details require the
  generated access token.

## One-time setup

The project is linked to the `ethan-parker/callum-salesnavigator` Convex
development deployment.

```powershell
$env:CRDB_PASSWORD="<your CockroachDB SQL password>"
npm run setup:secrets
npm run db:schema
npm run convex:push
npm run extension:config
```

`setup:secrets` generates a strong lead-access token, saves server secrets in the
gitignored `.env.local`, and sets the same secrets on the linked Convex
deployment.

To rotate only the generated lead token while preserving the same database
connection:

```powershell
$env:CRDB_PASSWORD="<your CockroachDB SQL password>"
$env:ROTATE_LEADS_API_TOKEN="1"
npm run setup:secrets
```

## Import one or more merged CSV files

Run the import once for each niche. It streams the input in bounded batches and
deduplicates by normalized LinkedIn URL:

```powershell
npm run db:import -- --niche "Medical devices" "C:\exports\medical-1.csv" "C:\exports\medical-2.csv"
```

## Reset DB

```powershell
npm run db:reset
```

Useful options:

- `--batch-size 200` controls SQL transaction size (25–500).
- `--force` reprocesses a file that was already completed.
- Interrupted imports can safely be rerun; lead and niche writes are idempotent.

The expected CSV columns match the existing TotLeads scraper export.

## Run the dashboard

```powershell
npm run convex:dev
npm run dev
```

Open the Vite URL, then paste `LEADS_API_TOKEN` from `.env.local` into the unlock
screen. The token stays in that browser's local storage.

## Load the Chrome extension

1. Run `npm run extension:config`.
2. Open `chrome://extensions`.
3. Enable Developer mode.
4. Select **Load unpacked** and choose the `chrome-extension` folder.

The popup and action badge refresh the aggregate lead count from Convex every
30 minutes. The extension intentionally has no LinkedIn automation in this first
milestone.

## Future operator workflow

`lead_assignments` already models one lead assigned to one operator with indexed
per-operator queues. The next milestone should add real operator authentication
and allocation rules before any LinkedIn engagement behavior is introduced.
