import { Router, type IRouter, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import {
  ListAirportsResponse,
  GetDataStatusResponse,
  GetDelaySummaryQueryParams,
  GetDelaySummaryResponse,
  GetDailyDelaysQueryParams,
  GetDailyDelaysResponse,
  GetCarrierDelaysQueryParams,
  GetCarrierDelaysResponse,
  GetDelayCausesQueryParams,
  GetDelayCausesResponse,
  GetWeekdayDelaysQueryParams,
  GetWeekdayDelaysResponse,
} from "@workspace/api-zod";
import { BTS_SOURCE_URL, isBtsImporting } from "../lib/bts-import";

const router: IRouter = Router();

const airports = [
  ["ATL", "Hartsfield–Jackson Atlanta International", "Atlanta, GA"],
  ["DFW", "Dallas Fort Worth International", "Dallas–Fort Worth, TX"],
  ["DEN", "Denver International", "Denver, CO"],
  ["ORD", "O'Hare International", "Chicago, IL"],
  ["LAX", "Los Angeles International", "Los Angeles, CA"],
  ["JFK", "John F. Kennedy International", "New York, NY"],
  ["LGA", "LaGuardia", "New York, NY"],
  ["EWR", "Newark Liberty International", "Newark, NJ"],
  ["SFO", "San Francisco International", "San Francisco, CA"],
  ["SEA", "Seattle–Tacoma International", "Seattle, WA"],
  ["CLT", "Charlotte Douglas International", "Charlotte, NC"],
  ["PHX", "Phoenix Sky Harbor International", "Phoenix, AZ"],
  ["MIA", "Miami International", "Miami, FL"],
  ["PHL", "Philadelphia International", "Philadelphia, PA"],
  ["DCA", "Ronald Reagan Washington National", "Washington, DC"],
  ["IAD", "Washington Dulles International", "Washington, DC"],
  ["IAH", "George Bush Intercontinental", "Houston, TX"],
  ["DTW", "Detroit Metropolitan", "Detroit, MI"],
  ["MSP", "Minneapolis–Saint Paul International", "Minneapolis, MN"],
  ["SLC", "Salt Lake City International", "Salt Lake City, UT"],
  ["BOS", "Logan International", "Boston, MA"],
  ["PDX", "Portland International", "Portland, OR"],
  ["ANC", "Ted Stevens Anchorage International", "Anchorage, AK"],
  ["HNL", "Daniel K. Inouye International", "Honolulu, HI"],
  ["DAL", "Dallas Love Field", "Dallas, TX"],
  ["HOU", "William P. Hobby", "Houston, TX"],
  ["MDW", "Chicago Midway International", "Chicago, IL"],
  ["BWI", "Baltimore/Washington International", "Baltimore, MD"],
  ["LAS", "Harry Reid International", "Las Vegas, NV"],
  ["MCO", "Orlando International", "Orlando, FL"],
  ["FLL", "Fort Lauderdale–Hollywood International", "Fort Lauderdale, FL"],
  ["SJU", "Luis Muñoz Marín International", "San Juan, PR"],
].map(([code, name, city]) => ({ code, name, city }));

type DelayFilter = { airport: string; from?: string; to?: string };
type FilterSchema = typeof GetDelaySummaryQueryParams;

function validDate(value?: string) {
  if (!value) return true;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function readFilter(req: Request, res: Response, schema: FilterSchema): DelayFilter | null {
  const parsed = schema.safeParse(req.query);
  if (!parsed.success || !validDate(parsed.data.from) || !validDate(parsed.data.to) ||
    (parsed.data.from && parsed.data.to && parsed.data.from > parsed.data.to)) {
    res.status(400).json({ error: "Choose a supported airport and a valid date range (YYYY-MM-DD)." });
    return null;
  }
  return parsed.data;
}

const WHERE = `WHERE airport = $1
  AND ($2::date IS NULL OR flight_date >= $2::date)
  AND ($3::date IS NULL OR flight_date <= $3::date)`;

function values(filter: DelayFilter): [string, string | null, string | null] {
  return [filter.airport, filter.from ?? null, filter.to ?? null];
}

const pct = `COALESCE(ROUND(100.0 * (SUM(departure_flights) - SUM(delayed_departures))
  / NULLIF(SUM(departure_flights), 0), 1), 0)`;
const avgDeparture = `COALESCE(ROUND(SUM(total_dep_delay_minutes)::numeric
  / NULLIF(SUM(departure_flights), 0), 1), 0)`;

router.get("/airports", (_req, res): void => {
  res.json(ListAirportsResponse.parse(airports));
});

router.get("/data-status", async (_req, res): Promise<void> => {
  const [coverage, imports] = await Promise.all([
    pool.query(`SELECT MIN(flight_date)::text AS "firstDate", MAX(flight_date)::text AS "lastDate",
      COALESCE(SUM(flights), 0) AS "totalFlights" FROM airport_delay_daily`),
    pool.query(`SELECT month FROM bts_imported_months ORDER BY month ASC`),
  ]);
  const row = coverage.rows[0];
  res.json(GetDataStatusResponse.parse({
    sourceUrl: BTS_SOURCE_URL,
    firstDate: row.firstDate,
    lastDate: row.lastDate,
    totalFlights: Number(row.totalFlights),
    loadedMonths: imports.rows.map((r) => r.month),
    importing: isBtsImporting(),
  }));
});

router.get("/delays/summary", async (req, res): Promise<void> => {
  const filter = readFilter(req, res, GetDelaySummaryQueryParams);
  if (!filter) return;
  const { rows } = await pool.query(
    `SELECT MIN(flight_date)::text AS "from", MAX(flight_date)::text AS "to",
      COALESCE(SUM(flights), 0) AS flights,
      COALESCE(SUM(arrival_flights), 0) AS "arrivalFlights",
      COALESCE(SUM(delayed_departures), 0) AS "delayedDepartures",
      COALESCE(SUM(cancelled_flights), 0) AS "cancelledFlights",
      COALESCE(SUM(diverted_flights), 0) AS "divertedFlights",
      ${pct} AS "onTimeDeparturePct",
      COALESCE(ROUND(100.0 * SUM(cancelled_flights) / NULLIF(SUM(flights), 0), 1), 0) AS "cancellationPct",
      ${avgDeparture} AS "avgDepartureDelayMinutes",
      COALESCE(ROUND(SUM(total_arr_delay_minutes)::numeric / NULLIF(SUM(arrival_flights), 0), 1), 0) AS "avgArrivalDelayMinutes"
      FROM airport_delay_daily ${WHERE}`,
    values(filter),
  );
  const row = rows[0];
  res.json(GetDelaySummaryResponse.parse({
    airport: filter.airport, from: row.from, to: row.to,
    flights: Number(row.flights), arrivalFlights: Number(row.arrivalFlights),
    delayedDepartures: Number(row.delayedDepartures),
    cancelledFlights: Number(row.cancelledFlights),
    divertedFlights: Number(row.divertedFlights),
    onTimeDeparturePct: Number(row.onTimeDeparturePct),
    cancellationPct: Number(row.cancellationPct),
    avgDepartureDelayMinutes: Number(row.avgDepartureDelayMinutes),
    avgArrivalDelayMinutes: Number(row.avgArrivalDelayMinutes),
  }));
});

router.get("/delays/daily", async (req, res): Promise<void> => {
  const filter = readFilter(req, res, GetDailyDelaysQueryParams);
  if (!filter) return;
  const { rows } = await pool.query(
    `SELECT flight_date::text AS date, SUM(flights) AS flights,
      SUM(delayed_departures) AS "delayedDepartures",
      SUM(cancelled_flights) AS "cancelledFlights",
      ${pct} AS "onTimeDeparturePct",
      ${avgDeparture} AS "avgDepartureDelayMinutes"
      FROM airport_delay_daily ${WHERE}
      GROUP BY flight_date ORDER BY flight_date`,
    values(filter),
  );
  res.json(GetDailyDelaysResponse.parse(rows.map((r) => ({
    date: r.date, flights: Number(r.flights),
    delayedDepartures: Number(r.delayedDepartures),
    cancelledFlights: Number(r.cancelledFlights),
    onTimeDeparturePct: Number(r.onTimeDeparturePct),
    avgDepartureDelayMinutes: Number(r.avgDepartureDelayMinutes),
  }))));
});

router.get("/delays/carriers", async (req, res): Promise<void> => {
  const filter = readFilter(req, res, GetCarrierDelaysQueryParams);
  if (!filter) return;
  const { rows } = await pool.query(
    `SELECT airline AS code, SUM(flights) AS flights,
      SUM(delayed_departures) AS "delayedDepartures",
      SUM(cancelled_flights) AS "cancelledFlights",
      ${pct} AS "onTimeDeparturePct",
      ${avgDeparture} AS "avgDepartureDelayMinutes"
      FROM airport_delay_daily ${WHERE}
      GROUP BY airline ORDER BY flights DESC, airline`,
    values(filter),
  );
  res.json(GetCarrierDelaysResponse.parse(rows.map((r) => ({
    code: r.code, flights: Number(r.flights),
    delayedDepartures: Number(r.delayedDepartures),
    cancelledFlights: Number(r.cancelledFlights),
    onTimeDeparturePct: Number(r.onTimeDeparturePct),
    avgDepartureDelayMinutes: Number(r.avgDepartureDelayMinutes),
  }))));
});

router.get("/delays/causes", async (req, res): Promise<void> => {
  const filter = readFilter(req, res, GetDelayCausesQueryParams);
  if (!filter) return;
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(carrier_delay_minutes), 0) AS carrier,
      COALESCE(SUM(weather_delay_minutes), 0) AS weather,
      COALESCE(SUM(nas_delay_minutes), 0) AS nas,
      COALESCE(SUM(security_delay_minutes), 0) AS security,
      COALESCE(SUM(late_aircraft_delay_minutes), 0) AS late_aircraft
      FROM airport_delay_daily ${WHERE}`,
    values(filter),
  );
  const r = rows[0];
  res.json(GetDelayCausesResponse.parse([
    { cause: "Carrier", minutes: Number(r.carrier) },
    { cause: "Weather", minutes: Number(r.weather) },
    { cause: "National Airspace", minutes: Number(r.nas) },
    { cause: "Security", minutes: Number(r.security) },
    { cause: "Late Aircraft", minutes: Number(r.late_aircraft) },
  ]));
});

router.get("/delays/weekday", async (req, res): Promise<void> => {
  const filter = readFilter(req, res, GetWeekdayDelaysQueryParams);
  if (!filter) return;
  const { rows } = await pool.query(
    `SELECT EXTRACT(ISODOW FROM flight_date)::int AS dow,
      SUM(flights) AS flights, SUM(delayed_departures) AS "delayedDepartures",
      ${pct} AS "onTimeDeparturePct"
      FROM airport_delay_daily ${WHERE}
      GROUP BY dow ORDER BY dow`,
    values(filter),
  );
  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  res.json(GetWeekdayDelaysResponse.parse(rows.map((r) => ({
    dayOfWeek: days[Number(r.dow) - 1],
    flights: Number(r.flights),
    delayedDepartures: Number(r.delayedDepartures),
    onTimeDeparturePct: Number(r.onTimeDeparturePct),
  }))));
});

export default router;