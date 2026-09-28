package com.airindex;

import javax.sql.DataSource;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.YearMonth;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Imports monthly BTS on-time performance archives into the existing PostgreSQL delay tables.
 */
public final class BtsSync implements AutoCloseable {
    private static final String DOWNLOAD_BASE =
            "https://www.transtats.bts.gov/PREZIP/On_Time_Reporting_Carrier_On_Time_Performance_1987_present_";
    private static final LocalTime DAILY_SYNC_TIME_UTC = LocalTime.of(5, 0);
    private static final Set<String> AIRPORTS = Set.of(
            "ATL", "DFW", "DEN", "ORD", "LAX", "JFK", "LGA", "EWR",
            "SFO", "SEA", "CLT", "PHX", "MIA", "PHL", "DCA", "IAD",
            "IAH", "DTW", "MSP", "SLC", "BOS", "PDX", "ANC", "HNL",
            "DAL", "HOU", "MDW", "BWI", "LAS", "MCO", "FLL", "SJU");
    private static final List<String> REQUIRED_COLUMNS = List.of(
            "FlightDate", "Origin", "Reporting_Airline", "DepDelayMinutes", "DepDel15",
            "ArrDelayMinutes", "Cancelled", "Diverted", "CarrierDelay", "WeatherDelay",
            "NASDelay", "SecurityDelay", "LateAircraftDelay");
    private static final String INSERT_SQL = """
            INSERT INTO airport_delay_daily
            (flight_date, airport, airline, flights, departure_flights, arrival_flights,
             delayed_departures, cancelled_flights, diverted_flights,
             total_dep_delay_minutes, total_arr_delay_minutes, carrier_delay_minutes,
             weather_delay_minutes, nas_delay_minutes, security_delay_minutes,
             late_aircraft_delay_minutes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (flight_date, airport, airline) DO NOTHING
            """;

    private final DataSource dataSource;
    private final HttpClient httpClient;
    private final AtomicBoolean importing = new AtomicBoolean(false);
    private final AtomicBoolean started = new AtomicBoolean(false);
    private volatile ScheduledExecutorService scheduler;

