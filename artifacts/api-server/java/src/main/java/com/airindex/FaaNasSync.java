package com.airindex;

import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;
import org.xml.sax.InputSource;

import javax.sql.DataSource;
import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilderFactory;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

final class FaaNasSync implements AutoCloseable {
    static final String SOURCE_URL = "https://nasstatus.faa.gov/";
    private static final URI FEED_URI =
            URI.create("https://nasstatus.faa.gov/api/airport-status-information");
    private static final int MAX_FEED_BYTES = 2 * 1024 * 1024;
    private static final Duration MAX_AGE = Duration.ofMinutes(30);
    private static final Duration MAX_SOURCE_CLOCK_SKEW = Duration.ofMinutes(5);
    private static final DateTimeFormatter SOURCE_TIME_FORMAT =
            DateTimeFormatter.ofPattern("EEE MMM d HH:mm:ss yyyy z", Locale.US);
    private static final Set<String> EVENT_RECORD_NAMES = Set.of(
            "Airport", "Ground_Delay", "Ground_Stop",
            "Airport_Closure", "Ground_Delay_Program", "Airport_Delay",
            "Arrival_Delay", "Departure_Delay",
            "Arrival_Stop", "Departure_Stop");

    private final DataSource dataSource;
    private final HttpClient httpClient;
    private final AtomicBoolean polling = new AtomicBoolean();
    private volatile ScheduledExecutorService scheduler;

