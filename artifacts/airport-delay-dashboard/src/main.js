import { disposeChart, renderDailyChart, renderMonthlyChart, renderWeekdayChart } from './charts.js';
import { nasRaw, sortDepartures, sortNas } from './comparison-sort.js';
import { airlineName, airlineLabel } from './airlines.js';
import { airlineChoiceParams, buildDetailParams, unavailableAirlineCodes } from './filter-scope.js';
import { monthlyPoints } from './monthly-data.js';

const CODES = ['ATL', 'DFW', 'DEN', 'ORD', 'LAX', 'JFK', 'LGA', 'EWR', 'SFO', 'SEA', 'CLT', 'PHX', 'MIA', 'PHL', 'DCA', 'IAD', 'IAH', 'DTW', 'MSP', 'SLC', 'BOS', 'PDX', 'ANC', 'HNL', 'DAL', 'HOU', 'MDW', 'BWI', 'LAS', 'MCO', 'FLL', 'SJU'];
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const RAW_METRICS = [
  ['flights', 'Flights', 'flights'],
  ['departure_flights', 'Departure flights', 'departureFlights'],
  ['arrival_flights', 'Arrival flights', 'arrivalFlights'],
  ['delayed_departures', 'Delayed departures', 'delayedDepartures'],
  ['cancelled_flights', 'Cancelled flights', 'cancelledFlights'],
  ['diverted_flights', 'Diverted flights', 'divertedFlights'],
  ['total_dep_delay_minutes', 'Total departure delay minutes', 'totalDepDelayMinutes'],
  ['total_arr_delay_minutes', 'Total arrival delay minutes', 'totalArrDelayMinutes'],
  ['carrier_delay_minutes', 'Carrier delay minutes', 'carrierDelayMinutes'],
  ['weather_delay_minutes', 'Weather delay minutes', 'weatherDelayMinutes'],
  ['nas_delay_minutes', 'NAS delay minutes', 'nasDelayMinutes'],
  ['security_delay_minutes', 'Security delay minutes', 'securityDelayMinutes'],
  ['late_aircraft_delay_minutes', 'Late aircraft delay minutes', 'lateAircraftDelayMinutes'],
];
const HEADLINE_METRICS = [
  ['on-time', 'On-time departures', 'onTimeDeparturePct', '%', 'Departed less than 15 minutes late'],
  ['scheduled', 'Flights scheduled', 'flights', '', 'Reported departures in this selection'],
  ['average-delay', 'Avg departure delay', 'avgDepartureDelayMinutes', ' min', 'Average across reported departures'],
  ['cancellation-rate', 'Cancellation rate', 'cancellationPct', '%', 'Share of reported flights cancelled'],
];
const DEFAULT_METRICS = HEADLINE_METRICS.map(([id]) => id);
const fmt = new Intl.NumberFormat('en-US');
const $ = (id) => document.getElementById(id);
const apiRoot = new URL('api/', new URL(import.meta.env.BASE_URL, window.location.origin));
const state = {
  airports: { pending: true }, status: { pending: true },
  results: {}, resultsKey: '', requestId: 0, controller: null, metadataId: 0,
  airlineOptions: { pending: true }, airlineRequestId: 0, airlineController: null, airlineLoad: null,
  airlines: new Set(), rules: [], appliedRules: [], nextRuleId: 1,
  shownMetrics: new Set(DEFAULT_METRICS), appliedMetrics: new Set(DEFAULT_METRICS),
  compare: { pending: true }, compareRequestId: 0, compareController: null, activeView: 'detail',
  nasMeasure: 'perArrival', expandedRankings: { departure: false, nas: false },
  departureSort: 'highest', nasSort: 'highest',
  hubOptions: { pending: true }, hubOptionsRequestId: 0,
  hubAirline: '', hubResults: { pending: true }, hubRequestId: 0, hubController: null, hubSort: 'highest',
  faa: { pending: true }, faaRequestId: 0, faaLastChecked: 0,
};
const paths = {
  summary: 'delays/summary', daily: 'delays/daily', carriers: 'delays/carriers',
  causes: 'delays/causes', weekday: 'delays/weekday',
};
let dateInputTimer;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

function number(value) {
  return Number.isFinite(value) ? fmt.format(value) : '—';
}

function one(value) {
  return Number.isFinite(value) ? value.toFixed(1) : '—';
}

function dateLabel(value, short = false) {
  if (!value) return 'Not available';
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat('en-US', short
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' },
  ).format(new Date(year, month - 1, day));
}

function coverageBounds() {
  if (state.status.error || !state.status.data) return null;
  const first = String(state.status.data.firstDate || '').slice(0, 10);
  const last = String(state.status.data.lastDate || '').slice(0, 10);
  const realDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s)
    && !Number.isNaN(Date.parse(`${s}T00:00:00Z`))
    && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
  return realDate(first) && realDate(last) && first <= last ? { first, last } : null;
}

function validateDatePair(fromId, toId, errorId) {
  const bounds = coverageBounds();
  const fromInput = $(fromId);
  const toInput = $(toId);
  const from = fromInput.value;
  const to = toInput.value;
  const invalidFormat = [fromInput, toInput].some((input) => input.validity.badInput
    || (input.value && !/^\d{4}-\d{2}-\d{2}$/.test(input.value)));
  const outside = bounds && [from, to].some((value) => value && (value < bounds.first || value > bounds.last));
  const inverted = from && to && from > to;
  const message = invalidFormat ? 'Enter a valid date in the date fields.'
    : (from || to) && !bounds
      ? state.status.pending
        ? 'BTS date coverage is loading. Date-filtered charts are paused until the available range can be verified. Clear the dates to view all available records.'
        : 'BTS date coverage is unavailable. Cannot verify whether these dates are inside the available range, so date-filtered charts are paused. Clear the dates to view all available records, or retry coverage.'
    : outside ? `Date outside available range: BTS overall coverage is ${dateLabel(bounds.first)} through ${dateLabel(bounds.last)}. Correct the date or choose All dates.`
      : inverted ? 'Start date must be on or before end date. Correct the dates or choose All dates.' : '';
  $(errorId).textContent = message;
  $(errorId).hidden = !message;
  fromInput.setAttribute('aria-invalid', String(!!message));
  toInput.setAttribute('aria-invalid', String(!!message));
  return !message;
}

function faaTime(value) {
  if (!value || Number.isNaN(Date.parse(value))) return null;
  return `${new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(value))} UTC`;
}

function validFaaPayload(data) {
  if (!data || !['current', 'stale', 'unavailable'].includes(data.status)) return false;
  if (data.status !== 'current') return true;
  return Number.isInteger(data.affectedAirportCount) && data.affectedAirportCount >= 0
    && Array.isArray(data.affectedAirports)
    && data.affectedAirportCount === data.affectedAirports.length
    && new Set(data.affectedAirports.map((entry) => entry?.airport)).size === data.affectedAirports.length
    && data.affectedAirports.every((entry) => entry && typeof entry.airport === 'string'
      && entry.airport.trim() && Array.isArray(entry.events) && entry.events.length
      && entry.events.every((event) => event && typeof event === 'object'
        && !Array.isArray(event) && typeof event.type === 'string' && typeof event.reason === 'string'));
}

