const airportCode = (a, b) => String(a.airport).localeCompare(String(b.airport));

function compareValues(a, b, order) {
  // Missing denominators are not zero performance; keep them last in either direction.
  if (a == null) return b == null ? 0 : 1;
  if (b == null) return -1;
  return (order === 'highest' ? b - a : a - b);
}

export function nasRaw(item, measure) {
  const minutes = Number(item.nasDelayMinutes);
  if (measure === 'total') return minutes;
  const denominator = Number(measure === 'perArrival' ? item.arrivalFlights : item.attributedDelayMinutes);
  return denominator > 0 ? minutes / denominator : null;
}

export function sortDepartures(rows, order) {
  if (order === 'airport') return [...rows].sort(airportCode);
  return [...rows].sort((a, b) => compareValues(
    Number(a.delayedDepartures) / Number(a.departureFlights),
    Number(b.delayedDepartures) / Number(b.departureFlights),
    order,
  ) || airportCode(a, b));
}

export function sortNas(rows, measure, order) {
  if (order === 'airport') return [...rows].sort(airportCode);
  return [...rows].sort((a, b) =>
    compareValues(nasRaw(a, measure), nasRaw(b, measure), order) || airportCode(a, b));
}