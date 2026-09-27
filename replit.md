# Airport Delay Dashboard

Explore official BTS flight delay trends for 32 U.S. departure airports using a queryable PostgreSQL dataset.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (through its managed workflow)
- `pnpm --filter @workspace/airport-delay-dashboard run dev` — run the dashboard (through its managed workflow)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/airport-delay-dashboard/` — React dashboard, charts, airport/date controls
- `artifacts/api-server/src/routes/airport-delays.ts` — parameterized SQL analytics API
- `artifacts/api-server/src/lib/bts-import.ts` — official BTS ZIP ingestion
- `lib/db/src/schema/airport-delays.ts` — SQL fact and import-coverage tables
- `lib/api-spec/openapi.yaml` — API contract; run codegen after changes
- `docs/bts-data.md` — source fields, metric definitions, and example SQL

## Architecture decisions

- Use BTS Reporting Carrier On-Time Performance monthly ZIPs rather than a third-party dataset. They are public and need no API key.
- Store daily airport/carrier aggregates in PostgreSQL rather than millions of individual flight rows. This keeps chart queries fast while preserving the metrics used by this dashboard.
- An airport selects **originating flights**. Departure metrics describe that airport; arrival metrics and BTS cause attribution describe those flights at their destinations.
- On API startup and daily thereafter, check the latest published month and import the three most recently released months that are not yet loaded. Previously imported months remain available.

## Product

Select one of 32 airports to compare daily reliability, airline performance, weekday patterns, delay causes, and cancellation rates. Coverage and source attribution are visible; no invented flights are used.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- BTS files are monthly and released with a lag; this is historical analysis, not a live flight-status feed.
- First run downloads and aggregates large archives in the background. `/api/data-status` reports `importing` and loaded months; do not treat an initially empty database as sample data.
- The SQL fact table contains aggregated metrics, not every flight or every field in the source CSV.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
