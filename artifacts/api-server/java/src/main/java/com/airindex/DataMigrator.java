package com.airindex;

import javax.sql.DataSource;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.Date;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Calendar;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.TimeZone;

/**
 * Copies existing PostgreSQL BTS tables into the configured MySQL database.
 */
public final class DataMigrator {
    private static final int BATCH_SIZE = 500;
    private static final Calendar UTC = Calendar.getInstance(TimeZone.getTimeZone("UTC"));
    private static final DateTimeFormatter MYSQL_TIMESTAMP =
            DateTimeFormatter.ofPattern("uuuu-MM-dd HH:mm:ss.SSSSSS");
    private static final String DAILY_INSERT = """
            INSERT INTO airport_delay_daily
            (flight_date, airport, airline, flights, departure_flights, arrival_flights,
             delayed_departures, cancelled_flights, diverted_flights,
             total_dep_delay_minutes, total_arr_delay_minutes, carrier_delay_minutes,
             weather_delay_minutes, nas_delay_minutes, security_delay_minutes,
             late_aircraft_delay_minutes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              flights = VALUES(flights),
              departure_flights = VALUES(departure_flights),
              arrival_flights = VALUES(arrival_flights),
              delayed_departures = VALUES(delayed_departures),
              cancelled_flights = VALUES(cancelled_flights),
              diverted_flights = VALUES(diverted_flights),
              total_dep_delay_minutes = VALUES(total_dep_delay_minutes),
              total_arr_delay_minutes = VALUES(total_arr_delay_minutes),
              carrier_delay_minutes = VALUES(carrier_delay_minutes),
              weather_delay_minutes = VALUES(weather_delay_minutes),
              nas_delay_minutes = VALUES(nas_delay_minutes),
              security_delay_minutes = VALUES(security_delay_minutes),
              late_aircraft_delay_minutes = VALUES(late_aircraft_delay_minutes)
            """;

    private DataMigrator() {}