function renderFaa() {
  const { faa } = state;
  const current = faa.data?.status === 'current';
  const count = faa.data?.affectedAirportCount;
  let summary;
  if (faa.pending) summary = `${loading(74)}`;
  else if (faa.error || faa.data?.status === 'unavailable' || !faa.data) {
    summary = `<span class="faa-warning">FAA advisory feed unavailable — current conditions cannot be confirmed.</span><button type="button" data-action="retry-faa" data-testid="button-retry-faa">Try again</button>`;
  } else if (faa.data.status === 'stale') {
    summary = `<span class="faa-warning">FAA advisory feed is stale — current conditions cannot be confirmed.</span><button type="button" data-action="retry-faa" data-testid="button-retry-faa">Try again</button>`;
  } else {
    summary = `<strong data-testid="text-faa-affected-count">${number(count)}</strong> app-tracked ${count === 1 ? 'airport has' : 'airports have'} current FAA ${count === 1 ? 'advisory' : 'advisories'} (ground stops, delays, closures or other feed events).`;
  }
  if (!faa.pending && faa.data) {
    const checked = faaTime(faa.data.checkedAt);
    const updated = faaTime(faa.data.sourceUpdatedAt);
    summary += `<small>${checked ? `Checked ${escapeHtml(checked)}` : 'Check time unavailable'}${updated ? ` · FAA source updated ${escapeHtml(updated)}` : ''}</small>`;
  }
  $('faa-detail-summary').innerHTML = summary;
  $('faa-compare-summary').innerHTML = summary;
  const code = $('airport').value || 'ATL';
  const target = $('faa-airport-events');
  if (faa.pending) { target.innerHTML = ''; return; }
  target.innerHTML = `<h3>Selected airport / ${escapeHtml(code)}</h3>`;
  if (!current) {
    target.innerHTML += `<p class="faa-empty">Current advisory status for ${escapeHtml(code)} cannot be confirmed. Check the official FAA source.</p>`;
    return;
  }
  const events = (Array.isArray(faa.data.affectedAirports) ? faa.data.affectedAirports : [])
    .find((entry) => entry.airport === code)?.events;
  if (!Array.isArray(events) || !events.length) {
    target.innerHTML += `<p class="faa-empty" data-testid="status-faa-airport-clear">No current FAA advisory for ${escapeHtml(code)}. The global count above includes other app-tracked airports.</p>`;
    return;
  }
  const source = faa.data.sourceUrl === 'https://nasstatus.faa.gov/' ? faa.data.sourceUrl : 'https://nasstatus.faa.gov/';
  target.innerHTML += `<ul class="faa-event-list">${events.map((event, index) => {
    const optional = [
      ['Average delay', event.averageDelay], ['Maximum delay', event.maximumDelay],
      ['Start', event.start], ['Reopen / expected end', event.reopen],
    ].filter(([, value]) => value != null && String(value).trim() !== '');
    return `<li class="faa-event" data-testid="card-faa-event-${index}"><span class="faa-event-type">${escapeHtml(event.type || 'FAA advisory')}</span><p><strong>Restriction / reason:</strong> ${escapeHtml(event.reason || 'No reason supplied by FAA.')}</p>${optional.length ? `<dl>${optional.map(([label, value]) => `<dt>${label}</dt><dd>${escapeHtml(value)}</dd>`).join('')}</dl>` : ''}<p><a href="${source}" target="_blank" rel="noopener noreferrer" data-testid="link-faa-event-${index}">View official FAA source ↗</a></p></li>`;
  }).join('')}</ul>`;
}

async function loadFaa(force = false) {
  if (!force && state.faaLastChecked && Date.now() - state.faaLastChecked < 15 * 60 * 1000) {
    renderFaa();
    return;
  }
  const id = ++state.faaRequestId;
  state.faa = { pending: true };
  renderFaa();
  try {
    const data = await request('nas-status');
    if (id !== state.faaRequestId) return;
    if (!validFaaPayload(data)) throw new Error('Invalid FAA feed');
    state.faa = { data };
  } catch {
    if (id !== state.faaRequestId) return;
    state.faa = { error: true };
  }
  state.faaLastChecked = Date.now();
  renderFaa();
}

function loading(height = 220) {
  return `<div aria-label="Loading data" role="status" class="loading-box" style="height:${height}px"><div class="skeleton" style="width:28%"></div><div class="skeleton" style="width:76%;height:40%"></div><div class="skeleton" style="width:95%"></div></div>`;
}

function empty(message, error = false) {
  return `<div class="state-box" role="${error ? 'alert' : 'status'}" data-testid="status-${error ? 'error' : 'empty'}"><span class="state-icon" aria-hidden="true">${error ? '!' : '◌'}</span><strong>${error ? 'Could not load this view' : 'No observations in this view'}</strong><p>${escapeHtml(message)}</p>${error ? '<button type="button" data-action="retry" data-testid="button-retry-section">Try again</button>' : ''}</div>`;
}

function legend(secondary = false) {
  return `<div class="chart-legend"><span class="legend-item"><i class="legend-swatch" style="background:#217f89"></i> On-time departures</span>${secondary ? '<span class="legend-item"><i class="legend-swatch" style="background:#d99b4c"></i> Departure delay, min</span>' : ''}</div>`;
}

function metric(label, value, note) {
  return `<div class="metric"><div class="metric-label">${label}</div><div class="metric-value" data-testid="text-metric-${label.toLowerCase().replace(/\W+/g, '-')}">${escapeHtml(value)}</div><div class="metric-note">${escapeHtml(note)}</div></div>`;
}

function renderAirlineSelection() {
  const { airlineOptions, airlines } = state;
  const selectedCodes = [...airlines].sort();
  const unavailable = unavailableAirlineCodes(airlines, airlineOptions.data ?? []);
  const note = $('airline-scope-note');
  note.textContent = airlineOptions.error
    ? 'Airline availability could not be checked. Your airline selection remains applied; open the list to retry.'
    : !airlineOptions.pending && !airlineOptions.invalid && unavailable.length
      ? `${unavailable.map(airlineLabel).join(', ')} ${unavailable.length === 1 ? 'has' : 'have'} no reported flights for this airport and date range. ${unavailable.length === airlines.size ? 'No flights match the selected airline filter here.' : 'Other selected airlines may still match.'} Your selection remains applied until you clear it.`
      : '';
  note.hidden = !note.textContent;
  $('clear-airlines').hidden = !airlines.size;
  $('airline-value').textContent = selectedCodes.length ? selectedCodes.map(airlineLabel).join(', ')
    : airlineOptions.invalid ? 'Choose valid dates'
      : airlineOptions.pending ? 'Checking available airlines…'
        : airlineOptions.error ? 'Airlines unavailable — retry'
          : !airlineOptions.data?.length ? 'No airlines with records' : 'All available airlines';
  updateQueryChips();
}

function renderAirlines() {
  const { airlineOptions, airlines } = state;
  const codes = (Array.isArray(airlineOptions.data) ? airlineOptions.data : [])
    .map((item) => item.code);
  renderAirlineSelection();
  $('airline-trigger').disabled = !!airlineOptions.pending || !!airlineOptions.invalid
    || (!airlineOptions.error && !codes.length);
  $('airline-options').innerHTML = airlineOptions.pending ? loading(90)
    : airlineOptions.error ? `<div class="airline-menu-note" role="alert">Could not load airlines. <button type="button" data-action="retry-airlines" data-testid="button-retry-airlines">Try again</button></div>`
      : !codes.length ? '<p class="airline-menu-note">No airlines have reported flights for this selection.</p>'
        : codes.sort().map((code) => `<label class="airline-option"><input type="checkbox" value="${escapeHtml(code)}" ${airlines.has(code) ? 'checked' : ''} data-testid="checkbox-airline-${escapeHtml(code)}"><span class="airline-name">${escapeHtml(airlineName(code))}</span><span class="airline-code">${escapeHtml(code)}</span></label>`).join('');
}

function invalidateAirlineOptions() {
  state.airlineController?.abort();
  ++state.airlineRequestId;
  state.airlineLoad = null;
  state.airlineOptions = { invalid: true };
  $('airline-menu').hidden = true;
  $('airline-trigger').setAttribute('aria-expanded', 'false');
  renderAirlines();
}

async function loadAvailableAirlines(force = false) {
  if (!validateDates()) {
    invalidateAirlineOptions();
    return false;
  }
  // Options reflect source coverage, not downstream airline and record rules.
  const params = airlineChoiceParams(filterValues());
  const scopeKey = params.toString();
  if (state.airlineLoad?.key === scopeKey) return state.airlineLoad.promise;
  if (!force && state.airlineOptions.scopeKey === scopeKey
      && Array.isArray(state.airlineOptions.data)) return false;

  state.airlineController?.abort();
  const id = ++state.airlineRequestId;
  const controller = new AbortController();
  state.airlineController = controller;
  state.airlineOptions = { pending: true, scopeKey };
  $('airline-menu').hidden = true;
  $('airline-trigger').setAttribute('aria-expanded', 'false');
  renderAirlines();
  const task = (async () => {
    try {
      const data = await request('delays/carriers', params, controller.signal);
      if (id !== state.airlineRequestId) return false;
      if (!Array.isArray(data)) throw new Error('Unexpected airline response');
      const available = [...new Map(data
        .filter((item) => /^[A-Z0-9]{2}$/.test(item?.code) && Number(item.flights) > 0)
        .map((item) => [item.code, item])).values()];
      state.airlineOptions = { data: available, scopeKey };
      renderAirlines();
      return false;
    } catch {
      if (id !== state.airlineRequestId) return false;
      state.airlineOptions = { error: true, scopeKey };
      renderAirlines();
      return false;
    }
  })();
  state.airlineLoad = { key: scopeKey, promise: task };
  try {
    return await task;
  } finally {
    if (state.airlineLoad?.promise === task) state.airlineLoad = null;
  }
}

