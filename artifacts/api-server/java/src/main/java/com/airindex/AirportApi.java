package com.airindex;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import javax.sql.DataSource;
import java.io.IOException;
import java.math.BigDecimal;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.BooleanSupplier;

public final class AirportApi {
    private static final String BTS_SOURCE_URL = "https://www.transtats.bts.gov/ONTIME/";
    private static final String INVALID_FILTER =
            "Choose a supported airport and a valid date range (YYYY-MM-DD).";
    private static final String WHERE = """
            WHERE airport = ?
               AND (?::date IS NULL OR flight_date >= ?::date)
               AND (?::date IS NULL OR flight_date <= ?::date)
            """;
    private static final String PCT = """
            COALESCE(ROUND(100.0 * (SUM(departure_flights) - SUM(delayed_departures))
              / NULLIF(SUM(departure_flights), 0), 1), 0)
            """;
    private static final String AVG_DEPARTURE = """
             COALESCE(ROUND(SUM(total_dep_delay_minutes)::numeric
              / NULLIF(SUM(departure_flights), 0), 1), 0)
            """;
    private static final List<String[]> AIRPORTS = List.<String[]>of(
            new String[]{"ATL", "Hartsfield–Jackson Atlanta International", "Atlanta, GA"},
            new String[]{"DFW", "Dallas Fort Worth International", "Dallas–Fort Worth, TX"},
            new String[]{"DEN", "Denver International", "Denver, CO"},
            new String[]{"ORD", "O'Hare International", "Chicago, IL"},
            new String[]{"LAX", "Los Angeles International", "Los Angeles, CA"},
            new String[]{"JFK", "John F. Kennedy International", "New York, NY"},
            new String[]{"LGA", "LaGuardia", "New York, NY"},
            new String[]{"EWR", "Newark Liberty International", "Newark, NJ"},
            new String[]{"SFO", "San Francisco International", "San Francisco, CA"},
            new String[]{"SEA", "Seattle–Tacoma International", "Seattle, WA"},
            new String[]{"CLT", "Charlotte Douglas International", "Charlotte, NC"},
            new String[]{"PHX", "Phoenix Sky Harbor International", "Phoenix, AZ"},
            new String[]{"MIA", "Miami International", "Miami, FL"},
            new String[]{"PHL", "Philadelphia International", "Philadelphia, PA"},
            new String[]{"DCA", "Ronald Reagan Washington National", "Washington, DC"},
            new String[]{"IAD", "Washington Dulles International", "Washington, DC"},
            new String[]{"IAH", "George Bush Intercontinental", "Houston, TX"},
            new String[]{"DTW", "Detroit Metropolitan", "Detroit, MI"},
            new String[]{"MSP", "Minneapolis–Saint Paul International", "Minneapolis, MN"},
            new String[]{"SLC", "Salt Lake City International", "Salt Lake City, UT"},
            new String[]{"BOS", "Logan International", "Boston, MA"},
            new String[]{"PDX", "Portland International", "Portland, OR"},
            new String[]{"ANC", "Ted Stevens Anchorage International", "Anchorage, AK"},
            new String[]{"HNL", "Daniel K. Inouye International", "Honolulu, HI"},
            new String[]{"DAL", "Dallas Love Field", "Dallas, TX"},
            new String[]{"HOU", "William P. Hobby", "Houston, TX"},
            new String[]{"MDW", "Chicago Midway International", "Chicago, IL"},
            new String[]{"BWI", "Baltimore/Washington International", "Baltimore, MD"},
            new String[]{"LAS", "Harry Reid International", "Las Vegas, NV"},
            new String[]{"MCO", "Orlando International", "Orlando, FL"},
            new String[]{"FLL", "Fort Lauderdale–Hollywood International", "Fort Lauderdale, FL"},
            new String[]{"SJU", "Luis Muñoz Marín International", "San Juan, PR"}
    );
    private static final List<String> AIRPORT_CODES = AIRPORTS.stream()
            .map(airport -> airport[0]).toList();
    private static final String[] WEEKDAYS = {
            "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"
    };

