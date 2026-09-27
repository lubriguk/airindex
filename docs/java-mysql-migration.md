# Java + MySQL conversion

The React/JavaScript dashboard already uses the `/api` contract. A Java 17+ implementation of that API and the BTS importer lives in `artifacts/api-server/java/`. The existing Node/PostgreSQL API remains the live service **until an external MySQL database is connected, the historical data is copied and verified, and the managed API workflow is switched**. No PostgreSQL data is deleted by the migration.

## Set up a MySQL database

Replit's managed database is PostgreSQL; use an external **MySQL** service for this version. For example, [Aiven's MySQL setup guide](https://aiven.io/docs/products/mysql/get-started) walks through creating a service and finding its connection information. Choose a service capacity sufficient for at least 208,451 aggregate rows, and ensure it accepts connections from the app. The database user needs permission to create tables and insert/select data. Create a dedicated database or use the provider's default database.

Once the service is running, add these **Replit Secrets**, not values in code or chat:

| Secret | Value |
|---|---|
| `MYSQL_JDBC_URL` | `jdbc:mysql://HOST:PORT/DATABASE?sslMode=VERIFY_IDENTITY&connectionTimeZone=UTC` (replace host, port and database) |
| `MYSQL_USER` | The MySQL database username |
| `MYSQL_PASSWORD` | The MySQL database password |

Configure the provider's CA certificate in Java's trust store if it is not already trusted. Remote connections without `sslMode=VERIFY_IDENTITY` are rejected at startup; `REQUIRED` encrypts but does not verify the server identity. The existing Replit-managed `DATABASE_URL` is used **only as the PostgreSQL source** for the one-time copy. Do not overwrite it.

## Migrate and cut over

1. Build the Java server: `pnpm --filter @workspace/api-server run java:build`.
2. Copy the historical facts and month markers: `pnpm --filter @workspace/api-server run java:migrate`. This creates MySQL tables if absent and copies each month in its own transaction, verifies every aggregate row and month marker, and can be rerun without duplicating records. It does not delete PostgreSQL data. If the PostgreSQL importer adds a new month during the copy, rerun migration to catch up before cutover.
3. Verify on MySQL: `SELECT COUNT(*) AS months, SUM(flight_count) AS flights FROM bts_imported_months;` and `SELECT COUNT(*) AS rows, SUM(flights) AS flights FROM airport_delay_daily;`. For the existing August 2024–July 2026 dataset, expect 24 months, 208,451 rows and 8,970,731 flights (plus any newly published months imported since then).
4. Before switching the live service, start Java separately with `PORT` set to an available port and `pnpm --filter @workspace/api-server run java:start`. Compare its `/api/data-status`, `/api/airports` and `/api/delays/*` responses with the Node API for the same airport/date range.
5. Only after parity checks pass, change the **existing** API artifact's managed workflow from `pnpm --filter @workspace/api-server run dev` to the Java start command with a build step. Keep the PostgreSQL copy until the new app is verified and you decide whether to retire it.

The Java API responds on the same `/api` paths and JSON shapes, so the frontend needs no API changes. On startup and daily thereafter, the Java importer reconciles the latest 24 published BTS months, retries any missing month, and retains older imported months.