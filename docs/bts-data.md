# BTS data and SQL model

For a visual overview of the tables and their keys, see the [database schema and ER diagram](./database-schema.md).

## Source and scope

This dashboard imports the official [BTS Airline On-Time Statistics](https://www.transtats.bts.gov/ONTIME/) **Reporting Carrier On-Time Performance (1987–present)** monthly public ZIP/CSV files. No key or third-party intermediary is required. BTS publishes these files after the flight month ends; the dashboard is not a live flight tracker.

Only flights **originating** at the 32 supported airports are included. Arrival-delay and cause figures refer to those flights' arrivals at their destinations, not to flights arriving at the selected airport. On startup, the importer checks the latest available BTS monthly archive and attempts to reconcile a rolling 24-month window ending with that month; while the API is running, it checks again at 05:00 UTC every day, including the 5th of each month. Checking daily also retries a monthly archive if BTS publishes it after the 5th or a prior download fails. Previously imported months remain available.

The source CSV contains many more fields than the dashboard needs, including `Year`, `Quarter`, `Month`, `FlightDate`, reporting carrier, flight number, origin/destination codes and cities, scheduled and actual local departure/arrival times, taxi times, elapsed time, air time, distance, cancellations, diversions, and multiple diversion fields. The import uses these source fields:

| BTS CSV field | Meaning | SQL metric |
|---|---|---|
| `FlightDate` | Local calendar date of the flight | `flight_date` |
| `Origin` | Departure airport IATA code | `airport` |
| `Reporting_Airline` | Operating/reporting carrier code | `airline` |
| `DepDelayMinutes` | Nonnegative departure delay minutes | `total_dep_delay_minutes`, `departure_flights` |
| `DepDel15` | Departure delayed at least 15 minutes | `delayed_departures` |
| `ArrDelayMinutes` | Nonnegative arrival delay minutes | `total_arr_delay_minutes`, `arrival_flights` |
| `Cancelled`, `Diverted` | Canceled or diverted flight flags | `cancelled_flights`, `diverted_flights` |
| `CarrierDelay`, `WeatherDelay`, `NASDelay`, `SecurityDelay`, `LateAircraftDelay` | BTS delay-cause minutes reported for qualifying delayed arrivals | matching `*_delay_minutes` totals |

Missing delay values are excluded from the corresponding average's denominator; they are **not** treated as zero-minute delays. `flights` counts scheduled source records, while `departure_flights` and `arrival_flights` count records with a reported delay value. On-time departure percentage is `(departure_flights - delayed_departures) / departure_flights × 100`; cancellation percentage is `cancelled_flights / flights × 100`. Average delay uses nonnegative BTS delay minutes, so an early departure contributes zero rather than a negative value. Delay causes are BTS-reported attribution minutes, not counts of affected flights.

## SQL tables

- `airport_delay_daily`: primary key `(flight_date, airport, airline)`; daily facts for fast filter/group-by queries. Indexed on `(airport, flight_date)`.
- `bts_imported_months`: a month is recorded only after its facts commit successfully. Check it when a time period appears absent.

The dashboard can filter on one or more reporting airlines and on any numeric
column in `airport_delay_daily`. Multiple metric rules use AND: each
airport/date/airline row must satisfy every rule **before** the API sums matching
rows for the summary, daily chart, carrier comparison, weekday chart, and cause
totals. For example, `metric=flights:gte:100&metric=cancelled_flights:lte:5`
keeps only daily airline aggregates with at least 100 flights and at most five
cancellations. Selecting which summary cards to show is separate and does not
change these calculations.

The underlying data can be queried directly in the database pane or with any PostgreSQL client. Examples:

```sql
-- Daily ATL departures and 15-minute delay rate for a date range
SELECT flight_date,
       SUM(flights) AS flights,
       SUM(delayed_departures) AS delayed_departures,
       ROUND(100.0 * SUM(delayed_departures)
             / NULLIF(SUM(departure_flights), 0), 1) AS delayed_pct
FROM airport_delay_daily
WHERE airport = 'ATL'
  AND flight_date BETWEEN DATE '2026-04-01' AND DATE '2026-06-30'
GROUP BY flight_date
ORDER BY flight_date;

-- Airlines with the most departing flights at LAX
SELECT airline,
       SUM(flights) AS flights,
       ROUND(SUM(total_dep_delay_minutes)::numeric
             / NULLIF(SUM(departure_flights), 0), 1) AS avg_delay_minutes
FROM airport_delay_daily
WHERE airport = 'LAX'
GROUP BY airline
ORDER BY flights DESC;

-- Check the imported source months
SELECT month, flight_count, imported_at
FROM bts_imported_months
ORDER BY month DESC;
```

For flight-level research beyond these aggregated fields, consult the linked BTS CSV files directly.