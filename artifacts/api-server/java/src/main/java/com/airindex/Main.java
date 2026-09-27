package com.airindex;

import com.sun.net.httpserver.HttpServer;
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.Statement;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;

public final class Main {
    private Main() {}

    public static void main(String[] args) throws Exception {
        String url = required("MYSQL_JDBC_URL");
        if (!url.startsWith("jdbc:mysql://")) {
            throw new IllegalArgumentException("MYSQL_JDBC_URL must be a jdbc:mysql:// URL");
        }
        URI location = URI.create(url.substring("jdbc:".length()));
        String host = location.getHost();
        if (host == null) throw new IllegalArgumentException("MYSQL_JDBC_URL needs a valid host");
        boolean local = host.equalsIgnoreCase("localhost") || host.equals("127.0.0.1")
                || host.equals("::1");
        if (!local && (location.getRawQuery() == null ||
                !location.getRawQuery().matches("(?i)(?:^|.*&)sslMode=VERIFY_IDENTITY(?:&.*|$)"))) {
            throw new IllegalArgumentException(
                    "Remote MySQL connections require sslMode=VERIFY_IDENTITY and a trusted server CA");
        }
        HikariConfig config = new HikariConfig();
        config.setJdbcUrl(url);
        config.setUsername(required("MYSQL_USER"));
        config.setPassword(required("MYSQL_PASSWORD"));
        config.setMaximumPoolSize(10);
        config.setConnectionTimeout(15_000);
        config.setConnectionInitSql("SET time_zone = '+00:00'");
        config.setPoolName("airindex-mysql");
        try (HikariDataSource database = new HikariDataSource(config)) {
            initializeSchema(database);
            if (args.length == 1 && "migrate".equals(args[0])) {
                DataMigrator.migrate(database);
                return;
            }
            if (args.length != 0) {
                throw new IllegalArgumentException("Usage: java -jar airport-delay-api-1.0.0.jar [migrate]");
            }
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

    private static void initializeSchema(HikariDataSource database) throws Exception {
        String sql;
        try (var stream = Main.class.getResourceAsStream("/schema.sql")) {
            if (stream == null) throw new IOException("Missing schema.sql resource");
            sql = new String(stream.readAllBytes(), StandardCharsets.UTF_8);
        }
        try (Connection connection = database.getConnection();
             Statement statement = connection.createStatement()) {
            for (String command : sql.split(";")) {
                if (!command.isBlank()) statement.execute(command.trim());
            }
        }
    }
}