    public BtsSync(DataSource dataSource) {
        this.dataSource = dataSource;
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(20))
                .followRedirects(HttpClient.Redirect.NORMAL)
                .build();
    }

    public void start() {
        if (!started.compareAndSet(false, true)) {
            return;
        }
        ScheduledExecutorService createdScheduler = Executors.newSingleThreadScheduledExecutor(task -> {
            Thread thread = new Thread(task, "bts-monthly-sync");
            thread.setDaemon(true);
            return thread;
        });
        scheduler = createdScheduler;
        // Reconcile immediately on startup, then check at 05:00 UTC every day.
        // The fifth-of-month check is therefore calendar-aligned, without a 30-day approximation.
        createdScheduler.execute(this::syncSafely);
        scheduleNextDailySync(createdScheduler);
    }

    private void scheduleNextDailySync(ScheduledExecutorService executor) {
        Instant now = Instant.now();
        Instant nextRun = now.atZone(ZoneOffset.UTC).toLocalDate()
                .atTime(DAILY_SYNC_TIME_UTC).toInstant(ZoneOffset.UTC);
        if (!nextRun.isAfter(now)) {
            nextRun = nextRun.plus(Duration.ofDays(1));
        }
        long delayMillis = Math.max(0, Duration.between(now, nextRun).toMillis());
        executor.schedule(() -> {
            syncSafely();
            if (!executor.isShutdown()) {
                scheduleNextDailySync(executor);
            }
        }, delayMillis, TimeUnit.MILLISECONDS);
    }

    public boolean isImporting() {
        return importing.get();
    }

    @Override
    public void close() {
        ScheduledExecutorService current = scheduler;
        if (current == null) {
            return;
        }
        current.shutdown();
        try {
            if (!current.awaitTermination(5, TimeUnit.SECONDS)) {
                current.shutdownNow();
                current.awaitTermination(5, TimeUnit.SECONDS);
            }
        } catch (InterruptedException e) {
            current.shutdownNow();
            Thread.currentThread().interrupt();
        }
    }

    private void syncSafely() {
        if (!importing.compareAndSet(false, true)) {
            return;
        }
        try {
            YearMonth latest = findLatestMonth();
            // Reconcile the full rolling window so failed or missed months are retried.
            for (int offset = 23; offset >= 0; offset--) {
                YearMonth month = latest.minusMonths(offset);
                try {
                    importMonth(month);
                } catch (Exception e) {
                    System.err.println("BTS import failed for " + month + ": " + e.getMessage());
                    e.printStackTrace(System.err);
                }
            }
        } catch (Exception e) {
            System.err.println("BTS sync failed: " + e.getMessage());
            e.printStackTrace(System.err);
        } finally {
            importing.set(false);
        }
    }

    private YearMonth findLatestMonth() throws IOException, InterruptedException {
        YearMonth candidate = YearMonth.now(ZoneOffset.UTC).minusMonths(1);
        for (int offset = 0; offset < 12; offset++, candidate = candidate.minusMonths(1)) {
            HttpRequest request = HttpRequest.newBuilder(archiveUri(candidate))
                    .timeout(Duration.ofSeconds(20))
                    .method("HEAD", HttpRequest.BodyPublishers.noBody())
                    .build();
            try {
                HttpResponse<Void> response = httpClient.send(request, HttpResponse.BodyHandlers.discarding());
                String contentType = response.headers().firstValue("content-type").orElse("").toLowerCase();
                if (response.statusCode() >= 200 && response.statusCode() < 300
                        && contentType.contains("zip")) {
                    return candidate;
                }
            } catch (IOException e) {
                System.err.println("Unable to check BTS month " + candidate + ": " + e.getMessage());
            }
        }
        throw new IOException("No recent official BTS monthly ZIP file is reachable");
    }

    private static URI archiveUri(YearMonth month) {
        return URI.create(DOWNLOAD_BASE + month.getYear() + "_" + month.getMonthValue() + ".zip");
    }

    private void importMonth(YearMonth month) throws Exception {
        String monthKey = month.toString();
        try (Connection connection = dataSource.getConnection()) {
            try (PreparedStatement query = connection.prepareStatement(
                    "SELECT 1 FROM bts_imported_months WHERE month = ?")) {
                query.setString(1, monthKey);
                try (ResultSet result = query.executeQuery()) {
                    if (result.next()) {
                        System.out.println("BTS month already imported: " + monthKey);
                        return;
                    }
                }
            }

            Map<AggregateKey, Aggregate> aggregates = new HashMap<>();
            long flightCount;
            HttpRequest request = HttpRequest.newBuilder(archiveUri(month))
                    .timeout(Duration.ofMinutes(3))
                    .GET()
                    .build();
            HttpResponse<InputStream> response = httpClient.send(request, HttpResponse.BodyHandlers.ofInputStream());
            try (InputStream responseBody = response.body()) {
                if (response.statusCode() < 200 || response.statusCode() >= 300) {
                    throw new IOException("BTS download failed: HTTP " + response.statusCode());
                }
                String contentType = response.headers().firstValue("content-type").orElse("").toLowerCase();
                if (!contentType.contains("zip")) {
                    throw new IOException("BTS download returned a non-ZIP response");
                }
                try (ZipInputStream zip = new ZipInputStream(responseBody, StandardCharsets.UTF_8)) {
                    ZipEntry entry;
                    boolean foundCsv = false;
                    long[] count = {0};
                    while ((entry = zip.getNextEntry()) != null) {
                        if (!entry.isDirectory() && entry.getName().toLowerCase().endsWith(".csv")) {
                            foundCsv = true;
                            try (BufferedReader reader = new BufferedReader(
                                    new InputStreamReader(zip, StandardCharsets.UTF_8))) {
                                readCsv(reader, aggregates, count);
                            }
                            break;
                        }
                        zip.closeEntry();
                    }
                    if (!foundCsv) {
                        throw new IOException("BTS ZIP file contains no CSV");
                    }
                    flightCount = count[0];
                }
            }
            if (flightCount == 0) {
                throw new IOException("No supported-airport flights found for " + monthKey);
            }

            boolean originalAutoCommit = connection.getAutoCommit();
            connection.setAutoCommit(false);
            try {
                try (PreparedStatement insert = connection.prepareStatement(INSERT_SQL)) {
                    int pending = 0;
                    for (Aggregate aggregate : aggregates.values()) {
                        bindAggregate(insert, aggregate);
                        insert.addBatch();
                        if (++pending == 500) {
                            insert.executeBatch();
                            pending = 0;
                        }
                    }
                    if (pending > 0) {
                        insert.executeBatch();
                    }
                }
                try (PreparedStatement marker = connection.prepareStatement(
                        "INSERT INTO bts_imported_months (month, flight_count) VALUES (?, ?)")) {
                    marker.setString(1, monthKey);
                    marker.setLong(2, flightCount);
                    marker.executeUpdate();
                }
                connection.commit();
                System.out.println("Imported BTS month " + monthKey + " (" + flightCount
                        + " flights, " + aggregates.size() + " aggregate rows)");
            } catch (Exception e) {
                connection.rollback();
                throw e;
            } finally {
                connection.setAutoCommit(originalAutoCommit);
            }
        }
    }

    private static void readCsv(BufferedReader reader, Map<AggregateKey, Aggregate> aggregates,
                                long[] flightCount) throws IOException {
        List<String> headings = readCsvRecord(reader);
        if (headings == null || headings.isEmpty()) {
            throw new IOException("BTS CSV is empty");
        }
        if (!headings.get(0).isEmpty() && headings.get(0).charAt(0) == '\uFEFF') {
            headings.set(0, headings.get(0).substring(1));
        }
        Map<String, Integer> columns = new HashMap<>();
        for (int i = 0; i < headings.size(); i++) {
            columns.put(headings.get(i), i);
        }
        for (String required : REQUIRED_COLUMNS) {
            if (!columns.containsKey(required)) {
                throw new IOException("BTS CSV missing required field " + required);
            }
        }
        List<String> row;
        while ((row = readCsvRecord(reader)) != null) {
            if (row.size() == 1 && row.get(0).isBlank()) {
                continue;
            }
            String airport = cell(row, columns, "Origin");
            if (!AIRPORTS.contains(airport)) {
                continue;
            }
            String date = cell(row, columns, "FlightDate");
            String airline = cell(row, columns, "Reporting_Airline");
            if (!date.matches("\\d{4}-\\d{2}-\\d{2}") || airline.isEmpty()) {
                continue;
            }
            AggregateKey key = new AggregateKey(date, airport, airline);
            Aggregate aggregate = aggregates.computeIfAbsent(key, ignored -> new Aggregate(key));
            aggregate.add(row, columns);
            flightCount[0]++;
        }
    }

    /**
     * Reads one RFC-4180-style record, including quoted commas and embedded newlines.
     */
    private static List<String> readCsvRecord(BufferedReader reader) throws IOException {
        List<String> cells = new ArrayList<>();
        StringBuilder field = new StringBuilder();
        boolean quoted = false;
        boolean any = false;
        while (true) {
            int value = reader.read();
            if (value < 0) {
                if (!any && cells.isEmpty() && field.isEmpty()) {
                    return null;
                }
                cells.add(field.toString());
                return cells;
            }
            any = true;
            char c = (char) value;
            if (quoted) {
                if (c == '"') {
                    reader.mark(1);
                    int next = reader.read();
                    if (next == '"') {
                        field.append('"');
                    } else {
                        quoted = false;
                        if (next >= 0) {
                            reader.reset();
                        }
                    }
                } else {
                    field.append(c);
                }
            } else if (c == '"') {
                quoted = true;
            } else if (c == ',') {
                cells.add(field.toString());
                field.setLength(0);
            } else if (c == '\n') {
                cells.add(stripCarriageReturn(field));
                return cells;
            } else {
                field.append(c);
            }
        }
    }

    private static String stripCarriageReturn(StringBuilder field) {
        int length = field.length();
        if (length > 0 && field.charAt(length - 1) == '\r') {
            field.setLength(length - 1);
        }
        return field.toString();
    }

    private static String cell(List<String> row, Map<String, Integer> columns, String name) {
        int index = columns.get(name);
        return index < row.size() ? row.get(index) : "";
    }

    private static int minutes(String value) {
        if (value.isEmpty()) {
            return 0;
        }
        try {
            double number = Double.parseDouble(value);
            if (!Double.isFinite(number)) {
                return 0;
            }
            return (int) Math.max(0, Math.round(number));
        } catch (NumberFormatException ignored) {
            return 0;
        }
    }

    private static boolean isOne(String value) {
        try {
            return Double.parseDouble(value) == 1.0;
        } catch (NumberFormatException ignored) {
            return false;
        }
    }

    private static void bindAggregate(PreparedStatement statement, Aggregate a) throws SQLException {
        statement.setString(1, a.key.date());
        statement.setString(2, a.key.airport());
        statement.setString(3, a.key.airline());
        statement.setInt(4, a.flights);
        statement.setInt(5, a.departureFlights);
        statement.setInt(6, a.arrivalFlights);
        statement.setInt(7, a.delayedDepartures);
        statement.setInt(8, a.cancelledFlights);
        statement.setInt(9, a.divertedFlights);
        statement.setInt(10, a.totalDepDelayMinutes);
        statement.setInt(11, a.totalArrDelayMinutes);
        statement.setInt(12, a.carrierDelayMinutes);
        statement.setInt(13, a.weatherDelayMinutes);
        statement.setInt(14, a.nasDelayMinutes);
        statement.setInt(15, a.securityDelayMinutes);
        statement.setInt(16, a.lateAircraftDelayMinutes);
    }

    private record AggregateKey(String date, String airport, String airline) {}

    private static final class Aggregate {
        private final AggregateKey key;
        private int flights;
        private int departureFlights;
        private int arrivalFlights;
        private int delayedDepartures;
        private int cancelledFlights;
        private int divertedFlights;
        private int totalDepDelayMinutes;
        private int totalArrDelayMinutes;
        private int carrierDelayMinutes;
        private int weatherDelayMinutes;
        private int nasDelayMinutes;
        private int securityDelayMinutes;
        private int lateAircraftDelayMinutes;

        private Aggregate(AggregateKey key) {
            this.key = key;
        }

        private void add(List<String> row, Map<String, Integer> columns) {
            flights++;
            String departure = cell(row, columns, "DepDelayMinutes");
            if (!departure.isEmpty()) {
                departureFlights++;
                totalDepDelayMinutes += minutes(departure);
            }
            String arrival = cell(row, columns, "ArrDelayMinutes");
            if (!arrival.isEmpty()) {
                arrivalFlights++;
                totalArrDelayMinutes += minutes(arrival);
            }
            if (isOne(cell(row, columns, "DepDel15"))) delayedDepartures++;
            if (isOne(cell(row, columns, "Cancelled"))) cancelledFlights++;
            if (isOne(cell(row, columns, "Diverted"))) divertedFlights++;
            carrierDelayMinutes += minutes(cell(row, columns, "CarrierDelay"));
            weatherDelayMinutes += minutes(cell(row, columns, "WeatherDelay"));
            nasDelayMinutes += minutes(cell(row, columns, "NASDelay"));
            securityDelayMinutes += minutes(cell(row, columns, "SecurityDelay"));
            lateAircraftDelayMinutes += minutes(cell(row, columns, "LateAircraftDelay"));
        }
    }
}