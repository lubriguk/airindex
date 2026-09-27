CREATE TABLE IF NOT EXISTS airport_delay_daily (
  flight_date DATE NOT NULL,
  airport VARCHAR(32) NOT NULL,
  airline VARCHAR(32) NOT NULL,
  flights INT NOT NULL,
  departure_flights INT NOT NULL,
  arrival_flights INT NOT NULL,
  delayed_departures INT NOT NULL,
  cancelled_flights INT NOT NULL,
  diverted_flights INT NOT NULL,
  total_dep_delay_minutes INT NOT NULL,
  total_arr_delay_minutes INT NOT NULL,
  carrier_delay_minutes INT NOT NULL,
  weather_delay_minutes INT NOT NULL,
  nas_delay_minutes INT NOT NULL,
  security_delay_minutes INT NOT NULL,
  late_aircraft_delay_minutes INT NOT NULL,
  PRIMARY KEY (flight_date, airport, airline),
  INDEX airport_delay_airport_date_idx (airport, flight_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS bts_imported_months (
  month CHAR(7) NOT NULL PRIMARY KEY,
  flight_count INT NOT NULL,
  imported_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;