    /**
     * Migrates all date months and marker months. Each month is committed separately;
     * a failed month rolls back without affecting the other months.
     */
    public static void migrate(DataSource target) throws SQLException {
        String sourceUrl = requiredEnvironment("DATABASE_URL");
        SourceConfig source = sourceConfig(sourceUrl);

        try (Connection postgres = DriverManager.getConnection(source.jdbcUrl(), source.properties());
             Connection targetConnection = target.getConnection()) {
            postgres.setReadOnly(true);
            postgres.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ);
            postgres.setAutoCommit(false);
            List<String> months = sourceMonths(postgres);
            for (String month : months) {
                migrateMonth(postgres, targetConnection, month);
            }
            postgres.commit();
            if (!months.equals(sourceMonths(postgres))) {
                throw new SQLException("PostgreSQL months changed during migration; rerun to catch up");
            }
        }
    }

    private static String requiredEnvironment(String key) {
        String value = System.getenv(key);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("Required environment variable " + key + " is not set");
        }
        return value;
    }

    private record SourceConfig(String jdbcUrl, Properties properties) {}

    private static SourceConfig sourceConfig(String value) {
        if (value.startsWith("jdbc:postgresql:")) {
            return new SourceConfig(value, new Properties());
        }
        try {
            URI uri = URI.create(value);
            String scheme = uri.getScheme();
            if (!"postgres".equalsIgnoreCase(scheme) && !"postgresql".equalsIgnoreCase(scheme)) {
                throw new IllegalArgumentException("DATABASE_URL must be a PostgreSQL URL");
            }
            StringBuilder jdbc = new StringBuilder("jdbc:postgresql://").append(uri.getHost());
            if (uri.getPort() >= 0) {
                jdbc.append(':').append(uri.getPort());
            }
            String path = uri.getRawPath();
            if (path != null) {
                jdbc.append(path);
            }
            if (uri.getRawQuery() != null) {
                jdbc.append('?').append(uri.getRawQuery());
            }
            Properties properties = new Properties();
            String userInfo = uri.getRawUserInfo();
            if (userInfo != null) {
                String[] pair = userInfo.split(":", 2);
                properties.setProperty("user", decode(pair[0]));
                if (pair.length > 1) {
                    properties.setProperty("password", decode(pair[1]));
                }
            }
            return new SourceConfig(jdbc.toString(), properties);
        } catch (RuntimeException e) {
            throw new IllegalArgumentException("Could not convert DATABASE_URL to a PostgreSQL JDBC URL", e);
        }
    }

    private static String decode(String value) {
        return URLDecoder.decode(value, StandardCharsets.UTF_8);
    }

    private static List<String> sourceMonths(Connection postgres) throws SQLException {
        List<String> months = new ArrayList<>();
        String sql = """
                SELECT month_key FROM (
                    SELECT to_char(flight_date, 'YYYY-MM') AS month_key FROM airport_delay_daily
                    UNION
                    SELECT month FROM bts_imported_months
                ) months
                ORDER BY month_key
                """;
        try (PreparedStatement statement = postgres.prepareStatement(sql);
             ResultSet result = statement.executeQuery()) {
            while (result.next()) {
                months.add(result.getString(1));
            }
        }
        return months;
    }

    private static void migrateMonth(Connection postgres, Connection target, String month) throws SQLException {
        String[] parts = month.split("-", 2);
        if (parts.length != 2) {
            throw new SQLException("Invalid imported month in source database: " + month);
        }
        Date from;
        Date to;
        try {
            int year = Integer.parseInt(parts[0]);
            int monthOfYear = Integer.parseInt(parts[1]);
            from = Date.valueOf(java.time.LocalDate.of(year, monthOfYear, 1));
            to = Date.valueOf(java.time.LocalDate.of(year, monthOfYear, 1).plusMonths(1));
        } catch (RuntimeException e) {
            throw new SQLException("Invalid imported month in source database: " + month, e);
        }

        boolean originalAutoCommit = target.getAutoCommit();
        target.setAutoCommit(false);
        try {
            copyDailyRows(postgres, target, from, to);
            copyMonthMarker(postgres, target, month);
            verifyMonth(postgres, target, from, to, month);
            target.commit();
            System.out.println("Migrated PostgreSQL BTS month " + month);
        } catch (SQLException e) {
            target.rollback();
            throw e;
        } finally {
            target.setAutoCommit(originalAutoCommit);
        }
    }

    private static void copyDailyRows(Connection postgres, Connection target, Date from, Date to)
            throws SQLException {
        String select = """
                SELECT flight_date, airport, airline, flights, departure_flights, arrival_flights,
                       delayed_departures, cancelled_flights, diverted_flights,
                       total_dep_delay_minutes, total_arr_delay_minutes, carrier_delay_minutes,
                       weather_delay_minutes, nas_delay_minutes, security_delay_minutes,
                       late_aircraft_delay_minutes
                FROM airport_delay_daily
                WHERE flight_date >= ? AND flight_date < ?
                ORDER BY flight_date, airport, airline
                """;
        try (PreparedStatement query = postgres.prepareStatement(select,
                    ResultSet.TYPE_FORWARD_ONLY, ResultSet.CONCUR_READ_ONLY);
             PreparedStatement insert = target.prepareStatement(DAILY_INSERT)) {
            query.setDate(1, from);
            query.setDate(2, to);
            query.setFetchSize(BATCH_SIZE);
            try (ResultSet rows = query.executeQuery()) {
                int pending = 0;
                while (rows.next()) {
                    insert.setDate(1, rows.getDate(1));
                    insert.setString(2, rows.getString(2));
                    insert.setString(3, rows.getString(3));
                    for (int column = 4; column <= 16; column++) {
                        insert.setInt(column, rows.getInt(column));
                    }
                    insert.addBatch();
                    if (++pending == BATCH_SIZE) {
                        insert.executeBatch();
                        pending = 0;
                    }
                }
                if (pending > 0) {
                    insert.executeBatch();
                }
            }
        }
    }

    private static void copyMonthMarker(Connection postgres, Connection target, String month) throws SQLException {
        String select = "SELECT flight_count, imported_at FROM bts_imported_months WHERE month = ?";
        try (PreparedStatement query = postgres.prepareStatement(select);
             PreparedStatement insert = target.prepareStatement("""
                     INSERT INTO bts_imported_months (month, flight_count, imported_at)
                     VALUES (?, ?, ?)
                     ON DUPLICATE KEY UPDATE
                       flight_count = VALUES(flight_count),
                       imported_at = VALUES(imported_at)
                     """)) {
            query.setString(1, month);
            try (ResultSet result = query.executeQuery()) {
                if (!result.next()) {
                    return;
                }
                insert.setString(1, month);
                insert.setInt(2, result.getInt("flight_count"));
                Timestamp importedAt = result.getTimestamp("imported_at", UTC);
                if (importedAt == null) {
                    insert.setNull(3, java.sql.Types.TIMESTAMP);
                } else {
                    insert.setString(3, LocalDateTime.ofInstant(importedAt.toInstant(), ZoneOffset.UTC)
                            .format(MYSQL_TIMESTAMP));
                }
                insert.executeUpdate();
            }
        }
    }

    private static void verifyMonth(Connection postgres, Connection target, Date from, Date to, String month)
            throws SQLException {
        String sql = """
                SELECT flight_date, airport, airline, flights, departure_flights, arrival_flights,
                       delayed_departures, cancelled_flights, diverted_flights,
                       total_dep_delay_minutes, total_arr_delay_minutes, carrier_delay_minutes,
                       weather_delay_minutes, nas_delay_minutes, security_delay_minutes,
                       late_aircraft_delay_minutes
                FROM airport_delay_daily WHERE flight_date >= ? AND flight_date < ?
                """;
        Map<String, long[]> expected = new HashMap<>();
        try (PreparedStatement query = postgres.prepareStatement(sql)) {
            query.setDate(1, from);
            query.setDate(2, to);
            try (ResultSet rows = query.executeQuery()) {
                while (rows.next()) expected.put(rowKey(rows), metrics(rows));
            }
        }
        try (PreparedStatement query = target.prepareStatement(sql)) {
            query.setDate(1, from);
            query.setDate(2, to);
            try (ResultSet rows = query.executeQuery()) {
                while (rows.next()) {
                    String key = rowKey(rows);
                    long[] source = expected.remove(key);
                    if (source == null || !Arrays.equals(source, metrics(rows))) {
                        throw new SQLException("MySQL aggregate differs from PostgreSQL for " + month + ": " + key);
                    }
                }
            }
        }
        if (!expected.isEmpty()) {
            throw new SQLException("MySQL is missing " + expected.size() + " aggregate rows for " + month);
        }
        String marker = "SELECT flight_count, imported_at FROM bts_imported_months WHERE month = ?";
        try (PreparedStatement sourceQuery = postgres.prepareStatement(marker);
             PreparedStatement targetQuery = target.prepareStatement(marker)) {
            sourceQuery.setString(1, month);
            targetQuery.setString(1, month);
            try (ResultSet sourceRows = sourceQuery.executeQuery();
                 ResultSet targetRows = targetQuery.executeQuery()) {
                boolean sourceExists = sourceRows.next();
                boolean targetExists = targetRows.next();
                if (sourceExists != targetExists || (sourceExists &&
                        (sourceRows.getInt(1) != targetRows.getInt(1) ||
                         !sourceRows.getTimestamp(2, UTC).toInstant()
                                 .equals(targetRows.getTimestamp(2, UTC).toInstant())))) {
                    throw new SQLException("MySQL month marker differs from PostgreSQL for " + month);
                }
            }
        }
    }

    private static String rowKey(ResultSet row) throws SQLException {
        return row.getDate(1) + "|" + row.getString(2) + "|" + row.getString(3);
    }

    private static long[] metrics(ResultSet row) throws SQLException {
        long[] values = new long[13];
        for (int column = 4; column <= 16; column++) values[column - 4] = row.getLong(column);
        return values;
    }
}