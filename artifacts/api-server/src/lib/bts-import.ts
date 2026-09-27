import { createReadStream, createWriteStream } from "node:fs";
import { open, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createInflateRaw } from "node:zlib";
import { db, airportDelayDailyTable, btsImportedMonthsTable, type InsertAirportDelayDaily } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

export const BTS_SOURCE_URL = "https://www.transtats.bts.gov/ONTIME/";
const DOWNLOAD_BASE = "https://www.transtats.bts.gov/PREZIP/On_Time_Reporting_Carrier_On_Time_Performance_1987_present_";
const AIRPORTS = new Set(
  "ATL DFW DEN ORD LAX JFK LGA EWR SFO SEA CLT PHX MIA PHL DCA IAD IAH DTW MSP SLC BOS PDX ANC HNL DAL HOU MDW BWI LAS MCO FLL SJU".split(" "),
);

let importing = false;
export function isBtsImporting() {
  return importing;
}

function fileUrl(year: number, month: number) {
  return `${DOWNLOAD_BASE}${year}_${month}.zip`;
}

function monthBefore(year: number, month: number, offset: number) {
  const d = new Date(Date.UTC(year, month - 1 - offset, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

async function findLatestMonth() {
  const today = new Date();
  for (let offset = 1; offset <= 12; offset++) {
    const period = monthBefore(today.getUTCFullYear(), today.getUTCMonth() + 1, offset);
    try {
      const response = await fetch(fileUrl(period.year, period.month), {
        method: "HEAD",
        signal: AbortSignal.timeout(20_000),
      });
      if (response.ok && (response.headers.get("content-type") || "").toLowerCase().includes("zip")) {
        return period;
      }
    } catch (error) {
      logger.warn({ error, period }, "Unable to check BTS month");
    }
  }
  throw new Error("No recent official BTS monthly ZIP file is reachable");
}

// BTS ZIP archives contain a single deflated CSV plus a readme. Reading the
// central directory allows the large CSV to be streamed without a ZIP binary
// or loading its hundreds of megabytes into memory.
async function csvStreamFromZip(path: string) {
  const handle = await open(path, "r");
  try {
    const { size } = await stat(path);
    const tailSize = Math.min(size, 65_557);
    const tail = Buffer.alloc(tailSize);
    await handle.read(tail, 0, tailSize, size - tailSize);
    let eocd = -1;
    for (let i = tailSize - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error("BTS download is not a valid ZIP archive");
    const count = tail.readUInt16LE(eocd + 10);
    let position = tail.readUInt32LE(eocd + 16);
    for (let entry = 0; entry < count; entry++) {
      const header = Buffer.alloc(46);
      await handle.read(header, 0, 46, position);
      if (header.readUInt32LE(0) !== 0x02014b50) throw new Error("Invalid ZIP central directory");
      const nameLength = header.readUInt16LE(28);
      const extraLength = header.readUInt16LE(30);
      const commentLength = header.readUInt16LE(32);
      const name = Buffer.alloc(nameLength);
      await handle.read(name, 0, nameLength, position + 46);
      position += 46 + nameLength + extraLength + commentLength;
      if (!name.toString("utf8").toLowerCase().endsWith(".csv")) continue;

      const method = header.readUInt16LE(10);
      const compressedSize = header.readUInt32LE(20);
      const localOffset = header.readUInt32LE(42);
      if (compressedSize === 0xffffffff) throw new Error("ZIP64 archives are not supported");
      const local = Buffer.alloc(30);
      await handle.read(local, 0, 30, localOffset);
      if (local.readUInt32LE(0) !== 0x04034b50) throw new Error("Invalid ZIP file header");
      const start = localOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
      const compressed = createReadStream(path, { start, end: start + compressedSize - 1 });
      if (method === 8) return compressed.pipe(createInflateRaw());
      if (method === 0) return compressed;
      throw new Error(`Unsupported ZIP compression method ${method}`);
    }
    throw new Error("BTS ZIP file contains no CSV");
  } finally {
    await handle.close();
  }
}

function parseCsvRow(line: string) {
  const cells: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (c === "," && !quoted) {
      cells.push(field);
      field = "";
    } else {
      field += c;
    }
  }
  cells.push(field);
  return cells;
}

const COLUMN_NAMES = [
  "FlightDate", "Origin", "Reporting_Airline", "DepDelayMinutes", "DepDel15",
  "ArrDelayMinutes", "Cancelled", "Diverted", "CarrierDelay", "WeatherDelay",
  "NASDelay", "SecurityDelay", "LateAircraftDelay",
] as const;

function minutes(value: string) {
  const n = Number(value);
  return value === "" || !Number.isFinite(n) ? 0 : Math.max(0, Math.round(n));
}

function updateAggregate(row: InsertAirportDelayDaily, cells: string[], column: Record<string, number>) {
  const value = (name: (typeof COLUMN_NAMES)[number]) => cells[column[name]] ?? "";
  const cancelled = Number(value("Cancelled")) === 1;
  const diverted = Number(value("Diverted")) === 1;
  row.flights++;
  if (value("DepDelayMinutes") !== "") {
    row.departureFlights++;
    row.totalDepDelayMinutes += minutes(value("DepDelayMinutes"));
  }
  if (value("ArrDelayMinutes") !== "") {
    row.arrivalFlights++;
    row.totalArrDelayMinutes += minutes(value("ArrDelayMinutes"));
  }
  if (Number(value("DepDel15")) === 1) row.delayedDepartures++;
  if (cancelled) row.cancelledFlights++;
  if (diverted) row.divertedFlights++;
  row.carrierDelayMinutes += minutes(value("CarrierDelay"));
  row.weatherDelayMinutes += minutes(value("WeatherDelay"));
  row.nasDelayMinutes += minutes(value("NASDelay"));
  row.securityDelayMinutes += minutes(value("SecurityDelay"));
  row.lateAircraftDelayMinutes += minutes(value("LateAircraftDelay"));
}

function emptyAggregate(date: string, airport: string, airline: string): InsertAirportDelayDaily {
  return {
    flightDate: date, airport, airline,
    flights: 0, departureFlights: 0, arrivalFlights: 0, delayedDepartures: 0,
    cancelledFlights: 0, divertedFlights: 0, totalDepDelayMinutes: 0,
    totalArrDelayMinutes: 0, carrierDelayMinutes: 0, weatherDelayMinutes: 0,
    nasDelayMinutes: 0, securityDelayMinutes: 0, lateAircraftDelayMinutes: 0,
  };
}

async function importMonth(year: number, month: number) {
  const monthKey = `${year}-${String(month).padStart(2, "0")}`;
  const [existing] = await db.select({ month: btsImportedMonthsTable.month })
    .from(btsImportedMonthsTable).where(eq(btsImportedMonthsTable.month, monthKey));
  if (existing) return;

  const archivePath = join(tmpdir(), `bts-${monthKey}-${randomUUID()}.zip`);
  try {
    const response = await fetch(fileUrl(year, month), { signal: AbortSignal.timeout(180_000) });
    if (!response.ok || !response.body) throw new Error(`BTS download failed: HTTP ${response.status}`);
    if (!(response.headers.get("content-type") || "").toLowerCase().includes("zip")) {
      throw new Error("BTS download returned a non-ZIP response");
    }
    await pipeline(Readable.fromWeb(response.body as never), createWriteStream(archivePath));
    const stream = await csvStreamFromZip(archivePath);
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    let column: Record<string, number> | undefined;
    const aggregates = new Map<string, InsertAirportDelayDaily>();
    let flightCount = 0;
    for await (const line of lines) {
      if (!column) {
        const headings = parseCsvRow(line.replace(/^\uFEFF/, ""));
        column = Object.fromEntries(headings.map((name, index) => [name, index]));
        for (const name of COLUMN_NAMES) {
          if (column[name] === undefined) throw new Error(`BTS CSV missing required field ${name}`);
        }
        continue;
      }
      if (!line.trim()) continue;
      const cells = parseCsvRow(line);
      const airport = cells[column.Origin];
      if (!AIRPORTS.has(airport)) continue;
      const date = cells[column.FlightDate];
      const airline = cells[column.Reporting_Airline];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !airline) continue;
      const key = `${date}|${airport}|${airline}`;
      let row = aggregates.get(key);
      if (!row) {
        row = emptyAggregate(date, airport, airline);
        aggregates.set(key, row);
      }
      updateAggregate(row, cells, column);
      flightCount++;
    }
    if (!flightCount) throw new Error(`No supported-airport flights found for ${monthKey}`);

    const rows = [...aggregates.values()];
    await db.transaction(async (tx) => {
      for (let i = 0; i < rows.length; i += 500) {
        await tx.insert(airportDelayDailyTable).values(rows.slice(i, i + 500))
          .onConflictDoNothing();
      }
      await tx.insert(btsImportedMonthsTable).values({ month: monthKey, flightCount })
        .onConflictDoNothing();
    });
    logger.info({ month: monthKey, flightCount, aggregateRows: rows.length }, "Imported BTS month");
  } finally {
    await rm(archivePath, { force: true });
  }
}

export async function syncRecentBtsMonths() {
  if (importing) return;
  importing = true;
  try {
    const latest = await findLatestMonth();
    // Keep every previously imported month; bring in the three latest released months.
    for (let offset = 2; offset >= 0; offset--) {
      const period = monthBefore(latest.year, latest.month, offset);
      try {
        await importMonth(period.year, period.month);
      } catch (error) {
        logger.error({ error, period }, "BTS month import failed");
      }
    }
  } catch (error) {
    logger.error({ error }, "BTS data sync failed");
  } finally {
    importing = false;
  }
}

export function startBtsSync() {
  setTimeout(() => void syncRecentBtsMonths(), 1_000).unref();
  setInterval(() => void syncRecentBtsMonths(), 24 * 60 * 60 * 1_000).unref();
}