function renderRules() {
  $('rule-list').innerHTML = state.rules.length ? state.rules.map((rule) => `
    <div class="rule-row" data-rule-id="${rule.id}">
      <select class="control rule-column" aria-label="Metric for rule ${rule.id}" data-testid="select-rule-column-${rule.id}">${RAW_METRICS.map(([key, label]) => `<option value="${key}" ${rule.column === key ? 'selected' : ''}>${label}</option>`).join('')}</select>
      <select class="control rule-operator" aria-label="Comparison for rule ${rule.id}" data-testid="select-rule-operator-${rule.id}">
        <option value="gte" ${rule.operator === 'gte' ? 'selected' : ''}>At least (≥)</option><option value="lte" ${rule.operator === 'lte' ? 'selected' : ''}>At most (≤)</option><option value="eq" ${rule.operator === 'eq' ? 'selected' : ''}>Exactly (=)</option>
      </select>
      <input class="control rule-value" type="number" min="0" step="1" inputmode="numeric" value="${escapeHtml(rule.value)}" aria-label="Whole-number threshold for rule ${rule.id}" data-testid="input-rule-value-${rule.id}">
      <button class="rule-remove" type="button" aria-label="Remove rule ${rule.id}" data-action="remove-rule" data-testid="button-remove-rule-${rule.id}">×</button>
    </div>`).join('') : '<div class="rule-empty">No record rules. All reported rows are included.</div>';
  $('add-rule').disabled = state.rules.length >= 30;
  updateDraftStatus();
}

function renderMetricChoices() {
  const choices = [
    ...HEADLINE_METRICS.map(([id, label]) => [id, label]),
    ...RAW_METRICS.map(([key, label]) => [`raw-${key}`, `${label}${key.endsWith('_minutes') ? ' · raw' : ' · count'}`]),
  ];
  $('metric-options').innerHTML = choices.map(([id, label]) =>
    `<label class="metric-option"><input type="checkbox" value="${id}" ${state.shownMetrics.has(id) ? 'checked' : ''} data-testid="checkbox-show-${id}"><span>${escapeHtml(label)}</span></label>`).join('');
  updateDraftStatus();
}

function updateDraftStatus() {
  $('metric-choice-count').textContent = `${state.shownMetrics.size} of ${HEADLINE_METRICS.length + RAW_METRICS.length} selected`;
  const dirty = JSON.stringify(state.rules.map(({ column, operator, value }) => ({ column, operator, value })))
    !== JSON.stringify(state.appliedRules.map(({ column, operator, value }) => ({ column, operator, value })))
    || [...state.shownMetrics].sort().join(',') !== [...state.appliedMetrics].sort().join(',');
  $('apply-filters').textContent = dirty ? 'Apply filters · pending changes' : 'Apply filters';
}

function updateQueryChips() {
  const parts = [
    ...[...state.airlines].sort().map((code) => `<span class="query-chip">Airline ${escapeHtml(airlineLabel(code))}</span>`),
    ...state.appliedRules.map((rule) => {
      const label = RAW_METRICS.find(([key]) => key === rule.column)?.[1] || rule.column;
      const operator = { gte: '≥', lte: '≤', eq: '=' }[rule.operator];
      return `<span class="query-chip rule-chip">${escapeHtml(label)} ${operator} ${escapeHtml(rule.value)}</span>`;
    }),
  ];
  $('active-query').hidden = !parts.length;
  $('active-query').innerHTML = parts.join('');
  const counts = [
    state.airlines.size ? `${state.airlines.size} airline${state.airlines.size === 1 ? '' : 's'}` : '',
    state.appliedRules.length ? `${state.appliedRules.length} rule${state.appliedRules.length === 1 ? '' : 's'}` : '',
  ].filter(Boolean);
  $('advanced-count').textContent = counts.length ? `/ ${counts.join(' · ')}` : '';
}

async function request(path, params, signal) {
  const url = new URL(path, apiRoot);
  if (params) url.search = new URLSearchParams(params).toString();
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', onAbort, { once: true });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 20000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Request failed: ${response.status}`);
    return await response.json();
  } catch (error) {
    // Cancellation from a superseded selection is not a timeout.
    if (signal?.aborted) throw error;
    if (timedOut) {
      const timeoutError = new Error('This request took longer than 20 seconds; try again.');
      timeoutError.name = 'TimeoutError';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onAbort);
  }
}

function populateAirports() {
  const selected = $('airport').value || 'ATL';
  const entries = state.airports.data ?? [];
  $('airport').replaceChildren(...CODES.map((code) => {
    const option = document.createElement('option');
    const match = entries.find((item) => item.code === code);
    option.value = code;
    option.textContent = `${code}${match ? ` — ${match.city} · ${match.name}` : ''}`;
    return option;
  }));
  $('airport').value = selected;
}

function updateCoverage() {
  const { status } = state;
  const data = status.data;
  const bounds = coverageBounds();
  const range = bounds ? `Select dates from ${dateLabel(bounds.first)} through ${dateLabel(bounds.last)} (overall BTS coverage).` : status.pending
    ? 'Loading BTS date coverage…'
    : 'BTS date coverage unavailable; date-filtered charts are paused until the available range can be verified.';
  $('detail-date-help').textContent = `${range} An individual airport or filter selection may have no rows within this overall range.`;
  $('compare-date-help').textContent = `${range} Some hubs and carrier selections may have no rows within this overall range.`;
  $('dataset-label').textContent = data?.importing ? 'Importing data' : data?.totalFlights ? 'Dataset available' : 'Coverage pending';
  $('total-records').textContent = status.pending ? 'Loading…' : status.error ? 'Unavailable' : number(data?.totalFlights ?? 0);
  $('date-coverage').textContent = status.pending ? 'Loading…' : status.error ? 'Unavailable'
    : data?.firstDate && data?.lastDate ? `${dateLabel(data.firstDate)} – ${dateLabel(data.lastDate)}` : 'No dates loaded';
  $('loaded-months').textContent = `${data?.loadedMonths?.length ?? 0} months loaded · all airports`;
  $('compare-records').textContent = status.pending ? 'Loading…' : status.error ? 'Unavailable' : number(data?.totalFlights ?? 0);
  $('compare-coverage-dates').textContent = status.pending ? 'Loading…' : status.error ? 'Unavailable'
    : data?.firstDate && data?.lastDate ? `${dateLabel(data.firstDate)} – ${dateLabel(data.lastDate)}` : 'No dates loaded';
  $('compare-months').textContent = `${data?.loadedMonths?.length ?? 0} months loaded · all airports`;
  for (const id of ['from', 'to', 'compare-from', 'compare-to']) {
    $(id).min = bounds?.first || '';
    $(id).max = bounds?.last || '';
  }
  validateDates();
  compareDatesValid();
  const source = $('dataset-source');
  source.hidden = !data?.sourceUrl?.startsWith('https://');
  if (!source.hidden) source.href = data.sourceUrl;

  const notices = $('notices');
  notices.replaceChildren();
  const notice = (text, action, testId) => {
    const box = document.createElement('div');
    box.className = 'import-note';
    box.setAttribute('role', 'alert');
    box.dataset.testid = testId;
    box.append(document.createTextNode(text));
    if (action) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Retry';
      button.dataset.action = 'retry-metadata';
      button.dataset.testid = `button-retry-${action}`;
      box.append(' ', button);
    }
    notices.append(box);
  };
  if (state.airports.error) notice('Airport names could not be loaded. Airport code selection remains available.', 'airports', 'status-airports-error');
  if (status.error) notice('Dataset coverage is unavailable. Metrics may still load, but date completeness cannot be verified.', 'coverage', 'status-coverage-error');
  else if (!status.pending && !bounds) notice('BTS date bounds are unavailable. Date coverage cannot be verified; no range has been assumed.', 'coverage', 'status-coverage-unavailable');
  if (data?.importing) notice('BTS records are being imported. Current figures may cover only part of the published dataset; check the dates above before interpreting results.', null, 'status-importing');
  const compareNotices = $('compare-notices');
  compareNotices.replaceChildren();
  if (status.error || state.airports.error || data?.importing || (!status.pending && !bounds)) {
    const note = document.createElement('div');
    note.className = 'import-note';
    note.setAttribute('role', 'status');
    note.textContent = data?.importing
      ? 'BTS records are being imported. The ranking may cover only part of the published dataset.'
      : status.error || !bounds ? 'BTS date bounds are unavailable. Date coverage cannot be verified; no range has been assumed.'
        : 'Airport names are unavailable; airport codes remain visible.';
    if (status.error || state.airports.error) {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.dataset.action = 'retry-metadata';
      retry.textContent = 'Retry';
      note.append(' ', retry);
    }
    compareNotices.append(note);
  }
}