    private final DataSource dataSource;
    private final BooleanSupplier importing;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public AirportApi(DataSource dataSource, BooleanSupplier importing) {
        this.dataSource = dataSource;
        this.importing = importing;
    }

    public void register(HttpServer server) {
        register(server, "/api/healthz", this::health);
        register(server, "/api/airports", this::airports);
        register(server, "/api/data-status", this::dataStatus);
        register(server, "/api/delays/summary", this::summary);
        register(server, "/api/delays/daily", this::daily);
        register(server, "/api/delays/carriers", this::carriers);
        register(server, "/api/delays/causes", this::causes);
        register(server, "/api/delays/weekday", this::weekday);
    }

    private void register(HttpServer server, String path, Endpoint endpoint) {
        server.createContext(path, exchange -> {
            exchange.getResponseHeaders().set("Access-Control-Allow-Origin", "*");
            exchange.getResponseHeaders().set("Access-Control-Allow-Methods", "GET, OPTIONS");
            exchange.getResponseHeaders().set("Access-Control-Allow-Headers", "Content-Type");
            if ("OPTIONS".equalsIgnoreCase(exchange.getRequestMethod())) {
                exchange.sendResponseHeaders(204, -1);
                exchange.close();
                return;
            }
            if (!"GET".equalsIgnoreCase(exchange.getRequestMethod())) {
                sendJson(exchange, 405, Map.of("error", "Method not allowed"));
                return;
            }
            if (!path.equals(exchange.getRequestURI().getPath())) {
                sendJson(exchange, 404, Map.of("error", "Not found"));
                return;
            }
            try {
                endpoint.handle(exchange);
            } catch (Exception exception) {
                exception.printStackTrace(System.err);
                sendJson(exchange, 500, Map.of("error", "Internal server error"));
            }
        });
    }

    private void health(HttpExchange exchange) throws IOException {
        sendJson(exchange, 200, Map.of("status", "ok"));
    }

