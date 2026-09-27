# Java API and existing PostgreSQL data

The Airport Delay Dashboard keeps its existing React frontend, `/api` response contract, and Replit-managed PostgreSQL database. The Java service under `artifacts/api-server/java/` replaces the Node API. No MySQL account, database migration, or new database schema is needed.

The Java service reads `DATABASE_URL` and checks that the existing `airport_delay_daily` and `bts_imported_months` tables are present; startup does not modify them. The BTS sync checks for missing months across a rolling 24-month window on startup and daily, then imports missing months transactionally into those same tables. Historical month markers keep prior imports from being repeated.

The API artifact's development workflow runs `pnpm --filter @workspace/api-server run dev`, which builds and starts Java. Its production build and run settings likewise use the shaded Java jar. Run `pnpm --filter @workspace/api-server run java:build` to build independently. The old Node implementation remains in the repository with `legacy:build` and `legacy:start` commands as a rollback reference, but is not the configured service.

The existing React app uses relative `/api` requests; it requires no frontend code changes. The Java API serves the same airports, status, summary, daily, carrier, cause and weekday routes.