async function loadMetadata() {
  const id = ++state.metadataId;
  state.airports = { pending: true, data: state.airports.data };
  state.status = { pending: true, data: state.status.data };
  updateCoverage();
  const [airports, status] = await Promise.allSettled([request('airports'), request('data-status')]);
  if (id !== state.metadataId) return;
  state.airports = airports.status === 'fulfilled' ? { data: airports.value } : { error: true };
  state.status = status.status === 'fulfilled' ? { data: status.value } : { error: true };
  populateAirports();
  updateCoverage();
  renderResults();
  renderComparison();
  renderAirlineHubs();
  if (state.activeView === 'compare') loadComparison();
  else loadResults();
}

function compareDatesValid() {
  return validateDatePair('compare-from', 'compare-to', 'compare-date-error');
}

function renderHubOptions() {
  const select = $('hub-airline');
  const options = state.hubOptions.data ?? [];
  select.disabled = !options.length || !!state.hubOptions.pending || !!state.hubOptions.error;
  if (state.hubOptions.pending) {
    select.innerHTML = '<option>Loading airlines…</option>';
  } else if (state.hubOptions.error) {
    select.innerHTML = '<option>Airlines unavailable</option>';
  } else if (!options.length) {
    select.innerHTML = '<option>No airlines available</option>';
  } else {
    select.replaceChildren(...options.map((item) => {
      const option = document.createElement('option');
      option.value = item.code;
      option.textContent = `${item.code} — ${item.name}`;
      return option;
    }));
    select.value = state.hubAirline;
  }
}

async function loadHubOptions(force = false) {
  if (!force && (state.hubOptions.data || state.hubOptions.loading)) return;
  const id = ++state.hubOptionsRequestId;
  state.hubOptions = { pending: true, loading: true };
  renderHubOptions();
  renderAirlineHubs();
  try {
    const options = await request('delays/hub-airlines');
    if (id !== state.hubOptionsRequestId) return;
    if (!Array.isArray(options)) throw new Error('Invalid airline list');
    state.hubOptions = { data: options.filter((item) => item && typeof item.code === 'string') };
    if (!state.hubOptions.data.some((item) => item.code === state.hubAirline)) {
      state.hubAirline = state.hubOptions.data.find((item) => item.code === 'UA')?.code
        || state.hubOptions.data[0]?.code || '';
    }
    renderHubOptions();
    loadAirlineHubs();
  } catch {
    if (id !== state.hubOptionsRequestId) return;
    state.hubOptions = { error: true };
    renderHubOptions();
    renderAirlineHubs();
  }
}

function hubRate(item) {
  const denominator = Number(item.departureFlights);
  const delayed = Number(item.delayedDepartures);
  return item.delayedDeparturePct == null || !Number.isFinite(denominator) || denominator <= 0
    || !Number.isFinite(delayed) ? null : delayed / denominator;
}

function renderAirlineHubs() {
  const summary = $('airline-hubs-summary');
  const target = $('airline-hubs-results');
  const options = state.hubOptions.data ?? [];
  const selected = options.find((item) => item.code === state.hubAirline);
  const { hubResults } = state;
  const from = $('compare-from').value;
  const to = $('compare-to').value;
  $('airline-hubs-period').textContent = from || to
    ? `${from ? dateLabel(from) : 'First available'} → ${to ? dateLabel(to) : 'Latest available'}`
    : 'Full available period';
  if (state.hubOptions.pending) {
    summary.textContent = 'Loading reporting-airline shortlists';
    target.innerHTML = `<div class="compare-status">${loading(210)}</div>`;
    return;
  }
  if (state.hubOptions.error) {
    summary.textContent = 'Airline shortlists unavailable';
    target.innerHTML = `<div class="compare-status">${empty('The reporting-airline list could not be retrieved. Check the connection and retry.', true).replace('data-action="retry"', 'data-action="retry-hub-options"')}</div>`;
    return;
  }
  if (!options.length || !selected) {
    summary.textContent = 'No reporting airlines available';
    target.innerHTML = `<div class="compare-status">${empty('No airline hub shortlists are available yet. Try refreshing when data is loaded.')}</div>`;
    return;
  }
  if (hubResults.invalid) {
    summary.textContent = `${selected.name} · ${selected.code}`;
    target.innerHTML = `<div class="compare-status">${empty($('compare-date-error').textContent)}</div>`;
    return;
  }
  if (hubResults.pending) {
    summary.textContent = `${selected.name} · ${selected.code} / Loading its configured hubs and bases`;
    target.innerHTML = `<div class="compare-status">${loading(260)}</div>`;
    return;
  }
  if (hubResults.error) {
    summary.textContent = `${selected.name} · ${selected.code} / Results unavailable`;
    target.innerHTML = `<div class="compare-status">${empty('This airline’s hub departures could not be retrieved. Check the connection and retry.', true).replace('data-action="retry"', 'data-action="retry-airline-hubs"')}</div>`;
    return;
  }
  const data = hubResults.data;
  const shortlist = selected.airports || [];
  const returned = Array.isArray(data?.airports) ? data.airports : [];
  const rows = shortlist.length
    ? shortlist.map((code) => returned.find((item) => item.airport === code) || { airport: code })
    : returned;
  summary.textContent = `${data?.airline?.name || selected.name} · ${data?.airline?.code || selected.code} / ${shortlist.length} configured ${shortlist.length === 1 ? 'hub or base' : 'hubs and bases'} / ${returned.length} returned`;
  if (!rows.length) {
    target.innerHTML = `<div class="compare-status">${empty('No configured hubs or bases were returned for this airline and date range. Try a wider period.')}</div>`;
    return;
  }
  const metadata = state.airports.data ?? [];
  const sorted = [...rows].sort((a, b) => {
    if (state.hubSort === 'airport') return String(a.airport).localeCompare(String(b.airport));
    const x = hubRate(a);
    const y = hubRate(b);
    if (x == null || y == null) return x == null ? (y == null ? String(a.airport).localeCompare(String(b.airport)) : 1) : -1;
    return (state.hubSort === 'highest' ? y - x : x - y) || String(a.airport).localeCompare(String(b.airport));
  });
  target.innerHTML = `<div class="airline-hubs-key" aria-hidden="true"><span>Airport / hub or base</span><span>Delayed share</span><span>Rate</span><span>Delayed / departures</span><span>Total flights</span></div>
    <ol class="airline-hubs-list" aria-label="${escapeHtml(selected.name)} origin departures at configured hubs and bases">
      ${sorted.map((item) => {
        const code = String(item.airport ?? '');
        const airport = metadata.find((entry) => entry.code === code);
        const place = airport ? [airport.city, airport.name].filter(Boolean).join(' · ') : 'Airport metadata unavailable';
        const rate = hubRate(item);
        const percent = rate == null ? 'N/A' : `${escapeHtml(item.delayedDeparturePct)}%`;
        const delayed = item.delayedDepartures == null ? 'N/A' : number(Number(item.delayedDepartures));
        const departures = item.departureFlights == null ? 'N/A' : number(Number(item.departureFlights));
        const flights = item.flights == null ? 'N/A' : number(Number(item.flights));
        return `<li class="airline-hubs-row" data-testid="row-airline-hub-${escapeHtml(code)}" aria-label="${escapeHtml(selected.name)} at ${escapeHtml(code)}, ${escapeHtml(place)}: ${percent} delayed, ${delayed} delayed departures of ${departures} departure flights, ${flights} total flights">
          <span class="airline-hubs-place"><strong class="hub-code">${escapeHtml(code)}</strong><span>${escapeHtml(place)}</span></span>
          <span class="airline-hubs-track" aria-hidden="true"><span style="width:${rate == null ? 0 : Math.max(0, Math.min(100, rate * 100))}%"></span></span>
          <strong class="airline-hubs-rate ${rate == null ? 'is-na' : ''}">${percent}</strong>
          <span class="airline-hubs-count"><strong>${delayed} / ${departures}</strong><small>delayed / departures</small></span>
          <span class="airline-hubs-total">${flights}<small>total flights</small></span>
        </li>`;
      }).join('')}
    </ol>`;
}

