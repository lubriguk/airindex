# Airport Delay Dashboard

Explore official BTS flight delay trends for 32 U.S. departure airports using a queryable PostgreSQL dataset.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (through its managed workflow)
- `pnpm --filter @workspace/airport-delay-dashboard run dev` — run the dashboard (through its managed workflow)
- `pnpm run typecheck` — syntax-check the dashboard JavaScript
- `pnpm run build` — build the Java API and dashboard
- Required env: `DATABASE_URL` — Postgres connection string
- The live dashboard uses plain HTML, CSS and browser JavaScript with a Java API backed by the existing PostgreSQL BTS tables. See `docs/java-postgresql.md` for run commands and backend context.

## Stack

- pnpm workspaces and Node.js 24 for the Vite dashboard
- API: Java and Maven
- Data: PostgreSQL BTS aggregates and FAA NAS Status snapshots
- Dashboard: plain HTML, CSS and browser JavaScript

## Where things live

- `artifacts/airport-delay-dashboard/` — vanilla JavaScript dashboard, native SVG charts, airport/date controls
- `artifacts/api-server/java/` — Java analytics, official BTS ZIP ingestion, and FAA NAS Status polling
- `lib/api-spec/openapi.yaml` — API contract
- `docs/bts-data.md` — source fields, metric definitions, and example SQL
- `docs/database-schema.md` and `docs/er-diagram.svg` — database schema and ER diagram

## Architecture decisions

- Use BTS Reporting Carrier On-Time Performance monthly ZIPs rather than a third-party dataset. They are public and need no API key.
- Store daily airport/carrier aggregates in PostgreSQL rather than millions of individual flight rows. This keeps chart queries fast while preserving the metrics used by this dashboard.
- Reconcile missing published BTS months on startup and daily at 05:00 UTC. The daily check guarantees a run every fifth and retries when BTS publishes late; imports are transactional and retain prior months.
- Fetch the official FAA NAS Status XML feed at startup and every 15 minutes while the API process is running. Store successful snapshots and event rows separately from BTS history.
- An airport selects **originating flights**. Departure metrics describe that airport; arrival metrics and BTS cause attribution describe those flights at their destinations.

## Product

Select one of 32 airports to compare daily reliability, airline performance, weekday patterns, delay causes, and cancellation rates. Coverage and source attribution are visible; no invented flights are used.
Compare hubs also shows all-carrier airport rankings and each reporting airline's departure performance across its configured hubs and major bases.

## Repository scope

- Keep GitHub `main` limited to the active dashboard, Java API, and relevant operation/configuration files. Do not commit unused TypeScript/Node stacks or separate design previews.

## Gotchas

- BTS files are monthly and released with a lag; this is historical analysis, not a live flight-status feed.
- First run downloads and aggregates large archives in the background. `/api/data-status` reports `importing` and loaded months; do not treat an initially empty database as sample data.
- FAA data is a live advisory feed, not a flight-history table. After 30 minutes without a fresh poll or FAA source update, the API marks status `stale` and withholds old events rather than reporting an all-clear. In an autoscale deployment that scales to zero, polling pauses while the process is stopped.
- The SQL fact table contains aggregated metrics, not every flight or every field in the source CSV.

## Pointers

- See `docs/java-postgresql.md` for the Java API and database details
