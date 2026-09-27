import {
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// One row per origin airport, flight date, and reporting carrier.
// Metrics use the BTS Reporting Carrier On-Time Performance definitions.
export const airportDelayDailyTable = pgTable(
  "airport_delay_daily",
  {
    flightDate: date("flight_date", { mode: "string" }).notNull(),
    airport: text("airport").notNull(),
    airline: text("airline").notNull(),
    flights: integer("flights").notNull(),
    departureFlights: integer("departure_flights").notNull(),
    arrivalFlights: integer("arrival_flights").notNull(),
    delayedDepartures: integer("delayed_departures").notNull(),
    cancelledFlights: integer("cancelled_flights").notNull(),
    divertedFlights: integer("diverted_flights").notNull(),
    totalDepDelayMinutes: integer("total_dep_delay_minutes").notNull(),
    totalArrDelayMinutes: integer("total_arr_delay_minutes").notNull(),
    carrierDelayMinutes: integer("carrier_delay_minutes").notNull(),
    weatherDelayMinutes: integer("weather_delay_minutes").notNull(),
    nasDelayMinutes: integer("nas_delay_minutes").notNull(),
    securityDelayMinutes: integer("security_delay_minutes").notNull(),
    lateAircraftDelayMinutes: integer("late_aircraft_delay_minutes").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.flightDate, t.airport, t.airline] }),
    index("airport_delay_airport_date_idx").on(t.airport, t.flightDate),
  ],
);

export const insertAirportDelayDailySchema = createInsertSchema(airportDelayDailyTable);
export type InsertAirportDelayDaily = z.infer<typeof insertAirportDelayDailySchema>;
export type AirportDelayDaily = typeof airportDelayDailyTable.$inferSelect;

// A month is recorded only after all its aggregate rows commit successfully.
export const btsImportedMonthsTable = pgTable("bts_imported_months", {
  month: text("month").primaryKey(),
  flightCount: integer("flight_count").notNull(),
  importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertBtsImportedMonthSchema = createInsertSchema(btsImportedMonthsTable).omit({
  importedAt: true,
});
export type InsertBtsImportedMonth = z.infer<typeof insertBtsImportedMonthSchema>;