async function loadAirlineHubs() {
  state.hubController?.abort();
  const id = ++state.hubRequestId;
  if (!compareDatesValid()) {
    state.hubResults = { invalid: true };
    renderAirlineHubs();
    return;
  }
  if (!state.hubAirline || !state.hubOptions.data) {
    renderAirlineHubs();
    return;
  }
  const controller = new AbortController();
  state.hubController = controller;
  const params = { airline: state.hubAirline };
  if ($('compare-from').value) params.from = $('compare-from').value;
  if ($('compare-to').value) params.to = $('compare-to').value;
  state.hubResults = { pending: true };
  renderAirlineHubs();
  try {
    const data = await request('delays/airline-hubs', params, controller.signal);
    if (id !== state.hubRequestId) return;
    state.hubResults = { data };
  } catch {
    if (id !== state.hubRequestId) return;
    state.hubResults = { error: true };
  }
  renderAirlineHubs();
}

const NAS_MEASURES = {
  perArrival: { label: 'NAS minutes per arrived flight', short: 'min / arrival', description: 'NAS-attributed minutes ÷ flights with reported arrivals. N/A has no arrival-flight denominator.' },
  total: { label: 'Total NAS-attributed arrival-delay minutes', short: 'minutes', description: 'Total NAS-attributed arrival-delay minutes. This measure also reflects the volume of flights originating at each airport.' },
  share: { label: 'NAS share of five attributed arrival-delay causes', short: 'share', description: 'NAS minutes ÷ all five BTS attributed arrival-delay cause minutes. N/A has no attributed-minute denominator.' },
};

function nasDisplay(item, measure) {
  if (nasRaw(item, measure) == null) return 'N/A';
  if (measure === 'total') return `${number(Number(item.nasDelayMinutes))} min`;
  const supplied = measure === 'perArrival' ? item.nasMinutesPerArrival : item.nasAttributedSharePct;
  const value = supplied == null ? (measure === 'share' ? nasRaw(item, measure) * 100 : nasRaw(item, measure)) : supplied;
  return `${value}${measure === 'share' ? '%' : ' min'}`;
}

function nasDetails(item) {
  const minutes = number(Number(item.nasDelayMinutes));
  const arrivals = number(Number(item.arrivalFlights));
  const attributed = number(Number(item.attributedDelayMinutes));
  return `<dl class="nas-values">
    <div><dt>Total NAS minutes</dt><dd>${minutes} min</dd></div>
    <div><dt>NAS minutes / arrived flight</dt><dd>${escapeHtml(nasDisplay(item, 'perArrival'))}<small>${nasRaw(item, 'perArrival') == null ? 'No arrived-flight denominator' : `${minutes} ÷ ${arrivals} arrivals`}</small></dd></div>
    <div><dt>NAS share / five causes</dt><dd>${escapeHtml(nasDisplay(item, 'share'))}<small>${nasRaw(item, 'share') == null ? 'No attributed-minute denominator' : `${minutes} ÷ ${attributed} attributed min`}</small></dd></div>
  </dl>`;
}

function renderComparison() {
  const { compare } = state;
  const from = $('compare-from').value;
  const to = $('compare-to').value;
  $('compare-period').textContent = from || to
    ? `${from ? dateLabel(from) : 'First available'} → ${to ? dateLabel(to) : 'Latest available'}`
    : 'Full available period';
  const target = $('compare-results');
  const nasTarget = $('nas-results');
  const measure = state.nasMeasure;
  $('nas-metric-description').textContent = NAS_MEASURES[measure].description;
  if (compare.invalid) {
    target.innerHTML = `<div class="compare-status">${empty($('compare-date-error').textContent)}</div>`;
    nasTarget.innerHTML = `<div class="compare-status">${empty($('compare-date-error').textContent)}</div>`;
  } else if (compare.pending) {
    target.innerHTML = `<div class="compare-status">${loading(280)}</div>`;
    nasTarget.innerHTML = `<div class="compare-status">${loading(280)}</div>`;
  } else if (compare.error) {
    target.innerHTML = `<div class="compare-status">${empty('The hub ranking could not be retrieved. Check the connection and retry.', true).replace('data-action="retry"', 'data-action="retry-compare"')}</div>`;
    nasTarget.innerHTML = `<div class="compare-status">${empty('The NAS ranking could not be retrieved. Check the connection and retry.', true).replace('data-action="retry"', 'data-action="retry-compare"')}</div>`;
  } else if (!Array.isArray(compare.data) || !compare.data.length) {
    target.innerHTML = `<div class="compare-status">${empty('No reported departures for the hubs and major bases in this date range. Try a wider period.')}</div>`;
    nasTarget.innerHTML = `<div class="compare-status">${empty('No reported flights for the hubs and major bases in this date range. Try a wider period.')}</div>`;
  } else {
    // Sort from unrounded counts so close values do not tie merely because their labels do.
    const metadata = state.airports.data ?? [];
    const rows = sortDepartures(compare.data.filter((item) =>
      item && item.airport !== 'GUM' && Number(item.departureFlights) > 0
      && Number.isFinite(Number(item.delayedDeparturePct))), state.departureSort);
    const visibleRows = state.expandedRankings.departure ? rows : rows.slice(0, 8);
    target.innerHTML = !rows.length ? `<div class="compare-status">${empty('No reported departures for the hubs and major bases in this date range. Try a wider period.')}</div>` : `
      <div class="compare-key" aria-hidden="true"><span>${state.departureSort === 'airport' ? 'Order' : 'Rank'}</span><span>Airport</span><span>Share of departures delayed</span><span>Rate</span><span>Delayed / departures</span></div>
      <ol class="hub-list" aria-label="Hubs and major bases sorted by ${state.departureSort === 'airport' ? 'airport code A to Z' : `${state.departureSort === 'highest' ? 'highest' : 'lowest'} percent of departures delayed 15 minutes or more`}">
       ${visibleRows.map((item, index) => {
        const code = String(item.airport);
        const airport = metadata.find((entry) => entry.code === code);
        const place = airport ? [airport.city, airport.name].filter(Boolean).join(' · ') : 'Airport metadata unavailable';
        const pct = Number(item.delayedDeparturePct);
        const delayed = number(Number(item.delayedDepartures));
        const departures = number(Number(item.departureFlights));
        const flights = number(Number(item.flights));
        return `<li class="hub-row" tabindex="0" data-testid="row-hub-${escapeHtml(code)}" aria-label="${state.departureSort === 'airport' ? 'Position' : 'Rank'} ${index + 1}, ${escapeHtml(code)}, ${escapeHtml(place)}: ${escapeHtml(item.delayedDeparturePct)} percent delayed, ${delayed} delayed departures of ${departures} departure flights, ${flights} total flights">
          <span class="hub-rank">${String(index + 1).padStart(2, '0')}</span>
          <span class="hub-identity"><span class="hub-code">${escapeHtml(code)}</span><span class="hub-place" title="${escapeHtml(place)}">${escapeHtml(place)}</span></span>
          <span class="hub-track" aria-hidden="true"><span class="hub-bar" style="width:${Math.max(0, Math.min(100, pct))}%"></span></span>
          <strong class="hub-percent">${escapeHtml(item.delayedDeparturePct)}%</strong>
          <span class="hub-counts"><strong>${delayed} / ${departures}</strong>${flights} total flights</span>
        </li>`;
      }).join('')}
       </ol>${rows.length > 8 ? `<button class="ranking-expand" type="button" data-expand="departure" aria-expanded="${state.expandedRankings.departure}" data-testid="button-expand-departure">${state.expandedRankings.departure ? 'Show first 8 airports' : `Show all ${rows.length} airports`}</button>` : ''}<div class="compare-foot"><p>Bars use a fixed 0–100% scale. Exact percentages and counts are listed alongside each airport; focus a row to hear the full record.</p><span class="mono">${rows.length} airports with reported departures</span></div>`;

    const nasRows = sortNas(compare.data.filter((item) =>
      item && item.airport && item.airport !== 'GUM'), measure, state.nasSort);
    if (!nasRows.length) {
      nasTarget.innerHTML = `<div class="compare-status">${empty('No reported flights for the hubs and major bases in this date range. Try a wider period.')}</div>`;
      return;
    }
    const max = measure === 'share' ? 1 : Math.max(0, ...nasRows.map((item) => nasRaw(item, measure) ?? 0));
    const visibleNas = state.expandedRankings.nas ? nasRows : nasRows.slice(0, 8);
    nasTarget.innerHTML = `<div class="nas-key" aria-hidden="true"><span>${state.nasSort === 'airport' ? 'Order' : 'Rank'}</span><span>Airport</span><span>${escapeHtml(NAS_MEASURES[measure].short)}</span><span>Value</span></div>
      <ol class="nas-list" aria-label="Airports sorted by ${state.nasSort === 'airport' ? 'airport code A to Z' : `${state.nasSort === 'highest' ? 'highest' : 'lowest'} ${escapeHtml(NAS_MEASURES[measure].label)}`}">
      ${visibleNas.map((item, index) => {
        const code = String(item.airport);
        const airport = metadata.find((entry) => entry.code === code);
        const place = airport ? [airport.city, airport.name].filter(Boolean).join(' · ') : 'Airport metadata unavailable';
        const value = nasRaw(item, measure);
        const width = value == null || !max ? 0 : Math.max(0, Math.min(100, value / max * 100));
        return `<li class="nas-item" data-testid="row-nas-${escapeHtml(code)}"><details><summary class="nas-summary" data-testid="button-nas-details-${escapeHtml(code)}" aria-label="${state.nasSort === 'airport' ? 'Position' : 'Rank'} ${index + 1}, ${escapeHtml(code)}, ${escapeHtml(place)}: ${escapeHtml(NAS_MEASURES[measure].label)} ${escapeHtml(nasDisplay(item, measure))}. Open for all three measures.">
          <span class="nas-rank">${String(index + 1).padStart(2, '0')}</span>
          <span class="nas-identity"><span class="hub-code">${escapeHtml(code)}</span></span>
          <span class="nas-track" aria-hidden="true"><span class="nas-bar" style="width:${width}%"></span></span>
          <strong class="nas-value">${escapeHtml(nasDisplay(item, measure))}</strong>
        </summary><div class="nas-detail"><p class="nas-place">${escapeHtml(place)}</p>${nasDetails(item)}</div></details></li>`;
      }).join('')}</ol>
      ${nasRows.length > 8 ? `<button class="ranking-expand" type="button" data-expand="nas" aria-expanded="${state.expandedRankings.nas}" data-testid="button-expand-nas">${state.expandedRankings.nas ? 'Show first 8 airports' : `Show all ${nasRows.length} airports`}</button>` : ''}
      <div class="nas-note"><p>${measure === 'share' ? 'Bars use a fixed 0–100% scale.' : 'Bars scale to the highest eligible airport in this selection.'} ${state.nasSort === 'airport' ? 'Airport codes are ordered A–Z.' : 'Highest and lowest sorts use unrounded values; N/A airports follow ranked values.'} Open any airport for all three measures and their underlying counts.</p></div>`;
  }
}

