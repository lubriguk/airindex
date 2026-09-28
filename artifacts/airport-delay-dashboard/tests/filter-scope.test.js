import test from 'node:test';
import assert from 'node:assert/strict';
import { airlineChoiceParams, buildDetailParams, unavailableAirlineCodes } from '../src/filter-scope.js';

test('an unmatched airline remains selected when an advanced rule is applied', () => {
  const selected = new Set(['WN']);
  const rules = [{ column: 'flights', operator: 'gte', value: '100' }];
  const filters = { airport: 'ATL', from: '2025-01-01', to: '2025-01-01', airlines: selected, rules };
  const request = buildDetailParams(filters);

  assert.equal(request.get('airport'), 'ATL');
  assert.deepEqual(request.getAll('airline'), ['WN']);
  assert.deepEqual(request.getAll('metric'), ['flights:gte:100']);

  // Availability may contain only other carriers; this is not permission to
  // widen the result query to all airlines.
  assert.deepEqual(unavailableAirlineCodes(selected, [{ code: 'DL' }]), ['WN']);
  assert.deepEqual([...selected], ['WN']);
  assert.deepEqual(buildDetailParams({ ...filters, airport: 'HNL' }).getAll('airline'), ['WN']);
});

test('choice requests omit result constraints without changing the selected filters', () => {
  const selected = new Set(['WN', 'DL']);
  const request = buildDetailParams({
    airport: 'ATL', from: '2025-01-01', to: '2025-01-01', airlines: selected,
    rules: [{ column: 'flights', operator: 'gte', value: '100' }],
  });
  const choices = airlineChoiceParams(request);

  assert.deepEqual(choices.getAll('airline'), []);
  assert.deepEqual(choices.getAll('metric'), []);
  assert.deepEqual(request.getAll('airline'), ['DL', 'WN']);
  assert.deepEqual(request.getAll('metric'), ['flights:gte:100']);
});