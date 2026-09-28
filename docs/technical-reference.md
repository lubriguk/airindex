# AIR / INDEX — technical reference

This document holds the detailed dashboard behavior and implementation notes behind the shorter [project README](../README.md). For a closer look at the source data and SQL model, see [BTS data and SQL](bts-data.md), the [database schema and diagram](database-schema.md), and [Java/API operations](java-postgresql.md).

## Scope and data sources

Historical results follow **flights originating at one of 32 supported airports**: `ATL`, `DFW`, `DEN`, `ORD`, `LAX`, `JFK`, `LGA`, `EWR`, `SFO`, `SEA`, `CLT`, `PHX`, `MIA`, `PHL`, `DCA`, `IAD`, `IAH`, `DTW`, `MSP`, `SLC`, `BOS`, `PDX`, `ANC`, `HNL`, `DAL`, `HOU`, `MDW`, `BWI`, `LAS`, `MCO`, `FLL`, and `SJU`. Arrival outcomes refer to those departures when they reach their destinations, **not** to all flights arriving at the origin airport.

The importer downloads the official [BTS Reporting Carrier On-Time Performance](https://www.transtats.bts.gov/ONTIME/) monthly ZIP/CSV files from `https://www.transtats.bts.gov/PREZIP/On_Time_Reporting_Carrier_On_Time_Performance_1987_present_{YYYY}_{M}.zip`. Source records include flight date, carrier, origin and destination, scheduled and actual times, cancellation and diversion flags, delays, and arrival-delay causes. Only selected fields are imported; many other source columns remain in the original BTS files. The source series extends back to 1987, **but this app does not import the entire series**. On startup and at **05:00 UTC daily** while the service runs, it checks for the latest published month and reconciles a rolling 24-month window, retrying months that were missed or failed. This schedule includes the 5th of each month but is not limited to that date. Previously imported months remain available. The coverage shown in the dashboard reflects successful imports, not a guarantee that every carrier operated at every airport on every covered date. [BTS field definitions](https://www.transtats.bts.gov/Fields.asp?gnoyr_VQ=FGJ).

Separately, the Java service polls the [FAA NAS Status XML feed](https://nasstatus.faa.gov/api/airport-status-information) at startup and approximately every **15 minutes while running**. The feed contains current airport and airspace advisories, including ground stops, ground delays, closures, and arrival/departure restrictions. Successful polls become timestamped database snapshots with event records. No successful poll means **unavailable**; a saved fetch or parseable FAA source update more than **30 minutes old** means **stale**, with old events withheld. A failed poll does not create an empty “all clear” snapshot. An autoscale process cannot poll while asleep. Advisories are operational context, not live flight positions or evidence about a specific historical BTS flight.

## Airport detail: controls and views

- **Departure airport and airline:** Airport names/cities accompany codes when metadata is available. Choose one or more BTS reporting carriers available for the airport and date range; no airline selection means all available airlines. A reporting carrier can be a regional operator flying for another brand. Airline availability is determined by airport and dates, not by advanced record rules.
- **Dates and refresh:** Set `From` and `To` within the imported coverage, use **All dates**, or use **Refresh** to refetch dashboard responses. Validation prevents an inverted or out-of-coverage range; Refresh does not cause an unreleased BTS month to appear.
- **Filter records:** Add up to **30** rules, each using **At least**, **At most**, or **Exactly** against a nonnegative whole-number threshold on a stored daily numeric measure. Rules combine with **AND** and apply to each airport/carrier/day row **before** rows are summed. Edits are drafts until **Apply filters**; applied airline/rule selections appear as chips.
- **Show metrics:** Select which summary cards appear from the four default indicators and the 13 stored raw measures. This changes the display, **not** which records qualify. Chosen raw metrics also get monthly total charts. Reset returns the four default cards.
- **No-match behavior:** A chosen airline stays chosen even if a new airport/date/rule selection has no matching rows. The dashboard explains the lack of matches rather than reverting to all airlines or airport-wide data. **Clear airline selection** explicitly broadens the result. Missing dates/months are not invented as zeros.
- **Dataset and FAA panels:** BTS provenance, imported flight count, covered dates, and loaded months appear alongside the FAA affected-airport count, last check, source-update time, and current selected-airport events. Event details and the FAA source link appear when available. A restriction may apply only to certain traffic; it need not mean a full airport closure.

| Result | Detail |
|---|---|
| **Airport snapshot** | On-time departure percentage, reported scheduled flights, average departure delay, and cancellation rate by default; optional raw totals can be added. |
| **How the days performed** | Daily on-time share and average departure delay in minutes on separate scales; reported days only, with date, values, and flight count on hover/focus. |
| **The weekly rhythm** | Monday–Sunday on-time departure shares with underlying flight counts available on the chart. |
| **Who operates here** | Reporting carriers at the origin, sorted by departure volume, with full name/code, flight count, on-time share, and average departure delay. |
| **What happened after takeoff** | Reported arrival count, average arrival delay, diverted flights, and carrier/weather/NAS/security/late-aircraft **arrival**-delay minutes for those origin-departing flights. |
| **Monthly signals** | Optional monthly totals for selected raw measures; each uses its own scale, and unobserved months are omitted. |

The interface currently labels these BTS reporting codes; the code stays visible so a regional operator is not confused with the brand on a ticket:

| Code | Name | Code | Name | Code | Name |
|---|---|---|---|---|---|
| `9E` | Endeavor Air | `AA` | American Airlines | `AS` | Alaska Airlines |
| `B6` | JetBlue Airways | `DL` | Delta Air Lines | `F9` | Frontier Airlines |
| `G4` | Allegiant Air | `HA` | Hawaiian Airlines | `MQ` | Envoy Air |
| `NK` | Spirit Airlines | `OH` | PSA Airlines | `OO` | SkyWest Airlines |
| `UA` | United Airlines | `WN` | Southwest Airlines | `YX` | Republic Airways |

## Compare hubs: controls and measures

This separate screen has its own date controls, **All dates**, **Refresh**, coverage display, and FAA summary. Jump links take you to its three comparisons. The airport rankings use **all reporting airlines** and a curated subset of supported hubs and major bases, not every U.S. airport; `GUM` is excluded because the imported BTS dataset does not cover it. The shortlists are **not official BTS designations of current hubs**.

| Comparison | Behavior |
|---|---|
| **The 15-minute threshold** | Delayed departure share by origin, with delayed/departure counts and total reported flights. Sort high, low, or airport A–Z. The first eight show by default; expand to see the full list. Sorting uses underlying counts, not rounded labels. |
| **NAS-attributed minutes** | BTS NAS-attributed **arrival** minutes for flights leaving each origin. Switch between minutes per arrival (`NAS minutes / arrival_flights`), total NAS minutes, and NAS share of all five attributed cause minutes. Sort high, low, or A–Z; expand the list or a row to see other measures and denominators. No valid denominator is `N/A`; the origin airport is not thereby assigned responsibility. |
| **One airline. Its hubs.** | Only the chosen reporting carrier's own origin-departure flights at its configured hubs and major bases. View delayed share, delayed/departure counts, and total flights; sort high, low, or A–Z. Configured carriers: United, Alaska, Hawaiian, Southwest, JetBlue, Frontier, and Allegiant. `AS` and `HA` remain separate reporting codes. |

## Stored BTS fields and interpretation

The Java importer retains one PostgreSQL aggregate per `(flight_date, airport, airline)`, not one row per flight. The complete source-to-SQL mapping and example queries are in [BTS data and SQL](bts-data.md). Its 13 numeric measures are:

- **Counts:** `flights` (retained scheduled flight records); `departure_flights` and `arrival_flights` (records with reported delay values); `delayed_departures` (`DepDel15`, at least 15 minutes late); `cancelled_flights`; `diverted_flights`.
- **Nonnegative minute sums:** `total_dep_delay_minutes` (`DepDelayMinutes`), `total_arr_delay_minutes` (`ArrDelayMinutes`), and `carrier_delay_minutes`, `weather_delay_minutes`, `nas_delay_minutes`, `security_delay_minutes`, `late_aircraft_delay_minutes` from BTS's corresponding arrival-delay attribution columns.

Missing departure/arrival delay values do **not** count as zero-minute flights in averages. Early flights contribute zero nonnegative delay minutes. These 13 measures can be displayed as raw totals or used for record rules. For example, `flights >= 100` selects airport/carrier/**day aggregates** with at least 100 reported flights, not 100 individual source flight rows.

| Calculated indicator | Definition |
|---|---|
| On-time departures | `(departure_flights - delayed_departures) / departure_flights × 100`; under 15 minutes late. |
| Delayed departure share | `delayed_departures / departure_flights × 100`. |
| Average departure / arrival delay | `total_dep_delay_minutes / departure_flights` or `total_arr_delay_minutes / arrival_flights`. |
| Cancellation rate | `cancelled_flights / flights × 100`. |
| NAS minutes per arrival | `nas_delay_minutes / arrival_flights` for flights departing the compared origin. |
| NAS share of attributed causes | `nas_delay_minutes / (carrier + weather + NAS + security + late-aircraft delay minutes) × 100`. |

These rates require a nonzero denominator. Cause minutes count **minutes, not affected flights**, and the five cause fields need not equal every minute of total arrival delay. The BTS fields do not identify the cause of each cancelled flight or prove the selected departure airport was responsible for an arrival delay. Cancellation and diversion are separate outcomes.

Each successful FAA poll stores its fetch time, any parseable FAA source-update time, and the full-feed event count (which may include airports outside the app). Events retain airport code, type, and optional FAA-provided reason, average/maximum delay, start, and reopen/end text. These are not linked to BTS flights or to historical date filters.

## Data flow and API

The Java service imports BTS monthly ZIP/CSV archives into `airport_delay_daily`; `bts_imported_months` marks a month only after its facts commit successfully. FAA observations go into `faa_nas_snapshots` and `faa_nas_events`. The browser requests the Java API; historical queries apply airport, date, airline, and advanced rules to daily rows before aggregating. The FAA status route reads the latest successful snapshot. See the [database schema](database-schema.md) and [OpenAPI contract](../lib/api-spec/openapi.yaml).

| Java route under `/api` | Purpose |
|---|---|
| `/healthz` | Service health check. |
| `/airports` | Supported airport names/codes. |
| `/data-status` | Imported BTS records, date/month coverage, source, and import status. |
| `/nas-status` | Latest current/stale/unavailable FAA status and supported-airport advisories. |
| `/delays/summary` | Aggregated snapshot indicators. |
| `/delays/daily` | Daily results for the trend and optional monthly signals. |
| `/delays/weekday` | Day-of-week aggregates. |
| `/delays/carriers` | Reporting-carrier aggregates and airline choices. |
| `/delays/causes` | Five arrival-delay-cause totals. |
| `/delays/hub-ranking` | Cross-airport departure and NAS comparison. |
| `/delays/hub-airlines` | Configured airline options for the airline-at-hubs lens. |
| `/delays/airline-hubs` | One carrier's results at its configured hubs/bases. |

For detail requests, `airport` is a supported origin; `from`/`to` are optional ISO dates; repeatable `airline` parameters are BTS reporting codes; repeatable `metric` rules use `field:gte|lte|eq:nonnegative-integer`. For example, `airport=ATL&airline=WN&metric=flights:gte:100` returns only Southwest ATL daily aggregates meeting that threshold—never a fallback to all ATL flights. Comparison routes use their own date/airline parameters as specified by OpenAPI.

## Project layout and local operation

| Path | Role |
|---|---|
| `artifacts/airport-delay-dashboard/` | HTML/CSS/browser-JavaScript dashboard built with Vite, native SVG charts, and UI tests. |
| `artifacts/api-server/java/` | Java API, BTS importer, FAA poller, and PostgreSQL queries. |
| `lib/api-spec/openapi.yaml` | API contract. |
| `docs/` | Source, schema, API, and interpretation documentation. |

The workspace uses Node.js 24, pnpm, Java/Maven, and PostgreSQL. The API needs `DATABASE_URL` and a `PORT`; the dashboard workflow supplies its `PORT` and `BASE_PATH`. Existing PostgreSQL tables are required at startup; the app does **not** create them then. The FAA SQL in `artifacts/api-server/java/db/` is a local/reference schema file, not a production migration to execute manually. The public BTS/FAA feeds need no API key.

Use the configured **API Server** and **Airport Delay Dashboard** workflows on Replit. Useful workspace commands:

```bash
pnpm install
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/airport-delay-dashboard run dev
pnpm --filter @workspace/airport-delay-dashboard run test
pnpm run typecheck
pnpm run build
```

Outside the managed workflows, the two services need separate ports and routing. The first BTS import can download large archives asynchronously; inspect `/api/data-status` rather than assuming demo data. The Node regression tests cover airline/date/rule query scope. Availability of real historical and advisory results still depends on the external feeds and database.

## Interpretation limits

Historical BTS reporting and current FAA advisories are separate; neither proves why any individual flight was delayed. BTS's public series goes back to 1987, but only successfully imported months appear here. Regional reporting carriers can differ from marketed brands. Advanced numeric rules act on daily carrier aggregates before totals are computed, and a no-match result is never silently broadened. Gaps are not interpolated. A stale or unavailable FAA snapshot does not mean “all clear,” and polling pauses if an autoscale process sleeps.