async function loadComparison() {
  state.compareController?.abort();
  const id = ++state.compareRequestId;
  if (!compareDatesValid()) {
    state.compare = { invalid: true };
    renderComparison();
    loadAirlineHubs();
    return;
  }
  loadAirlineHubs();
  state.compareController = new AbortController();
  const params = {};
  if ($('compare-from').value) params.from = $('compare-from').value;
  if ($('compare-to').value) params.to = $('compare-to').value;
  state.compare = { pending: true };
  renderComparison();
  try {
    const data = await request('delays/hub-ranking', params, state.compareController.signal);
    if (id !== state.compareRequestId) return;
    state.compare = { data };
  } catch {
    if (id !== state.compareRequestId) return;
    state.compare = { error: true };
  }
  renderComparison();
}

function switchView() {
  const next = location.hash === '#compare-hubs' ? 'compare' : 'detail';
  if (state.activeView !== next) {
    const source = next === 'compare' ? ['from', 'to'] : ['compare-from', 'compare-to'];
    const destination = next === 'compare' ? ['compare-from', 'compare-to'] : ['from', 'to'];
    destination.forEach((id, index) => { $(id).value = $(source[index]).value; });
    state.activeView = next;
    loadFaa(true);
    if (next === 'compare') {
      loadComparison();
      loadHubOptions();
    }
    else loadResults();
  } else if (next === 'compare' && state.compare.pending && !state.compareController) {
    loadComparison();
    loadHubOptions();
  }
  $('detail-view').hidden = next !== 'detail';
  $('compare-view').hidden = next !== 'compare';
  $('detail-tab').removeAttribute('aria-current');
  $('compare-tab').removeAttribute('aria-current');
  $(`${next}-tab`).setAttribute('aria-current', 'page');
  if (next === 'compare') {
    $('airline-menu').hidden = true;
    $('airline-trigger').setAttribute('aria-expanded', 'false');
  }
}

function filterValues() {
  return buildDetailParams({
    airport: $('airport').value, from: $('from').value, to: $('to').value,
    airlines: state.airlines, rules: state.appliedRules,
  });
}

function validateDates() {
  return validateDatePair('from', 'to', 'date-error');
}

function validateRules() {
  const bad = (value) => !/^(0|[1-9]\d*)$/.test(String(value)) || !Number.isSafeInteger(Number(value));
  const invalid = state.rules.some(({ value }) => bad(value));
  $('rule-list').querySelectorAll('.rule-row').forEach((row) => {
    const rule = state.rules.find((item) => item.id === Number(row.dataset.ruleId));
    row.querySelector('.rule-value')?.setAttribute('aria-invalid', String(bad(rule?.value)));
  });
  $('rule-error').textContent = invalid ? 'Each rule needs a nonnegative whole-number threshold.' : '';
  $('rule-error').hidden = !invalid;
  return !invalid;
}

function collapseAdvanced() {
  $('advanced-toggle').setAttribute('aria-expanded', 'false');
  $('advanced-body').hidden = true;
  $('advanced-toggle').focus();
}

function commitDraft() {
  if (!validateRules()) return false;
  state.appliedRules = state.rules.map((rule) => ({ ...rule }));
  state.appliedMetrics = new Set(state.shownMetrics);
  $('advanced-notice').hidden = true;
  updateDraftStatus();
  updateQueryChips();
  return true;
}

function showDraftError(message) {
  $('advanced-notice').textContent = message;
  $('advanced-notice').hidden = false;
}

function resultFailure(entry, fallback) {
  return entry.timeout ? 'This request took longer than 20 seconds; try again.' : fallback;
}

function rawTrendCard([key, label], daily, points) {
  const unit = key.endsWith('_minutes') ? 'minutes' : 'flights';
  const heading = `<h3>${escapeHtml(label)}</h3><span class="trend-unit">Reported ${unit} / month · independent scale</span>`;
  const warning = daily.warning ? `<p class="trend-warning" role="alert">${daily.timeout ? 'This request took longer than 20 seconds; try again.' : 'Refresh failed.'} Showing the last retrieved results for this selection. <button type="button" data-action="retry">Try again</button></p>` : '';
  if (daily.pending) return `<article class="raw-trend">${heading}${loading(145)}</article>`;
  if (daily.error) return `<article class="raw-trend">${heading}${empty(resultFailure(daily, 'Monthly daily records could not be retrieved. Retry the daily view.'), true)}</article>`;
  if (!points.length) return `<article class="raw-trend">${heading}${empty('No reported daily observations for this metric in the applied selection.')}</article>`;
  const max = Math.max(...points.map((point) => point.value));
  return `<article class="raw-trend" data-testid="chart-raw-${key}">${heading}${warning}
    <div class="monthly-chart" data-monthly-metric="${key}"></div>
    <div class="trend-months"><span>${escapeHtml(points[0].month)}</span><span>${points.length} observed ${points.length === 1 ? 'month' : 'months'}</span><span>${escapeHtml(points.at(-1).month)}</span></div>
    <p class="trend-detail">Highest monthly total: ${number(max)} ${unit}. Hover or focus a bar for that month's filtered total, flight count, and reported days.</p></article>`;
}

function renderRawTrends(daily) {
  $('raw-trends-grid').querySelectorAll('.monthly-chart').forEach(disposeChart);
  const selected = RAW_METRICS.filter(([key]) => state.appliedMetrics.has(`raw-${key}`));
  $('raw-trends').hidden = !selected.length;
  $('raw-trends-scope').textContent = `Monthly totals for ${$('airport').value || 'ATL'} · ${state.airlines.size
    ? [...state.airlines].sort().map(airlineLabel).join(', ')
    : 'all reporting airlines'}, after applied record rules. Each measure has its own scale; missing observations are not zero.`;
  const charts = selected.map((entry) => ({ entry, points: monthlyPoints(daily.data ?? [], entry[2]) }));
  $('raw-trends-grid').innerHTML = !selected.length ? '' : daily.invalid
    ? `<div class="raw-trend">${empty(daily.invalid)}</div>`
    : charts.map(({ entry, points }) => rawTrendCard(entry, daily, points)).join('');
  if (!daily.invalid && !daily.pending && !daily.error) {
    charts.forEach(({ entry: [key, label], points }) => {
      if (points.length) renderMonthlyChart($('raw-trends-grid').querySelector(`[data-monthly-metric="${key}"]`), points, label);
    });
  }
}