    private void airports(HttpExchange exchange) throws IOException {
        List<Map<String, Object>> result = new ArrayList<>();
        for (String[] airport : AIRPORTS) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("code", airport[0]);
            row.put("name", airport[1]);
            row.put("city", airport[2]);
            result.add(row);
        }
        sendJson(exchange, 200, result);
    }

    private void dataStatus(HttpExchange exchange) throws SQLException, IOException {
        Map<String, Object> result = new LinkedHashMap<>();
        try (Connection connection = dataSource.getConnection()) {
            try (PreparedStatement statement = connection.prepareStatement("""
                     SELECT MIN(flight_date)::text AS "firstDate",
                       MAX(flight_date)::text AS "lastDate",
                       COALESCE(SUM(flights), 0) AS "totalFlights"
                    FROM airport_delay_daily
                    """);
                 ResultSet rows = statement.executeQuery()) {
                rows.next();
                result.put("firstDate", rows.getString("firstDate"));
                result.put("lastDate", rows.getString("lastDate"));
                result.put("totalFlights", integer(rows.getObject("totalFlights")));
            }
            List<String> months = new ArrayList<>();
            try (PreparedStatement statement = connection.prepareStatement(
                    "SELECT month FROM bts_imported_months ORDER BY month ASC");
                 ResultSet rows = statement.executeQuery()) {
                while (rows.next()) {
                    Object month = rows.getObject("month");
                    months.add(month == null ? null : month.toString());
                }
            }
            result.put("loadedMonths", months);
        }
        result.put("sourceUrl", BTS_SOURCE_URL);
        result.put("importing", importing.getAsBoolean());
        sendJson(exchange, 200, result);
    }

    private void summary(HttpExchange exchange) throws Exception {
        Filter filter = readFilter(exchange);
        if (filter == null) return;
        String sql = """
                 SELECT MIN(flight_date)::text AS "from",
                   MAX(flight_date)::text AS "to",
                  COALESCE(SUM(flights), 0) AS flights,
                   COALESCE(SUM(arrival_flights), 0) AS "arrivalFlights",
                   COALESCE(SUM(delayed_departures), 0) AS "delayedDepartures",
                   COALESCE(SUM(cancelled_flights), 0) AS "cancelledFlights",
                   COALESCE(SUM(diverted_flights), 0) AS "divertedFlights",
                   %s AS "onTimeDeparturePct",
                  COALESCE(ROUND(100.0 * SUM(cancelled_flights)
                     / NULLIF(SUM(flights), 0), 1), 0) AS "cancellationPct",
                   %s AS "avgDepartureDelayMinutes",
                   COALESCE(ROUND(SUM(total_arr_delay_minutes)::numeric
                     / NULLIF(SUM(arrival_flights), 0), 1), 0) AS "avgArrivalDelayMinutes"
                FROM airport_delay_daily %s
                """.formatted(PCT, AVG_DEPARTURE, WHERE);
        try (Connection connection = dataSource.getConnection();
             PreparedStatement statement = prepare(connection, sql, filter);
             ResultSet rows = statement.executeQuery()) {
            rows.next();
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("airport", filter.airport);
            result.put("from", rows.getString("from"));
            result.put("to", rows.getString("to"));
            result.put("flights", integer(rows.getObject("flights")));
            result.put("arrivalFlights", integer(rows.getObject("arrivalFlights")));
            result.put("delayedDepartures", integer(rows.getObject("delayedDepartures")));
            result.put("cancelledFlights", integer(rows.getObject("cancelledFlights")));
            result.put("divertedFlights", integer(rows.getObject("divertedFlights")));
            result.put("onTimeDeparturePct", decimal(rows.getObject("onTimeDeparturePct")));
            result.put("cancellationPct", decimal(rows.getObject("cancellationPct")));
            result.put("avgDepartureDelayMinutes", decimal(rows.getObject("avgDepartureDelayMinutes")));
            result.put("avgArrivalDelayMinutes", decimal(rows.getObject("avgArrivalDelayMinutes")));
            sendJson(exchange, 200, result);
        }
    }

    private void daily(HttpExchange exchange) throws Exception {
        Filter filter = readFilter(exchange);
        if (filter == null) return;
        String sql = """
                 SELECT flight_date::text AS "date",
                  SUM(flights) AS flights,
                   SUM(delayed_departures) AS "delayedDepartures",
                   SUM(cancelled_flights) AS "cancelledFlights",
                   %s AS "onTimeDeparturePct",
                   %s AS "avgDepartureDelayMinutes"
                FROM airport_delay_daily %s
                GROUP BY flight_date ORDER BY flight_date
                """.formatted(PCT, AVG_DEPARTURE, WHERE);
        List<Map<String, Object>> result = new ArrayList<>();
        try (Connection connection = dataSource.getConnection();
             PreparedStatement statement = prepare(connection, sql, filter);
             ResultSet rows = statement.executeQuery()) {
            while (rows.next()) {
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("date", rows.getString("date"));
                row.put("flights", integer(rows.getObject("flights")));
                row.put("delayedDepartures", integer(rows.getObject("delayedDepartures")));
                row.put("cancelledFlights", integer(rows.getObject("cancelledFlights")));
                row.put("onTimeDeparturePct", decimal(rows.getObject("onTimeDeparturePct")));
                row.put("avgDepartureDelayMinutes", decimal(rows.getObject("avgDepartureDelayMinutes")));
                result.add(row);
            }
        }
        sendJson(exchange, 200, result);
    }

    private void carriers(HttpExchange exchange) throws Exception {
        Filter filter = readFilter(exchange);
        if (filter == null) return;
        String sql = """
                SELECT airline AS code, SUM(flights) AS flights,
                   SUM(delayed_departures) AS "delayedDepartures",
                   SUM(cancelled_flights) AS "cancelledFlights",
                   %s AS "onTimeDeparturePct",
                   %s AS "avgDepartureDelayMinutes"
                FROM airport_delay_daily %s
                GROUP BY airline ORDER BY flights DESC, airline
                """.formatted(PCT, AVG_DEPARTURE, WHERE);
        List<Map<String, Object>> result = new ArrayList<>();
        try (Connection connection = dataSource.getConnection();
             PreparedStatement statement = prepare(connection, sql, filter);
             ResultSet rows = statement.executeQuery()) {
            while (rows.next()) {
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("code", rows.getString("code"));
                row.put("flights", integer(rows.getObject("flights")));
                row.put("delayedDepartures", integer(rows.getObject("delayedDepartures")));
                row.put("cancelledFlights", integer(rows.getObject("cancelledFlights")));
                row.put("onTimeDeparturePct", decimal(rows.getObject("onTimeDeparturePct")));
                row.put("avgDepartureDelayMinutes", decimal(rows.getObject("avgDepartureDelayMinutes")));
                result.add(row);
            }
        }
        sendJson(exchange, 200, result);
    }

    private void causes(HttpExchange exchange) throws Exception {
        Filter filter = readFilter(exchange);
        if (filter == null) return;
        String sql = """
                SELECT COALESCE(SUM(carrier_delay_minutes), 0) AS carrier,
                  COALESCE(SUM(weather_delay_minutes), 0) AS weather,
                  COALESCE(SUM(nas_delay_minutes), 0) AS nas,
                  COALESCE(SUM(security_delay_minutes), 0) AS security,
                  COALESCE(SUM(late_aircraft_delay_minutes), 0) AS late_aircraft
                FROM airport_delay_daily %s
                """.formatted(WHERE);
        try (Connection connection = dataSource.getConnection();
             PreparedStatement statement = prepare(connection, sql, filter);
             ResultSet rows = statement.executeQuery()) {
            rows.next();
            List<Map<String, Object>> result = new ArrayList<>();
            addCause(result, "Carrier", rows.getObject("carrier"));
            addCause(result, "Weather", rows.getObject("weather"));
            addCause(result, "National Airspace", rows.getObject("nas"));
            addCause(result, "Security", rows.getObject("security"));
            addCause(result, "Late Aircraft", rows.getObject("late_aircraft"));
            sendJson(exchange, 200, result);
        }
    }

    private void weekday(HttpExchange exchange) throws Exception {
        Filter filter = readFilter(exchange);
        if (filter == null) return;
        String sql = """
                 SELECT EXTRACT(ISODOW FROM flight_date)::int AS dow,
                  SUM(flights) AS flights,
                   SUM(delayed_departures) AS "delayedDepartures",
                   %s AS "onTimeDeparturePct"
                FROM airport_delay_daily %s
                GROUP BY dow ORDER BY dow
                """.formatted(PCT, WHERE);
        List<Map<String, Object>> result = new ArrayList<>();
        try (Connection connection = dataSource.getConnection();
             PreparedStatement statement = prepare(connection, sql, filter);
             ResultSet rows = statement.executeQuery()) {
            while (rows.next()) {
                int dow = (int) integer(rows.getObject("dow"));
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("dayOfWeek", WEEKDAYS[dow - 1]);
                row.put("flights", integer(rows.getObject("flights")));
                row.put("delayedDepartures", integer(rows.getObject("delayedDepartures")));
                row.put("onTimeDeparturePct", decimal(rows.getObject("onTimeDeparturePct")));
                result.add(row);
            }
        }
        sendJson(exchange, 200, result);
    }

    private Filter readFilter(HttpExchange exchange) throws IOException {
        Map<String, List<String>> query;
        try {
            query = parseQuery(exchange.getRequestURI().getRawQuery());
        } catch (IllegalArgumentException exception) {
            sendJson(exchange, 400, Map.of("error", INVALID_FILTER));
            return null;
        }
        String airport = single(query, "airport");
        String from = single(query, "from");
        String to = single(query, "to");
        boolean valid = airport != null && AIRPORT_CODES.contains(airport)
                && (!query.containsKey("from") || query.get("from").size() == 1)
                && (!query.containsKey("to") || query.get("to").size() == 1)
                && (from == null || validDate(from))
                && (to == null || validDate(to));
        if (valid && from != null && to != null) {
            valid = !LocalDate.parse(from).isAfter(LocalDate.parse(to));
        }
        if (!valid) {
            sendJson(exchange, 400, Map.of("error", INVALID_FILTER));
            return null;
        }
        return new Filter(airport, from, to);
    }

    private static Map<String, List<String>> parseQuery(String rawQuery) {
        Map<String, List<String>> query = new LinkedHashMap<>();
        if (rawQuery == null || rawQuery.isEmpty()) return query;
        for (String pair : rawQuery.split("&")) {
            if (pair.isEmpty()) continue;
            int separator = pair.indexOf('=');
            String key = decode(separator < 0 ? pair : pair.substring(0, separator));
            String value = decode(separator < 0 ? "" : pair.substring(separator + 1));
            query.computeIfAbsent(key, ignored -> new ArrayList<>()).add(value);
        }
        return query;
    }

    private static String decode(String value) {
        return URLDecoder.decode(value, StandardCharsets.UTF_8);
    }

    private static String single(Map<String, List<String>> query, String key) {
        List<String> values = query.get(key);
        return values == null || values.size() != 1 ? null : values.get(0);
    }

    private static boolean validDate(String value) {
        if (!value.matches("\\d{4}-\\d{2}-\\d{2}")) return false;
        try {
            LocalDate.parse(value);
            return true;
        } catch (DateTimeParseException exception) {
            return false;
        }
    }

    private static PreparedStatement prepare(Connection connection, String sql, Filter filter)
            throws SQLException {
        PreparedStatement statement = connection.prepareStatement(sql);
        statement.setString(1, filter.airport);
        setNullableString(statement, 2, filter.from);
        setNullableString(statement, 3, filter.from);
        setNullableString(statement, 4, filter.to);
        setNullableString(statement, 5, filter.to);
        return statement;
    }

    private static void setNullableString(PreparedStatement statement, int index, String value)
            throws SQLException {
        if (value == null) statement.setNull(index, java.sql.Types.DATE);
        else statement.setDate(index, java.sql.Date.valueOf(value));
    }

    private static long integer(Object value) {
        if (value == null) return 0L;
        if (value instanceof BigDecimal decimal) return decimal.longValue();
        if (value instanceof Number number) return number.longValue();
        return new BigDecimal(value.toString()).longValue();
    }

    private static BigDecimal decimal(Object value) {
        if (value == null) return BigDecimal.ZERO;
        if (value instanceof BigDecimal decimal) return decimal;
        if (value instanceof Number number) return new BigDecimal(number.toString());
        return new BigDecimal(value.toString());
    }

    private static void addCause(List<Map<String, Object>> result, String name, Object minutes) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("cause", name);
        row.put("minutes", integer(minutes));
        result.add(row);
    }

    private void sendJson(HttpExchange exchange, int status, Object body) throws IOException {
        byte[] response = objectMapper.writeValueAsBytes(body);
        exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        exchange.sendResponseHeaders(status, response.length);
        try (var output = exchange.getResponseBody()) {
            output.write(response);
        }
    }

    @FunctionalInterface
    private interface Endpoint {
        void handle(HttpExchange exchange) throws Exception;
    }

    private static final class Filter {
        private final String airport;
        private final String from;
        private final String to;

        private Filter(String airport, String from, String to) {
            this.airport = airport;
            this.from = from;
            this.to = to;
        }
    }
}