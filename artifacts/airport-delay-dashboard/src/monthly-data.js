export function monthlyPoints(daily, field) {
  const months = new Map();
  for (const item of daily) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(item?.date))) continue;
    const flights = Number(item.flights);
    const value = Number(item[field]);
    if (!Number.isFinite(flights) || flights <= 0 || item[field] == null || !Number.isFinite(value)) continue;
    const month = item.date.slice(0, 7);
    const point = months.get(month) ?? { month, value: 0, flights: 0, days: 0 };
    point.value += value;
    point.flights += flights;
    point.days += 1;
    months.set(month, point);
  }
  return [...months.values()].sort((a, b) => a.month.localeCompare(b.month));
}