async function loadResults() {
  if (state.controller) state.controller.abort();
  const id = ++state.requestId;
  const datesValid = validateDates();
  if (!datesValid) {
    invalidateAirlineOptions();
    state.results = {};
    renderResults($('date-error').textContent);
    return;
  }
  const oldResults = state.results;
  const oldKey = state.resultsKey;
  state.results = Object.fromEntries(Object.keys(paths).map((name) => [name, { pending: true }]));
  renderResults();
  await loadAvailableAirlines();
  if (id !== state.requestId) return;
  state.controller = new AbortController();
  const params = filterValues();
  const key = params.toString();
  const previous = oldKey === key ? oldResults : {};
  state.resultsKey = key;
  await Promise.all(Object.entries(paths).map(async ([name, path]) => {
    try {
      const data = await request(path, params, state.controller.signal);
      if (id !== state.requestId) return;
      state.results[name] = { data };
    } catch (error) {
      if (id !== state.requestId) return;
      const timeout = error?.name === 'TimeoutError';
      state.results[name] = previous[name]?.data
        ? { data: previous[name].data, warning: true, timeout }
        : { error: true, timeout };
    }
    renderResults();
  }));
}

function renderResults(invalid = '') {
  const { summary = { pending: true }, daily = { pending: true }, carriers = { pending: true },
    causes = { pending: true }, weekday = { pending: true } } = state.results;
  const airport = $('airport').value || 'ATL';
  const selected = state.airports.data?.find((item) => item.code === airport);
  const airlineScope = state.airlines.size === 1 ? ` · ${airlineLabel([...state.airlines][0])}`
    : state.airlines.size > 1 ? ` · ${state.airlines.size} selected airlines` : '';
  $('snapshot-label').textContent = `01 / Airport snapshot — ${airport}${selected ? ` · ${selected.city}` : ''}${airlineScope}`;
  $('period-label').textContent = $('from').value || $('to').value
    ? `${$('from').value ? dateLabel($('from').value) : 'First available'} → ${$('to').value ? dateLabel($('to').value) : 'Latest available'}`
    : 'Full available period';
  const message = invalid ? invalid
    : state.status.data?.importing ? 'The BTS dataset is still being imported. Figures will appear when records for this selection are available.'
      : 'No reported departing flights match these airport, date, airline, and record-rule selections. Widen the date range or remove a constraint.';
  const hasData = !!summary.data && summary.data.flights > 0;
  const stale = (entry) => entry.warning ? `<p class="stale-notice" role="alert">${entry.timeout ? 'This request took longer than 20 seconds; try again.' : 'Refresh failed.'} Showing last retrieved results for this selection. <button type="button" data-action="retry">Try again</button></p>` : '';

  $('metrics').innerHTML = invalid ? empty(message) : summary.pending ? loading(140).repeat(Math.max(1, Math.min(4, state.appliedMetrics.size)))
    : summary.error ? empty(resultFailure(summary, 'The airport snapshot could not be retrieved. Check the connection and retry.'), true)
      : !state.appliedMetrics.size ? '<div class="state-box" role="status" data-testid="status-summary-no-metrics"><span class="state-icon" aria-hidden="true">◌</span><strong>No summary cards selected</strong><p>Open Advanced controls → Show metrics to choose what appears here. The data below is unchanged.</p></div>'
        : !hasData ? empty(message) : `${stale(summary)}${[
          ...HEADLINE_METRICS.filter(([id]) => state.appliedMetrics.has(id)).map(([id, label, key, suffix, note]) =>
            metric(label, `${id === 'scheduled' ? number(summary.data[key]) : one(summary.data[key])}${summary.data[key] == null ? '' : suffix}`, note)),
          ...RAW_METRICS.filter(([key]) => state.appliedMetrics.has(`raw-${key}`)).map(([, label, key]) =>
            metric(label, number(summary.data[key]), 'Raw BTS aggregate · selected records')),
        ].join('')}`;

  const dailyData = (daily.data ?? []).filter((item) => item.flights > 0).sort((a, b) => a.date.localeCompare(b.date));
  const weekdayData = (weekday.data ?? []).filter((item) => item.flights > 0)
    .sort((a, b) => WEEKDAYS.indexOf(a.dayOfWeek) - WEEKDAYS.indexOf(b.dayOfWeek));
  const carrierData = (carriers.data ?? []).filter((item) => item.flights > 0).sort((a, b) => b.flights - a.flights);
  const causeData = (causes.data ?? []).filter((item) => item.minutes > 0).sort((a, b) => b.minutes - a.minutes);
  $('daily-caption').textContent = dailyData.length ? `${number(dailyData.length)} reported days` : '';
  $('carrier-caption').textContent = carrierData.length ? `${carrierData.length} reporting carriers` : '';

  disposeChart($('daily-chart'));
  $('daily-panel').innerHTML = invalid ? empty(message) : daily.pending ? loading() : daily.error
    ? empty(resultFailure(daily, 'Daily records could not be retrieved.'), true) : !dailyData.length ? empty(message)
      : `${stale(daily)}${legend(true)}<div class="chart-frame" id="daily-chart"></div><p class="chart-note">Each point represents a day with reported departures. Gaps in source coverage are not interpolated.</p>`;
  if (!invalid && dailyData.length && !daily.error && !daily.pending) renderDailyChart($('daily-chart'), dailyData);

  disposeChart($('weekday-chart'));
  $('weekday-panel').innerHTML = invalid ? empty(message) : weekday.pending ? loading() : weekday.error
    ? empty(resultFailure(weekday, 'Weekday records could not be retrieved.'), true) : !weekdayData.length ? empty(message)
      : `${stale(weekday)}${legend()}<div class="chart-frame" id="weekday-chart"></div><p class="chart-note">Aggregated by departure day, not arrival day. Hover to inspect rates.</p>`;
  if (!invalid && weekdayData.length && !weekday.error && !weekday.pending) renderWeekdayChart($('weekday-chart'), weekdayData);

  $('carrier-panel').innerHTML = invalid ? empty(message) : carriers.pending ? loading(250) : carriers.error
    ? empty(resultFailure(carriers, 'Carrier records could not be retrieved.'), true) : !carrierData.length ? empty(message)
      : `${stale(carriers)}<div class="table-scroll"><table class="data-table"><thead><tr><th>Carrier</th><th>Flights</th><th>On-time departure</th><th>Avg delay</th></tr></thead><tbody>${carrierData.map((item) =>
        `<tr data-testid="row-carrier-${escapeHtml(item.code)}"><td>${escapeHtml(airlineName(item.code))} <span class="code-pill">${escapeHtml(item.code)}</span></td><td>${number(item.flights)}</td><td class="on-time-cell"><div class="table-bar"><span>${one(item.onTimeDeparturePct)}%</span><div class="bar-track"><div class="bar-fill" style="width:${Math.max(0, Math.min(100, item.onTimeDeparturePct))}%"></div></div></div></td><td>${one(item.avgDepartureDelayMinutes)} min</td></tr>`,
      ).join('')}</tbody></table><p class="chart-note">Sorted by departure volume. Names identify BTS reporting carriers; regional operators may fly for other airline brands.</p></div>`;

  const totalCauseMinutes = causeData.reduce((sum, item) => sum + item.minutes, 0);
  $('arrival-panel').innerHTML = invalid ? empty(message) : summary.pending || causes.pending ? loading(250)
    : summary.error || causes.error ? empty(resultFailure(summary.timeout ? summary : causes, 'Arrival outcomes could not be retrieved.'), true)
      : !hasData ? empty(message) : `${stale(summary)}${stale(causes)}<div class="mini-kpis"><div><strong data-testid="text-arrival-flights">${number(summary.data.arrivalFlights)}</strong><span>Arrival records</span></div><div><strong data-testid="text-arrival-delay">${one(summary.data.avgArrivalDelayMinutes)}</strong><span>Avg arrival delay, min</span></div><div><strong data-testid="text-diversions">${number(summary.data.divertedFlights)}</strong><span>Diverted flights</span></div></div><div class="panel-kicker cause-heading">BTS-reported arrival delay causes / minutes</div>${causeData.length ? causeData.map((item) =>
        `<div class="cause-row" data-testid="row-cause-${escapeHtml(item.cause.replace(/\W+/g, '-'))}"><div class="cause-line"><span>${escapeHtml(item.cause)}</span><strong>${number(item.minutes)} min</strong></div><div class="cause-track"><div class="cause-fill" style="width:${totalCauseMinutes ? item.minutes / totalCauseMinutes * 100 : 0}%"></div></div></div>`,
      ).join('') : empty('No arrival-delay cause minutes were reported for this selection.')}<p class="chart-note">Cause minutes are reported at the destination for these departing flights; they are not causes of departure delay. Categories may not sum to total arrival delay.</p>`;
  renderRawTrends(invalid ? { invalid } : daily);
}

