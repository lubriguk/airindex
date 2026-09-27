package com.airindex;

import com.sun.net.httpserver.HttpServer;
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.Statement;
import java.util.Properties;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;

public final class Main {
    private Main() {}

    public static void main(String[] args) throws Exception {
        if (args.length != 0) throw new IllegalArgumentException("Usage: java -jar airport-delay-api-1.0.0.jar");
        ConnectionSettings settings = connectionSettings(required("DATABASE_URL"));
        HikariConfig config = new HikariConfig();
        config.setJdbcUrl(settings.url());
        if (settings.properties().containsKey("user")) {
            config.setUsername(settings.properties().getProperty("user"));
        }
        if (settings.properties().containsKey("password")) {
            config.setPassword(settings.properties().getProperty("password"));
        }
        config.setMaximumPoolSize(10);
        config.setConnectionTimeout(15_000);
        config.setConnectionInitSql("SET TIME ZONE 'UTC'");
        config.setPoolName("airindex-postgresql");
        try (HikariDataSource database = new HikariDataSource(config)) {
            verifyExistingTables(database);
            int port = Integer.parseInt(required("PORT"));
            HttpServer server = HttpServer.create(new InetSocketAddress("0.0.0.0", port), 0);
            BtsSync sync = new BtsSync(database);
            new AirportApi(database, sync::isImporting).register(server);
            server.setExecutor(Executors.newFixedThreadPool(12));
            Runtime.getRuntime().addShutdownHook(new Thread(() -> {
                server.stop(2);
                sync.close();
            }));
            server.start();
            sync.start();
            System.out.println("Java airport API listening on " + port);
            // HttpServer runs on its own threads; keep main alive until shutdown.
            new CountDownLatch(1).await();
        }
    }

    private static String required(String key) {
        String value = System.getenv(key);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException(key + " is required");
        }
        return value;
    }

    private record ConnectionSettings(String url, Properties properties) {}

    private static ConnectionSettings connectionSettings(String value) {
        if (value.startsWith("jdbc:postgresql://")) {
            return new ConnectionSettings(value, new Properties());
        }
        URI uri = URI.create(value);
        if (!"postgres".equalsIgnoreCase(uri.getScheme())
                && !"postgresql".equalsIgnoreCase(uri.getScheme())) {
            throw new IllegalArgumentException("DATABASE_URL must be a PostgreSQL URL");
        }
        if (uri.getHost() == null || uri.getRawPath() == null || uri.getRawPath().length() < 2) {
            throw new IllegalArgumentException("DATABASE_URL needs a host and database name");
        }
        StringBuilder jdbc = new StringBuilder("jdbc:postgresql://").append(uri.getHost());
        if (uri.getPort() >= 0) jdbc.append(':').append(uri.getPort());
        jdbc.append(uri.getRawPath());
        if (uri.getRawQuery() != null) jdbc.append('?').append(uri.getRawQuery());
        Properties properties = new Properties();
        if (uri.getRawUserInfo() != null) {
            String[] credentials = uri.getRawUserInfo().split(":", 2);
            properties.setProperty("user", decode(credentials[0]));
            if (credentials.length > 1) properties.setProperty("password", decode(credentials[1]));
        }
        return new ConnectionSettings(jdbc.toString(), properties);
    }

    private static String decode(String value) {
        // URLDecoder treats a literal '+' as a space; URI userinfo does not.
        return URLDecoder.decode(value.replace("+", "%2B"), StandardCharsets.UTF_8);
    }

    private static void verifyExistingTables(HikariDataSource database) throws Exception {
        try (Connection connection = database.getConnection();
             Statement statement = connection.createStatement()) {
            statement.executeQuery("SELECT 1 FROM airport_delay_daily LIMIT 1").close();
            statement.executeQuery("SELECT 1 FROM bts_imported_months LIMIT 1").close();
        }
    }
}