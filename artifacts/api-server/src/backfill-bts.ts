import { pool } from "@workspace/db";
import { findLatestMonth, importMonth } from "./lib/bts-import";

const MONTHS = 24;

function monthBefore(year: number, month: number, offset: number) {
  const date = new Date(Date.UTC(year, month - 1 - offset, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

async function main() {
  let failures = 0;
  try {
    const latest = await findLatestMonth();
    const oldest = monthBefore(latest.year, latest.month, MONTHS - 1);
    console.log(`Backfilling ${MONTHS} BTS months: ${oldest.year}-${String(oldest.month).padStart(2, "0")} through ${latest.year}-${String(latest.month).padStart(2, "0")}`);

    for (let offset = MONTHS - 1; offset >= 0; offset--) {
      const { year, month } = monthBefore(latest.year, latest.month, offset);
      const key = `${year}-${String(month).padStart(2, "0")}`;
      try {
        console.log(`Checking ${key}`);
        await importMonth(year, month);
      } catch (error) {
        failures++;
        console.error(`Failed ${key}:`, error);
      }
    }

    if (failures) throw new Error(`${failures} month(s) failed to import; rerun this command to retry missing months`);
    console.log("BTS 24-month backfill complete.");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});