populateAirports();
renderRules();
renderMetricChoices();
renderAirlines();
renderResults();
document.addEventListener('click', (event) => {
  const jump = event.target.closest('[data-jump]')?.dataset.jump;
  if (jump) {
    $(jump).scrollIntoView({ behavior: 'smooth', block: 'start' });
    $(jump).querySelector('h2')?.focus({ preventScroll: true });
  }
  const expand = event.target.closest('[data-expand]')?.dataset.expand;
  if (expand) {
    state.expandedRankings[expand] = !state.expandedRankings[expand];
    renderComparison();
    document.querySelector(`[data-expand="${expand}"]`)?.focus();
  }
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'retry') loadResults();
  if (action === 'retry-compare') loadComparison();
  if (action === 'retry-hub-options') loadHubOptions(true);
  if (action === 'retry-airline-hubs') loadAirlineHubs();
  if (action === 'retry-metadata') loadMetadata();
  if (action === 'retry-faa') loadFaa(true);
  if (action === 'retry-airlines') loadAvailableAirlines(true);
  if (action === 'remove-rule') {
    const id = Number(event.target.closest('[data-rule-id]')?.dataset.ruleId);
    state.rules = state.rules.filter((rule) => rule.id !== id);
    renderRules();
    validateRules();
  }
  if (!event.target.closest('.airline-picker')) {
    $('airline-menu').hidden = true;
    $('airline-trigger').setAttribute('aria-expanded', 'false');
  }
});
$('nas-ranking').addEventListener('change', (event) => {
  if (!event.target.matches('input[name="nas-measure"]')) return;
  state.nasMeasure = event.target.value;
  renderComparison();
});
for (const [id, key] of [['departure-sort', 'departureSort'], ['nas-sort', 'nasSort']]) {
  $(id).addEventListener('change', () => {
    state[key] = $(id).value;
    renderComparison();
  });
}
$('hub-sort').addEventListener('change', () => {
  state.hubSort = $('hub-sort').value;
  renderAirlineHubs();
});
$('hub-airline').addEventListener('change', () => {
  state.hubAirline = $('hub-airline').value;
  loadAirlineHubs();
});
$('airline-trigger').addEventListener('click', () => {
  const willOpen = $('airline-menu').hidden;
  $('airline-menu').hidden = !willOpen;
  $('airline-trigger').setAttribute('aria-expanded', String(willOpen));
});
$('airline-options').addEventListener('change', (event) => {
  if (event.target.type !== 'checkbox') return;
  if (event.target.checked) state.airlines.add(event.target.value);
  else state.airlines.delete(event.target.value);
  renderAirlineSelection();
  loadResults();
});
$('clear-airlines').addEventListener('click', () => {
  state.airlines.clear();
  renderAirlines();
  loadResults();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !$('airline-menu').hidden) {
    $('airline-menu').hidden = true;
    $('airline-trigger').setAttribute('aria-expanded', 'false');
    $('airline-trigger').focus();
  }
});
$('airport').addEventListener('change', () => {
  if ($('advanced-toggle').getAttribute('aria-expanded') === 'true') {
    if (commitDraft()) collapseAdvanced();
    else {
      showDraftError('The new airport is loading with your last applied filters. Correct the rule threshold, then select Apply filters to use your draft.');
      $('advanced-notice').focus();
    }
  }
  $('airline-menu').hidden = true;
  $('airline-trigger').setAttribute('aria-expanded', 'false');
  loadResults();
  renderFaa();
  loadFaa(true);
});
for (const id of ['from', 'to', 'compare-from', 'compare-to']) {
  $(id).addEventListener('input', () => {
    const compare = id.startsWith('compare-');
    clearTimeout(dateInputTimer);
    if (compare ? !compareDatesValid() : !validateDates()) {
      if (compare) {
        state.compareController?.abort();
        state.hubController?.abort();
        ++state.compareRequestId;
        ++state.hubRequestId;
        state.compare = { invalid: true };
        state.hubResults = { invalid: true };
        renderComparison();
        renderAirlineHubs();
      } else {
        state.controller?.abort();
        ++state.requestId;
        invalidateAirlineOptions();
        state.results = {};
        renderResults($('date-error').textContent);
      }
    } else {
      dateInputTimer = setTimeout(compare ? loadComparison : loadResults, 300);
    }
  });
}
for (const id of ['from', 'to']) $(id).addEventListener('change', () => { clearTimeout(dateInputTimer); loadResults(); });
for (const id of ['compare-from', 'compare-to']) $(id).addEventListener('change', () => { clearTimeout(dateInputTimer); loadComparison(); });
$('compare-reset').addEventListener('click', () => {
  $('compare-from').value = '';
  $('compare-to').value = '';
  loadComparison();
});
$('compare-refresh').addEventListener('click', async () => {
  $('compare-refresh').disabled = true;
  await Promise.all([loadMetadata(), loadHubOptions(true), loadFaa(true)]);
  $('compare-refresh').disabled = false;
});
window.addEventListener('hashchange', switchView);
$('advanced-toggle').addEventListener('click', () => {
  const expanded = $('advanced-toggle').getAttribute('aria-expanded') !== 'true';
  $('advanced-toggle').setAttribute('aria-expanded', String(expanded));
  $('advanced-body').hidden = !expanded;
});
$('apply-filters').addEventListener('click', () => {
  if (!commitDraft()) {
    showDraftError('Nothing was applied. Enter a nonnegative whole-number threshold for every rule, then try again.');
    $('rule-list').querySelector('.rule-value[aria-invalid="true"]')?.focus();
    return;
  }
  collapseAdvanced();
  loadResults();
});
$('add-rule').addEventListener('click', () => {
  state.rules.push({ id: state.nextRuleId++, column: 'flights', operator: 'gte', value: '0' });
  renderRules();
  $('rule-list').lastElementChild?.querySelector('.rule-column')?.focus();
});
$('rule-list').addEventListener('change', (event) => {
  const row = event.target.closest('[data-rule-id]');
  if (!row) return;
  const rule = state.rules.find((item) => item.id === Number(row.dataset.ruleId));
  if (!rule) return;
  rule.column = row.querySelector('.rule-column').value;
  rule.operator = row.querySelector('.rule-operator').value;
  rule.value = row.querySelector('.rule-value').value;
  validateRules();
  updateDraftStatus();
});
$('rule-list').addEventListener('input', (event) => {
  if (!event.target.matches('.rule-value')) return;
  const rule = state.rules.find((item) => item.id === Number(event.target.closest('[data-rule-id]').dataset.ruleId));
  if (rule) rule.value = event.target.value;
  validateRules();
  updateDraftStatus();
});
$('metric-options').addEventListener('change', (event) => {
  if (event.target.type !== 'checkbox') return;
  if (event.target.checked) state.shownMetrics.add(event.target.value);
  else state.shownMetrics.delete(event.target.value);
  updateDraftStatus();
});
$('reset-metrics').addEventListener('click', () => {
  state.shownMetrics = new Set(DEFAULT_METRICS);
  renderMetricChoices();
});
$('reset-dates').addEventListener('click', () => {
  $('from').value = '';
  $('to').value = '';
  loadResults();
});
$('refresh').addEventListener('click', async () => {
  $('refresh').disabled = true;
  await Promise.all([loadMetadata(), loadAvailableAirlines(true), loadFaa(true)]);
  $('refresh').disabled = false;
});
renderFaa();
Promise.all([loadMetadata(), loadAvailableAirlines(), loadFaa(true)]);
switchView();
setInterval(() => loadFaa(true), 15 * 60 * 1000);