import test from 'node:test';
import assert from 'node:assert/strict';
import { monthlyPoints } from '../src/monthly-data.js';

test('monthly bars use only supplied filtered daily rows and retain exact totals', () => {
  const filteredDaily = [
    { date: '2026-02-01', flights: 8, cancelledFlights: 2 },
    { date: '2026-01-02', flights: 10, cancelledFlights: 3 },
    { date: '2026-01-03', flights: 5, cancelledFlights: 0 },
    { date: '2026-01-04', flights: 0, cancelledFlights: 99 },
    { date: '2026-01-05', flights: 20, cancelledFlights: null },
  ];
  assert.deepEqual(monthlyPoints(filteredDaily, 'cancelledFlights'), [
    { month: '2026-01', value: 3, flights: 15, days: 2 },
    { month: '2026-02', value: 2, flights: 8, days: 1 },
  ]);
  assert.deepEqual(monthlyPoints(filteredDaily, 'flights')[0], {
    month: '2026-01', value: 35, flights: 35, days: 3,
  });
});

test('a zero-valued metric month remains inspectable without filling unobserved months', () => {
  assert.deepEqual(monthlyPoints([
    { date: '2026-01-20', flights: 2, nasDelayMinutes: 0 },
    { date: '2026-03-01', flights: 3, nasDelayMinutes: 7 },
    { date: 'not-a-date', flights: 4, nasDelayMinutes: 20 },
  ], 'nasDelayMinutes'), [
    { month: '2026-01', value: 0, flights: 2, days: 1 },
    { month: '2026-03', value: 7, flights: 3, days: 1 },
  ]);
});