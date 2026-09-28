import test from 'node:test';
import assert from 'node:assert/strict';
import { airlineChoiceParams, buildDetailParams, unavailableAirlineCodes } from '../src/filter-scope.js';

test('an unmatched airline remains selected when airport or date changes', () => {
  const selected = new Set(['WN']);
  const filters = { airport: 'ATL', from: '2025-01-01', to: '2025-01-01', airlines: selected };
  const request = buildDetailParams(filters);

  assert.equal(request.get('airport'), 'ATL');
  assert.deepEqual(request.getAll('airline'), ['WN']);
  assert.deepEqual(request.getAll('metric'), []);

  // Availability may contain only other carriers; this is not permission to
  // widen the result query to all airlines.
  assert.deepEqual(unavailableAirlineCodes(selected, [{ code: 'DL' }]), ['WN']);
  assert.deepEqual([...selected], ['WN']);
  assert.deepEqual(buildDetailParams({ ...filters, airport: 'HNL' }).getAll('airline'), ['WN']);
  assert.deepEqual(buildDetailParams({ ...filters, from: '2025-02-01' }).getAll('airline'), ['WN']);
});

test('choice requests omit result constraints without changing the selected filters', () => {
  const selected = new Set(['WN', 'DL']);
  const request = buildDetailParams({
    airport: 'ATL', from: '2025-01-01', to: '2025-01-01', airlines: selected,
  });
  const choices = airlineChoiceParams(request);

  assert.deepEqual(choices.getAll('airline'), []);
  assert.deepEqual(choices.getAll('metric'), []);
  assert.deepEqual(request.getAll('airline'), ['DL', 'WN']);
  assert.equal(choices.get('from'), '2025-01-01');
});