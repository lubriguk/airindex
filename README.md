# AIR / INDEX — Airport Delay Dashboard

AIR / INDEX is a dashboard for exploring **historical flight reliability at 32 U.S. departure airports**. It combines official U.S. Bureau of Transportation Statistics (BTS) on-time performance records with a separate, current Federal Aviation Administration (FAA) airspace-advisory view. You can inspect one airport in detail or compare departure performance across a curated set of hubs and major bases.

The historical charts are about **flights originating at the selected airport**. Their arrival outcomes describe those same flights when they reach their destinations—not all flights arriving at the selected airport. FAA advisories provide operational context, not an explanation of any historical BTS result. This is an analytical dashboard, **not a live flight tracker or a prediction of future delays**.

## Screenshots

These are screenshots of the running app. Flight totals and FAA advisories reflect the data available when the images were captured and may change.

### Airport detail

<a href="docs/screenshots/airport-detail.jpg"><img src="docs/screenshots/airport-detail.jpg" alt="Airport detail view showing the departure-airport and airline controls, BTS coverage, FAA advisories, snapshot metrics, daily and weekday charts, carrier comparison, and arrival outcomes." width="760"></a>

### Compare hubs

<a href="docs/screenshots/compare-hubs.jpg"><img src="docs/screenshots/compare-hubs.jpg" alt="Compare hubs view showing date controls, BTS and FAA status, departure delay rankings, NAS-attributed arrival delay rankings, and the airline-at-its-hubs comparison." width="760"></a>

## What the dashboard does

### Airport detail

1. **Departure airport:** Choose one of 32 supported origin airports. Airport names and cities appear alongside their codes when metadata is available. The supported airport codes are `ATL`, `DFW`, `DEN`, `ORD`, `LAX`, `JFK`, `LGA`, `EWR`, `SFO`, `SEA`, `CLT`, `PHX`, `MIA`, `PHL`, `DCA`, `IAD`, `IAH`, `DTW`, `MSP`, `SLC`, `BOS`, `PDX`, `ANC`, `HNL`, `DAL`, `HOU`, `MDW`, `BWI`, `LAS`, `MCO`, `FLL`, and `SJU`.
2. **Airline selection:** Select one or more BTS *reporting carriers* that have records for the chosen airport and date range. The menu shows full airline names alongside their two-character reporting codes. No selection means all available airlines. Regional operators can report flights flown for another airline's brand, so the reporting carrier is not always the name on a passenger's ticket.
3. **Date range:** Set `From` and `To` within the imported dataset's displayed coverage, or use **All dates**. Date validation prevents an inverted or out-of-coverage range. **Refresh** fetches current dashboard responses; it cannot make BTS publish an unreleased month.
4. **Advanced controls — Filter records:** Add up to 30 rules against the raw daily airport-and-airline metrics listed below. Each rule has **At least**, **At most**, or **Exactly** and a nonnegative whole-number threshold. Multiple rules are combined with **AND**. They select daily airport/carrier aggregate rows *before* those rows are added into any detail chart or summary. Changes remain a draft until **Apply filters** is clicked; selected airlines and applied rules appear as chips.
5. **Advanced controls — Show metrics:** Choose which summary cards are displayed, including the four default indicators and 13 raw metrics. This is a presentation choice, **not** another record filter. Selected raw metrics also gain monthly trend charts. Resetting the metric selection restores the four default cards.
6. **Dataset coverage:** See the BTS source, number of imported flight records, date range, and number of loaded months. Coverage is derived from what has actually been imported, rather than being a promised date range for every airline or airport.
7. **Current airspace advisories:** See the FAA feed's affected-airport count, last check and source-update times, and any current events for the selected airport. Event details can include the advisory type, reason, reported delay text, start/reopen information, and a link to the FAA source. A restriction can apply to only some operations; it does not necessarily mean an airport is closed.

The airport-detail results are:

| View | What it shows |
|---|---|
| **Airport snapshot** | Default cards for on-time departure percentage, number of reported scheduled flights, average departure delay, and cancellation rate. Additional selected raw totals can also appear here. |
| **How the days performed** | An interactive daily trend with on-time departure percentage and average departure delay in minutes on separate scales. It shows reported days only; missing dates are not filled in as zero. Hover or focus a point for its date, values, and flight count. |
| **The weekly rhythm** | On-time departure rate by day of the week, Monday through Sunday, with flight counts available on the chart. |
| **Who operates here** | Reporting carriers at the chosen origin, sorted by departure volume, with full name/code, flight count, on-time rate, and average departure delay. |
| **What happened after takeoff** | Number of flights with reported arrivals, average arrival delay, diverted flights, and BTS-attributed **arrival**-delay minutes for carrier, weather, National Airspace System (NAS), security, and late aircraft. These are not causes assigned to the selected departure airport. |
| **Monthly signals** | Optional monthly totals for each raw metric enabled under **Show metrics**. Each measure has its own scale; months without observations are absent, not zero. |

**Filters do not silently fall back to a broader result.** Airline availability is based on the airport and dates, not advanced record rules. If a selected airline has no flights after an airport/date change, it remains selected and the dashboard explains why there are no matches. Likewise, if a rule eliminates its rows, the charts show a no-match state rather than airport-wide data. **Clear airline selection** is an explicit action that broadens results to all available airlines.

### Compare hubs

This is a separate view with its own date controls, **All dates**, **Refresh**, dataset-coverage display, and FAA advisory summary. Jump links move to each comparison. The airport rankings use **all reporting airlines**, not the airline chosen on the Airport detail screen. The compared airports are a **curated subset** of supported hubs and major bases, not every U.S. airport; `GUM` is excluded because this BTS dataset does not cover it.

| Comparison | What it shows and how to use it |
|---|---|
| **The 15-minute threshold** | Ranks airports by the percentage of reported departure flights that left at least 15 minutes late. Each row includes delayed/departure counts and total reported flights. Sort by highest rate, lowest rate, or airport A–Z; show the first eight or expand the list. Rates sort from underlying counts, not rounded display text. |
| **NAS-attributed minutes** | Compares BTS NAS-attributed **arrival**-delay minutes for flights originating at each airport. Switch between **minutes per arrival** (NAS minutes ÷ flights with reported arrival delay), **total NAS minutes**, and **share of all five attributed cause minutes** (NAS minutes ÷ their combined total). Sort ascending, descending, or A–Z; expand the list and individual rows to see the other measures and denominators. `N/A` means there is no valid denominator. These figures do not establish that the origin airport caused a delay. |
| **One airline. Its hubs.** | Choose a configured reporting carrier and compare **only that carrier's own origin-departure flights** across its curated hubs and major bases. Rows include delayed share, delayed/departure counts, and reported flights, with highest/lowest/A–Z sorting. This lens is distinct from the all-carrier rankings above. The selectable carriers are United, Alaska, Hawaiian, Southwest, JetBlue, Frontier, and Allegiant; Alaska (`AS`) and Hawaiian (`HA`) remain separate reporting codes. A curated shortlist is not an official BTS designation of current hub status. |

## Data sources and what is used

The application retrieves **official public sources directly**. BTS and FAA are separate datasets with different time meanings; no third-party flight-data provider, fabricated flight records, or live flight-position feed is used.

