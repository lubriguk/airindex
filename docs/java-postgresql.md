# Java API and existing PostgreSQL data

The Airport Delay Dashboard uses plain HTML, CSS, and browser JavaScript, the existing `/api` response contract, and Replit-managed PostgreSQL. The Java service under `artifacts/api-server/java/` replaces the Node API. No MySQL account, database migration, or new database schema is needed.

The Java service reads `DATABASE_URL` and checks that the existing `airport_delay_daily` and `bts_imported_months` tables are present; startup does not modify them. The BTS sync checks for missing months across a rolling 24-month window on startup and daily, then imports missing months transactionally into those same tables. Historical month markers keep prior imports from being repeated.

The API artifact's development workflow runs `pnpm --filter @workspace/api-server run dev`, which builds and starts Java. Its production build and run settings likewise use the shaded Java jar. Run `pnpm --filter @workspace/api-server run java:build` to build independently. The Java service is the only API implementation in the project.

The vanilla JavaScript frontend in `artifacts/airport-delay-dashboard/` requests the same airports, status, summary, daily, carrier, cause and weekday routes and renders the charts with native SVG.