    FaaNasSync(DataSource dataSource) {
        this.dataSource = dataSource;
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(10))
                .followRedirects(HttpClient.Redirect.NORMAL)
                .build();
    }

    void verifySchema() throws Exception {
        try (Connection connection = dataSource.getConnection()) {
            try (PreparedStatement snapshots = connection.prepareStatement("""
                    SELECT id, fetched_at, source_updated_at, event_count
                    FROM faa_nas_snapshots LIMIT 0
                    """);
                 PreparedStatement events = connection.prepareStatement("""
                    SELECT id, snapshot_id, airport, event_type, reason,
                      average_delay, maximum_delay, start_text, reopen_text
                    FROM faa_nas_events LIMIT 0
                    """)) {
                snapshots.executeQuery().close();
                events.executeQuery().close();
            }
        } catch (java.sql.SQLException exception) {
            throw new IllegalStateException(
                    "FAA NAS database schema is missing or incomplete. Apply "
                            + "artifacts/api-server/java/db/001_faa_nas_status.sql "
                            + "to the development database, then republish so managed "
                            + "Postgres receives the schema.",
                    exception);
        }
    }

    void start() {
        if (scheduler != null) return;
        ScheduledExecutorService created = Executors.newSingleThreadScheduledExecutor(task -> {
            Thread thread = new Thread(task, "faa-nas-status-poller");
            thread.setDaemon(true);
            return thread;
        });
        scheduler = created;
        created.scheduleWithFixedDelay(this::pollSafely, 0, 15, TimeUnit.MINUTES);
    }

    @Override
    public void close() {
        ScheduledExecutorService current = scheduler;
        if (current == null) return;
        current.shutdown();
        try {
            if (!current.awaitTermination(5, TimeUnit.SECONDS)) {
                current.shutdownNow();
                current.awaitTermination(5, TimeUnit.SECONDS);
            }
        } catch (InterruptedException exception) {
            current.shutdownNow();
            Thread.currentThread().interrupt();
        }
    }

    Map<String, Object> status() throws Exception {
        List<String> airportCodes = AirportApi.supportedAirportCodes();
        String placeholders = String.join(", ", airportCodes.stream().map(ignored -> "?").toList());
        String sql = """
                SELECT s.id, s.fetched_at, s.source_updated_at,
                  e.airport, e.event_type, e.reason, e.average_delay, e.maximum_delay,
                  e.start_text, e.reopen_text
                FROM faa_nas_snapshots s
                LEFT JOIN faa_nas_events e
                  ON e.snapshot_id = s.id AND e.airport IN (%s)
                WHERE s.id = (
                  SELECT id FROM faa_nas_snapshots
                  ORDER BY fetched_at DESC, id DESC LIMIT 1
                )
                ORDER BY e.airport, e.event_type, e.id
                """.formatted(placeholders);
        try (Connection connection = dataSource.getConnection();
             PreparedStatement statement = connection.prepareStatement(sql)) {
            for (int i = 0; i < airportCodes.size(); i++) {
                statement.setString(i + 1, airportCodes.get(i));
            }
            try (ResultSet rows = statement.executeQuery()) {
                if (!rows.next()) return unavailableStatus();

                Instant fetchedAt = rows.getTimestamp("fetched_at").toInstant();
                Timestamp sourceTimestamp = rows.getTimestamp("source_updated_at");
                Instant sourceUpdatedAt = sourceTimestamp == null ? null : sourceTimestamp.toInstant();
                Instant now = Instant.now();
                boolean stale = Duration.between(fetchedAt, now).compareTo(MAX_AGE) > 0
                        || (sourceUpdatedAt != null
                        && Duration.between(sourceUpdatedAt, now).compareTo(MAX_AGE) > 0);
                Map<String, List<Map<String, Object>>> eventsByAirport = new LinkedHashMap<>();
                do {
                    String code = rows.getString("airport");
                    if (!stale && code != null) {
                        Map<String, Object> event = new LinkedHashMap<>();
                        event.put("type", rows.getString("event_type"));
                        event.put("reason", rows.getString("reason"));
                        event.put("averageDelay", rows.getString("average_delay"));
                        event.put("maximumDelay", rows.getString("maximum_delay"));
                        event.put("start", rows.getString("start_text"));
                        event.put("reopen", rows.getString("reopen_text"));
                        eventsByAirport.computeIfAbsent(code, ignored -> new ArrayList<>()).add(event);
                    }
                } while (rows.next());
                List<Map<String, Object>> affectedAirports = new ArrayList<>();
                for (Map.Entry<String, List<Map<String, Object>>> entry : eventsByAirport.entrySet()) {
                    Map<String, Object> airport = new LinkedHashMap<>();
                    airport.put("airport", entry.getKey());
                    airport.put("events", entry.getValue());
                    affectedAirports.add(airport);
                }

                Map<String, Object> response = new LinkedHashMap<>();
                response.put("status", stale ? "stale" : "current");
                response.put("checkedAt", fetchedAt.toString());
                response.put("sourceUpdatedAt", sourceUpdatedAt == null ? null : sourceUpdatedAt.toString());
                response.put("sourceUrl", SOURCE_URL);
                response.put("affectedAirportCount", affectedAirports.size());
                response.put("affectedAirports", affectedAirports);
                return response;
            }
        }
    }

    private static Map<String, Object> unavailableStatus() {
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("status", "unavailable");
        response.put("checkedAt", null);
        response.put("sourceUpdatedAt", null);
        response.put("sourceUrl", SOURCE_URL);
        response.put("affectedAirportCount", 0);
        response.put("affectedAirports", List.of());
        return response;
    }

    private void pollSafely() {
        if (!polling.compareAndSet(false, true)) return;
        try {
            Feed feed = fetchFeed();
            saveSnapshot(feed);
            System.out.println("Saved FAA NAS status snapshot with " + feed.events.size() + " events");
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            System.err.println("FAA NAS status poll interrupted");
        } catch (Exception exception) {
            System.err.println("FAA NAS status poll failed: " + exception.getMessage());
        } finally {
            polling.set(false);
        }
    }

    private Feed fetchFeed() throws IOException, InterruptedException {
        HttpRequest request = HttpRequest.newBuilder(FEED_URI)
                .timeout(Duration.ofSeconds(25))
                .header("Accept", "application/xml, text/xml")
                .header("User-Agent", "AirIndex/1.0 (FAA NAS Status archive)")
                .GET()
                .build();
        HttpResponse<java.io.InputStream> response =
                httpClient.send(request, HttpResponse.BodyHandlers.ofInputStream());
        try (java.io.InputStream body = response.body()) {
            if (response.statusCode() != 200) {
                throw new IOException("FAA feed returned HTTP " + response.statusCode());
            }
            String contentType = response.headers().firstValue("content-type")
                    .orElse("").toLowerCase(Locale.ROOT);
            if (!contentType.contains("xml")) {
                throw new IOException("FAA feed returned a non-XML content type");
            }
            byte[] bytes = readLimited(body, MAX_FEED_BYTES);
            try {
                return parseFeed(bytes);
            } catch (IOException exception) {
                throw exception;
            } catch (Exception exception) {
                throw new IOException("FAA feed contained invalid XML", exception);
            }
        }
    }

    private static byte[] readLimited(java.io.InputStream input, int limit) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int total = 0;
        int read;
        while ((read = input.read(buffer)) != -1) {
            total += read;
            if (total > limit) throw new IOException("FAA feed exceeded the size limit");
            output.write(buffer, 0, read);
        }
        return output.toByteArray();
    }

    static Feed parseFeed(byte[] bytes) throws Exception {
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setNamespaceAware(true);
        factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
        factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
        factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
        factory.setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false);
        factory.setXIncludeAware(false);
        factory.setExpandEntityReferences(false);
        factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "");
        factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");

        Document document = factory.newDocumentBuilder()
                .parse(new InputSource(new ByteArrayInputStream(bytes)));
        Element root = document.getDocumentElement();
        if (root == null || !"AIRPORT_STATUS_INFORMATION".equals(localName(root))) {
            throw new IOException("FAA feed did not contain an airport status document");
        }
        String updateTime = childText(root, "Update_Time");
        if (updateTime == null || updateTime.isBlank()) {
            throw new IOException("FAA feed did not include its source update time");
        }
        int categories = 0;
        List<Event> events = new ArrayList<>();
        for (Element category : childElements(root, "Delay_type")) {
            categories++;
            String type = childText(category, "Name");
            if (type == null || type.isBlank()) {
                throw new IOException("FAA feed contained a status category without a name");
            }
            collectEvents(category, type, events);
        }
        if (categories == 0) {
            throw new IOException("FAA feed contained no status categories");
        }
        Instant sourceUpdatedAt = parseSourceTime(updateTime);
        return new Feed(sourceUpdatedAt, List.copyOf(events));
    }

    private static void collectEvents(Element parent, String type, List<Event> events) {
        NodeList children = parent.getChildNodes();
        for (int i = 0; i < children.getLength(); i++) {
            Node node = children.item(i);
            if (!(node instanceof Element element)) continue;
            if (EVENT_RECORD_NAMES.contains(localName(element))) {
                String airport = childText(element, "ARPT");
                if (airport != null) {
                    String code = airport.trim().toUpperCase(Locale.ROOT);
                    if (code.matches("[A-Z0-9]{3,4}")) {
                        events.add(new Event(
                                code,
                                type,
                                childText(element, "Reason"),
                                childText(element, "Avg"),
                                childText(element, "Max"),
                                childText(element, "Start"),
                                childText(element, "Reopen")));
                    }
                }
            } else {
                collectEvents(element, type, events);
            }
        }
    }

    private static List<Element> childElements(Element parent, String name) {
        List<Element> elements = new ArrayList<>();
        NodeList children = parent.getChildNodes();
        for (int i = 0; i < children.getLength(); i++) {
            Node node = children.item(i);
            if (node instanceof Element element && name.equals(localName(element))) {
                elements.add(element);
            }
        }
        return elements;
    }

    private static String childText(Element parent, String name) {
        NodeList children = parent.getChildNodes();
        for (int i = 0; i < children.getLength(); i++) {
            Node node = children.item(i);
            if (node instanceof Element element && name.equals(localName(element))) {
                String text = element.getTextContent().trim();
                return text.isEmpty() ? null : text;
            }
        }
        return null;
    }

    private static String localName(Element element) {
        String name = element.getLocalName();
        if (name != null) return name;
        String qualifiedName = element.getTagName();
        int prefix = qualifiedName.indexOf(':');
        return prefix < 0 ? qualifiedName : qualifiedName.substring(prefix + 1);
    }

    private static Instant parseSourceTime(String value) throws IOException {
        try {
            Instant sourceTime = ZonedDateTime.parse(value.trim(), SOURCE_TIME_FORMAT).toInstant();
            if (sourceTime.isAfter(Instant.now().plus(MAX_SOURCE_CLOCK_SKEW))) {
                throw new IOException("FAA feed update time is more than five minutes in the future");
            }
            return sourceTime;
        } catch (RuntimeException exception) {
            throw new IOException("FAA feed source update time could not be parsed", exception);
        }
    }

    private void saveSnapshot(Feed feed) throws Exception {
        try (Connection connection = dataSource.getConnection()) {
            boolean originalAutoCommit = connection.getAutoCommit();
            connection.setAutoCommit(false);
            try {
                long snapshotId;
                try (PreparedStatement insert = connection.prepareStatement("""
                        INSERT INTO faa_nas_snapshots (fetched_at, source_updated_at, event_count)
                        VALUES (?, ?, ?) RETURNING id
                        """)) {
                    insert.setObject(1, OffsetDateTime.now(ZoneOffset.UTC));
                    if (feed.sourceUpdatedAt == null) {
                        insert.setNull(2, java.sql.Types.TIMESTAMP_WITH_TIMEZONE);
                    } else {
                        insert.setObject(2, feed.sourceUpdatedAt.atOffset(ZoneOffset.UTC));
                    }
                    insert.setInt(3, feed.events.size());
                    try (ResultSet rows = insert.executeQuery()) {
                        if (!rows.next()) throw new IOException("FAA snapshot insert returned no ID");
                        snapshotId = rows.getLong(1);
                    }
                }
                if (!feed.events.isEmpty()) {
                    try (PreparedStatement insert = connection.prepareStatement("""
                            INSERT INTO faa_nas_events
                              (snapshot_id, airport, event_type, reason,
                               average_delay, maximum_delay, start_text, reopen_text)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                            """)) {
                        for (Event event : feed.events) {
                            insert.setLong(1, snapshotId);
                            insert.setString(2, event.airport);
                            insert.setString(3, event.type);
                            insert.setString(4, event.reason);
                            insert.setString(5, event.averageDelay);
                            insert.setString(6, event.maximumDelay);
                            insert.setString(7, event.start);
                            insert.setString(8, event.reopen);
                            insert.addBatch();
                        }
                        insert.executeBatch();
                    }
                }
                connection.commit();
            } catch (Exception exception) {
                connection.rollback();
                throw exception;
            } finally {
                connection.setAutoCommit(originalAutoCommit);
            }
        }
    }

    record Feed(Instant sourceUpdatedAt, List<Event> events) {}

    record Event(
            String airport,
            String type,
            String reason,
            String averageDelay,
            String maximumDelay,
            String start,
            String reopen) {}
}