| Source | What the source contains | What this app uses | Update behavior |
|---|---|---|---|
| [BTS Airline On-Time Statistics — Reporting Carrier On-Time Performance](https://www.transtats.bts.gov/ONTIME/) ([field descriptions](https://www.transtats.bts.gov/Fields.asp?gnoyr_VQ=FGJ)) | Public monthly ZIP archives containing CSV records for individual reported flights, with flight date, reporting carrier, origin and destination, scheduled and actual times, cancellation/diversion flags, departure/arrival delays, and BTS arrival-delay attribution fields. The original files contain many more columns than this app keeps. | Selected fields are aggregated by **flight date + origin airport + reporting airline** and stored in PostgreSQL. All historical metrics, charts, carrier breakdowns, and hub rankings come from those aggregates. Import retains flights originating at the 32 supported airports. | BTS publishes after each month ends. On an initially empty database the importer starts with the latest three published months, then reconciles the latest 24; it checks daily at **05:00 UTC** for newly available or previously missed months. Prior imported months remain available. The on-screen coverage is authoritative for currently available data. |
| [FAA National Airspace System Status](https://nasstatus.faa.gov/) ([machine-readable airport-status feed](https://nasstatus.faa.gov/api/airport-status-information)) | Current XML airport/airspace advisories, such as ground stops, ground delays, closures, and arrival/departure restrictions, with FAA update time and explanatory event text. | Successful polls are saved as timestamped snapshots with event records. The dashboard shows affected airports among its supported airports, a selected airport's advisory details, and freshness/status information. The full-feed event count can include other airports. | The API polls at startup and about **every 15 minutes while it is running**. Before a successful poll it reports **unavailable**; when the saved fetch or FAA update is more than **30 minutes old**, it reports **stale** and withholds old events rather than suggesting all-clear. Polling pauses while an autoscale process is asleep. |

BTS monthly archives are downloaded from the official `www.transtats.bts.gov/PREZIP/On_Time_Reporting_Carrier_On_Time_Performance_1987_present_{YYYY}_{M}.zip` archive pattern. The app uses the dataset page above for attribution and source-field definitions. The source can have publication lag and gaps; **date coverage does not imply that every carrier flew from every airport on every date**.

### BTS source fields and stored measures

The importer uses these CSV fields; all other source columns remain in the original BTS files, not in the daily aggregate table. A stored number is a count or summed number of minutes for one airport/carrier/day, **not a flight-level row**.

| BTS CSV field | Stored measure(s) | Meaning in this app |
|---|---|---|
| `FlightDate`, `Origin`, `Reporting_Airline` | `flight_date`, `airport`, `airline` | Date, departure airport, and BTS reporting-carrier code that define a daily aggregate. |
| Source flight rows | `flights` | Number of reported scheduled flight records in the aggregate. |
| `DepDelayMinutes` | `departure_flights`, `total_dep_delay_minutes` | Count of records with a reported departure-delay value and sum of their nonnegative delay minutes. |
| `DepDel15` | `delayed_departures` | Number of departures flagged as delayed **15 minutes or more**. |
| `ArrDelayMinutes` | `arrival_flights`, `total_arr_delay_minutes` | Count of records with a reported arrival-delay value and sum of their nonnegative delay minutes. |
| `Cancelled`, `Diverted` | `cancelled_flights`, `diverted_flights` | Counts of records with the respective outcome flag. |
| `CarrierDelay` | `carrier_delay_minutes` | BTS-attributed arrival-delay minutes assigned to carrier-related causes. |
| `WeatherDelay` | `weather_delay_minutes` | BTS-attributed arrival-delay minutes assigned to weather. |
| `NASDelay` | `nas_delay_minutes` | BTS-attributed arrival-delay minutes assigned to the National Airspace System. |
| `SecurityDelay` | `security_delay_minutes` | BTS-attributed arrival-delay minutes assigned to security. |
| `LateAircraftDelay` | `late_aircraft_delay_minutes` | BTS-attributed arrival-delay minutes assigned to a late arriving aircraft. |

These 13 stored numeric measures—`flights`, `departure_flights`, `arrival_flights`, `delayed_departures`, `cancelled_flights`, `diverted_flights`, the two total-delay-minute fields, and the five cause-minute fields—are the choices for both advanced numeric record rules and optional raw metric displays.

The interface currently maps these BTS reporting codes to display names; the code remains visible so a regional operator is not mistaken for a marketed airline:

| Code | Display name | Code | Display name | Code | Display name |
|---|---|---|---|---|---|
| `9E` | Endeavor Air | `AA` | American Airlines | `AS` | Alaska Airlines |
| `B6` | JetBlue Airways | `DL` | Delta Air Lines | `F9` | Frontier Airlines |
| `G4` | Allegiant Air | `HA` | Hawaiian Airlines | `MQ` | Envoy Air |
| `NK` | Spirit Airlines | `OH` | PSA Airlines | `OO` | SkyWest Airlines |
| `UA` | United Airlines | `WN` | Southwest Airlines | `YX` | Republic Airways |

### How calculated indicators work

| Indicator | Definition and denominator |
|---|---|
| **On-time departures** | `(departure_flights − delayed_departures) ÷ departure_flights × 100`; “on time” means under 15 minutes late. |
| **Delayed departure share** | `delayed_departures ÷ departure_flights × 100`; used in hub/airport delay rankings. |
| **Average departure / arrival delay** | `total_dep_delay_minutes ÷ departure_flights` or `total_arr_delay_minutes ÷ arrival_flights`. Early flights contribute zero nonnegative delay minutes; records missing the corresponding delay value are excluded from that average's denominator. |
| **Cancellation rate** | `cancelled_flights ÷ flights × 100`; the denominator is reported scheduled flight records. |
| **NAS minutes per arrival** | `nas_delay_minutes ÷ arrival_flights` for the comparison's origin-departing flights. |
| **NAS share of attributed causes** | `nas_delay_minutes ÷ (carrier + weather + NAS + security + late-aircraft delay minutes)`. |

Rates and averages require a valid denominator; comparison values without one are shown as `N/A`. **Cause minutes count minutes, not flights**, and the five cause categories need not sum to total arrival delay. A low or high NAS value is not proof that the selected departure airport or an airline was responsible. Cancellation and diversion are distinct outcomes; missing records are not interpreted as zero delay or zero performance.

### FAA advisory fields

Each successful feed poll stores its **fetch time**, any parseable **FAA source-update time**, and a count of events across the **full** feed. Events retain the airport code and event type plus optional FAA-provided **reason**, **average delay**, **maximum delay**, **start**, and **reopen/end** text. The UI displays these fields when available. They are operational statements from the FAA, not linked to individual BTS flights or to the selected historical dates.

## How the data reaches the screens

1. The Java service downloads official BTS monthly ZIP/CSV files, extracts the selected fields, and imports one PostgreSQL daily aggregate per `(flight_date, airport, airline)`. A month is marked imported only after its facts commit successfully; imported months are not replaced by sample data.
2. Separately, the Java service polls the FAA XML feed and saves successful snapshots and their events. A failed poll does not manufacture an empty “all clear” snapshot.
3. The browser requests the Java API. Historical detail endpoints apply airport, date, selected airline(s), and all advanced numeric rules to the **daily aggregates before summing** them. The FAA status endpoint reads the latest successful advisory snapshot instead. Airline names in the UI are display labels for BTS reporting codes, not a separate live airline data feed.

PostgreSQL tables: `airport_delay_daily` holds historical daily facts; `bts_imported_months` records successful month imports; `faa_nas_snapshots` and `faa_nas_events` store FAA poll history. See the [schema and ER diagram](docs/database-schema.md), [BTS field/SQL notes](docs/bts-data.md), and [Java/API operations](docs/java-postgresql.md).

### API overview

The Java API is served under `/api`. Its contract is in [`lib/api-spec/openapi.yaml`](lib/api-spec/openapi.yaml).

| Route | Purpose |
|---|---|
| `/api/healthz` | Service health check. |
| `/api/airports` | Supported airport names/codes for controls and labels. |
| `/api/data-status` | Imported BTS record count, first/last dates, month coverage, source URL, and import status. |
| `/api/nas-status` | Latest FAA snapshot's current/stale/unavailable status and supported-airport advisories. |
| `/api/delays/summary` | Aggregated snapshot indicators for the detail selection. |
| `/api/delays/daily` | Daily aggregates used for the trend and optional monthly signals. |
| `/api/delays/weekday` | Day-of-week aggregates. |
| `/api/delays/carriers` | Reporting-carrier aggregates and available-airline choices. |
| `/api/delays/causes` | Five BTS arrival-delay-cause minute totals. |
| `/api/delays/hub-ranking` | Cross-airport departure and NAS comparison data for the curated shortlist. |
| `/api/delays/hub-airlines` | Configured airline options for the airline-at-hubs lens. |
| `/api/delays/airline-hubs` | One reporting airline's results at its configured hubs and major bases. |

For airport detail, `airport` identifies a supported origin. Optional `from`/`to` use ISO dates; repeatable `airline` values identify reporting-carrier codes; repeatable `metric` rules use `field:gte|lte|eq:nonnegative-integer`. For example, `airport=ATL&airline=WN&metric=flights:gte:100` selects Southwest's ATL daily aggregate rows with at least 100 flights, **not** all ATL flights when Southwest has no matches. Comparison routes use their own date/airline parameters as specified by the API contract.

## Project layout and running it

| Path | Role |
|---|---|
| `artifacts/airport-delay-dashboard/` | Plain HTML/CSS/browser-JavaScript dashboard built with Vite; responsive native SVG charts and UI tests. |
| `artifacts/api-server/java/` | Java API, BTS monthly importer, FAA poller, PostgreSQL queries. |
| `lib/api-spec/openapi.yaml` | API contract. |
| `docs/` | Deeper documentation of source fields, SQL model, schema/diagram, and API operation. |

The workspace uses **Node.js 24, pnpm, Java/Maven, and PostgreSQL**. The API requires `DATABASE_URL` and a `PORT`; the dashboard workflow supplies its own `PORT` and `BASE_PATH`. The application expects its PostgreSQL tables to exist—it does not create them during startup. The FAA setup SQL in `artifacts/api-server/java/db/` is a local/reference schema file, **not** a production migration to run by hand. No BTS or FAA API key is needed for the public source feeds.

On Replit, use the configured **API Server** and **Airport Delay Dashboard** workflows. Useful workspace commands:

```bash
pnpm install
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/airport-delay-dashboard run dev
pnpm --filter @workspace/airport-delay-dashboard run test
pnpm run typecheck
pnpm run build
```

The two development services need their **own configured ports/routing** when run outside the managed workflows. The first BTS import may download large archives in the background; check `/api/data-status` and the dashboard's coverage banner rather than assuming an initially empty database contains demo flights. The Node regression tests cover airline/date/rule query scope; the historical and advisory feeds still depend on their external providers and an available database.

## Interpretation and limitations

- **History versus live context:** BTS performance is monthly historical reporting; FAA advisories are a separately polled operational snapshot. Neither proves what caused a specific flight's delay.
- **Source versus imported history:** BTS's public source series reaches back to 1987, but this app does **not** import every year of that series. Its available months are those successfully loaded into this database; the initial and rolling import windows are described above.
- **Origin-based scope:** Selecting an airport never turns the arrival charts into a report of *all arrivals at that airport*. It keeps the selected origin and follows those flights through arrival.
- **Reporting carriers:** BTS codes identify the carrier that reports/operates a flight, which can differ from the marketed airline. Full names in the interface do not combine different reporting codes.
- **Daily aggregate rules:** Advanced thresholds apply to each airport/carrier/day aggregate before totals are calculated. A rule on `flights` does **not** select individual flights; it selects days and reporting carriers whose aggregate count meets the rule.
- **Incomplete coverage is explicit:** A selected carrier or rule can produce no rows. The dashboard keeps the filter and displays a no-match message instead of silently substituting all airlines. Data gaps are not interpolated.
- **FAA freshness and scope:** FAA advisories can apply to a subset of traffic. When the feed is stale or unavailable, the app does not display old events as if they were current; autoscale sleep pauses background polling.