import { disposeChart, renderDailyChart, renderWeekdayChart } from './charts.js';
import { nasRaw, sortDepartures, sortNas } from './comparison-sort.js';

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
  results: {}, requestId: 0, controller: null, metadataId: 0,
  airlineOptions: { pending: true }, airlineRequestId: 0,
  airlines: new Set(), rules: [], nextRuleId: 1, shownMetrics: new Set(DEFAULT_METRICS),
  compare: { pending: true }, compareRequestId: 0, compareController: null, activeView: 'detail',
  nasMeasure: 'perArrival', expandedRankings: { departure: false, nas: false },
  departureSort: 'highest', nasSort: 'highest',
  hubOptions: { pending: true }, hubOptionsRequestId: 0,
  hubAirline: '', hubResults: { pending: true }, hubRequestId: 0, hubController: null, hubSort: 'highest',
};
const paths = {
  summary: 'delays/summary', daily: 'delays/daily', carriers: 'delays/carriers',
  causes: 'delays/causes', weekday: 'delays/weekday',
};
let ruleInputTimer;

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

function renderAirlines() {
  const { airlineOptions, airlines } = state;
  const codes = (Array.isArray(airlineOptions.data) ? airlineOptions.data : [])
    .map((item) => item.code).filter((code) => typeof code === 'string' && code.length);
  $('airline-trigger').disabled = airlineOptions.pending;
  $('airline-value').textContent = airlines.size ? [...airlines].sort().join(', ')
    : airlineOptions.pending ? 'Loading airlines…' : airlineOptions.error ? 'Airlines unavailable' : 'All airlines';
  $('airline-options').innerHTML = airlineOptions.pending ? loading(90)
    : airlineOptions.error ? `<div class="airline-menu-note" role="alert">Could not load airlines. <button type="button" data-action="retry-airlines" data-testid="button-retry-airlines">Try again</button></div>`
      : !codes.length ? '<p class="airline-menu-note">No carriers reported at this airport yet.</p>'
        : codes.sort().map((code) => `<label class="airline-option"><input type="checkbox" value="${escapeHtml(code)}" ${airlines.has(code) ? 'checked' : ''} data-testid="checkbox-airline-${escapeHtml(code)}"><span>${escapeHtml(code)}</span></label>`).join('');
  updateQueryChips();
}

async function loadAvailableAirlines() {
  const id = ++state.airlineRequestId;
  const airport = $('airport').value;
  state.airlineOptions = { pending: true };
  renderAirlines();
  try {
    // Intentionally unfiltered: choices must never disappear when dates or rules change.
    const data = await request('delays/carriers', { airport });
    if (id !== state.airlineRequestId) return;
    state.airlineOptions = { data };
  } catch {
    if (id !== state.airlineRequestId) return;
    state.airlineOptions = { error: true };
  }
  renderAirlines();
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
  updateQueryChips();
}

function renderMetricChoices() {
  const choices = [
    ...HEADLINE_METRICS.map(([id, label]) => [id, label]),
    ...RAW_METRICS.map(([key, label]) => [`raw-${key}`, `${label}${key.endsWith('_minutes') ? ' · raw' : ' · count'}`]),
  ];
  $('metric-options').innerHTML = choices.map(([id, label]) =>
    `<label class="metric-option"><input type="checkbox" value="${id}" ${state.shownMetrics.has(id) ? 'checked' : ''} data-testid="checkbox-show-${id}"><span>${escapeHtml(label)}</span></label>`).join('');
  $('metric-choice-count').textContent = `${state.shownMetrics.size} of ${choices.length} cards shown`;
}

function updateQueryChips() {
  const parts = [
    ...[...state.airlines].sort().map((code) => `<span class="query-chip">Airline ${escapeHtml(code)}</span>`),
    ...state.rules.map((rule) => {
      const label = RAW_METRICS.find(([key]) => key === rule.column)?.[1] || rule.column;
      const operator = { gte: '≥', lte: '≤', eq: '=' }[rule.operator];
      return `<span class="query-chip rule-chip">${escapeHtml(label)} ${operator} ${escapeHtml(rule.value)}</span>`;
    }),
  ];
  $('active-query').hidden = !parts.length;
  $('active-query').innerHTML = parts.join('');
  const counts = [
    state.airlines.size ? `${state.airlines.size} airline${state.airlines.size === 1 ? '' : 's'}` : '',
    state.rules.length ? `${state.rules.length} rule${state.rules.length === 1 ? '' : 's'}` : '',
  ].filter(Boolean);
  $('advanced-count').textContent = counts.length ? `/ ${counts.join(' · ')}` : '';
}

async function request(path, params, signal) {
  const url = new URL(path, apiRoot);
  if (params) url.search = new URLSearchParams(params).toString();
  const response = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return response.json();
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
  $('dataset-label').textContent = data?.importing ? 'Importing data' : data?.totalFlights ? 'Dataset available' : 'Coverage pending';
  $('total-records').textContent = status.pending ? 'Loading…' : status.error ? 'Unavailable' : number(data?.totalFlights ?? 0);
  $('date-coverage').textContent = status.pending ? 'Loading…' : status.error ? 'Unavailable'
    : data?.firstDate && data?.lastDate ? `${dateLabel(data.firstDate)} – ${dateLabel(data.lastDate)}` : 'No dates loaded';
  $('loaded-months').textContent = `${data?.loadedMonths?.length ?? 0} months loaded · all airports`;
  $('compare-records').textContent = status.pending ? 'Loading…' : status.error ? 'Unavailable' : number(data?.totalFlights ?? 0);
  $('compare-coverage-dates').textContent = status.pending ? 'Loading…' : status.error ? 'Unavailable'
    : data?.firstDate && data?.lastDate ? `${dateLabel(data.firstDate)} – ${dateLabel(data.lastDate)}` : 'No dates loaded';
  $('compare-months').textContent = `${data?.loadedMonths?.length ?? 0} months loaded · all airports`;
  $('from').max = $('to').value || data?.lastDate || '';
  $('to').max = data?.lastDate || '';
  $('to').min = $('from').value || '';
  $('compare-from').max = $('compare-to').value || data?.lastDate || '';
  $('compare-to').max = data?.lastDate || '';
  $('compare-to').min = $('compare-from').value || '';
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
  if (data?.importing) notice('BTS records are being imported. Current figures may cover only part of the published dataset; check the dates above before interpreting results.', null, 'status-importing');
  const compareNotices = $('compare-notices');
  compareNotices.replaceChildren();
  if (status.error || state.airports.error || data?.importing) {
    const note = document.createElement('div');
    note.className = 'import-note';
    note.setAttribute('role', 'status');
    note.textContent = data?.importing
      ? 'BTS records are being imported. The ranking may cover only part of the published dataset.'
      : status.error ? 'Dataset coverage is unavailable. Ranking data may still load, but date completeness cannot be verified.'
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
}

function compareDatesValid() {
  const from = $('compare-from').value;
  const to = $('compare-to').value;
  const message = from && to && from > to ? 'Start date must be on or before end date.' : '';
  $('compare-date-error').textContent = message;
  $('compare-date-error').hidden = !message;
  $('compare-from').max = to || state.status.data?.lastDate || '';
  $('compare-to').min = from || '';
  return !message;
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
    target.innerHTML = `<div class="compare-status">${empty('Choose a date range with the start on or before the end.')}</div>`;
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
    target.innerHTML = `<div class="compare-status">${empty('Choose a date range with the start on or before the end.')}</div>`;
    nasTarget.innerHTML = `<div class="compare-status">${empty('Choose a date range with the start on or before the end.')}</div>`;
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
  const params = new URLSearchParams({ airport: $('airport').value });
  if ($('from').value) params.set('from', $('from').value);
  if ($('to').value) params.set('to', $('to').value);
  [...state.airlines].sort().forEach((code) => params.append('airline', code));
  state.rules.forEach(({ column, operator, value }) => params.append('metric', `${column}:${operator}:${value}`));
  return params;
}

function validateDates() {
  const from = $('from').value;
  const to = $('to').value;
  const message = from && to && from > to ? 'Start date must be on or before end date.' : '';
  $('date-error').textContent = message;
  $('date-error').hidden = !message;
  $('from').max = to || state.status.data?.lastDate || '';
  $('to').min = from || '';
  return !message;
}

function validateRules() {
  const invalid = state.rules.some(({ value }) => !/^(0|[1-9]\d*)$/.test(String(value)) || !Number.isSafeInteger(Number(value)));
  $('rule-error').textContent = invalid ? 'Each rule needs a nonnegative whole-number threshold.' : '';
  $('rule-error').hidden = !invalid;
  return !invalid;
}

async function loadResults() {
  clearTimeout(ruleInputTimer);
  if (state.controller) state.controller.abort();
  const id = ++state.requestId;
  const datesValid = validateDates();
  const rulesValid = validateRules();
  if (!datesValid || !rulesValid) {
    state.results = {};
    renderResults(datesValid ? 'Complete each record rule with a nonnegative whole number.' : 'Choose a date range with the start on or before the end.');
    return;
  }
  state.controller = new AbortController();
  const params = filterValues();
  state.results = Object.fromEntries(Object.keys(paths).map((name) => [name, { pending: true }]));
  renderResults();
  const entries = Object.entries(paths);
  const results = await Promise.allSettled(entries.map(([, path]) => request(path, params, state.controller.signal)));
  if (id !== state.requestId) return;
  state.results = Object.fromEntries(entries.map(([name], index) => [
    name, results[index].status === 'fulfilled' ? { data: results[index].value } : { error: true },
  ]));
  renderResults();
}

function renderResults(invalid = '') {
  const { summary = { pending: true }, daily = { pending: true }, carriers = { pending: true },
    causes = { pending: true }, weekday = { pending: true } } = state.results;
  const airport = $('airport').value || 'ATL';
  const selected = state.airports.data?.find((item) => item.code === airport);
  $('snapshot-label').textContent = `01 / Airport snapshot — ${airport}${selected ? ` · ${selected.city}` : ''}`;
  $('period-label').textContent = $('from').value || $('to').value
    ? `${$('from').value ? dateLabel($('from').value) : 'First available'} → ${$('to').value ? dateLabel($('to').value) : 'Latest available'}`
    : 'Full available period';
  const message = invalid ? invalid
    : state.status.data?.importing ? 'The BTS dataset is still being imported. Figures will appear when records for this selection are available.'
      : 'No reported departing flights match these airport, date, airline, and record-rule selections. Widen the date range or remove a constraint.';
  const hasData = !!summary.data && summary.data.flights > 0;

  $('metrics').innerHTML = invalid ? empty(message) : summary.pending ? loading(140).repeat(Math.max(1, Math.min(4, state.shownMetrics.size)))
    : summary.error ? empty('The airport snapshot could not be retrieved. Check the connection and retry.', true)
      : !state.shownMetrics.size ? '<div class="state-box" role="status" data-testid="status-summary-no-metrics"><span class="state-icon" aria-hidden="true">◌</span><strong>No summary cards selected</strong><p>Open Advanced controls → Show metrics to choose what appears here. The data below is unchanged.</p></div>'
        : !hasData ? empty(message) : [
          ...HEADLINE_METRICS.filter(([id]) => state.shownMetrics.has(id)).map(([id, label, key, suffix, note]) =>
            metric(label, `${id === 'scheduled' ? number(summary.data[key]) : one(summary.data[key])}${summary.data[key] == null ? '' : suffix}`, note)),
          ...RAW_METRICS.filter(([key]) => state.shownMetrics.has(`raw-${key}`)).map(([, label, key]) =>
            metric(label, number(summary.data[key]), 'Raw BTS aggregate · selected records')),
        ].join('');

  const dailyData = (daily.data ?? []).filter((item) => item.flights > 0).sort((a, b) => a.date.localeCompare(b.date));
  const weekdayData = (weekday.data ?? []).filter((item) => item.flights > 0)
    .sort((a, b) => WEEKDAYS.indexOf(a.dayOfWeek) - WEEKDAYS.indexOf(b.dayOfWeek));
  const carrierData = (carriers.data ?? []).filter((item) => item.flights > 0).sort((a, b) => b.flights - a.flights);
  const causeData = (causes.data ?? []).filter((item) => item.minutes > 0).sort((a, b) => b.minutes - a.minutes);
  $('daily-caption').textContent = dailyData.length ? `${number(dailyData.length)} reported days` : '';
  $('carrier-caption').textContent = carrierData.length ? `${carrierData.length} reporting carriers` : '';

  disposeChart($('daily-chart'));
  $('daily-panel').innerHTML = invalid ? empty(message) : daily.pending ? loading() : daily.error
    ? empty('Daily records could not be retrieved.', true) : !hasData || !dailyData.length ? empty(message)
      : `${legend(true)}<div class="chart-frame" id="daily-chart"></div><p class="chart-note">Each point represents a day with reported departures. Gaps in source coverage are not interpolated.</p>`;
  if (!invalid && hasData && dailyData.length && !daily.error) renderDailyChart($('daily-chart'), dailyData);

  disposeChart($('weekday-chart'));
  $('weekday-panel').innerHTML = invalid ? empty(message) : weekday.pending ? loading() : weekday.error
    ? empty('Weekday records could not be retrieved.', true) : !hasData || !weekdayData.length ? empty(message)
      : `${legend()}<div class="chart-frame" id="weekday-chart"></div><p class="chart-note">Aggregated by departure day, not arrival day. Hover to inspect rates.</p>`;
  if (!invalid && hasData && weekdayData.length && !weekday.error) renderWeekdayChart($('weekday-chart'), weekdayData);

  $('carrier-panel').innerHTML = invalid ? empty(message) : carriers.pending ? loading(250) : carriers.error
    ? empty('Carrier records could not be retrieved.', true) : !hasData || !carrierData.length ? empty(message)
      : `<div class="table-scroll"><table class="data-table"><thead><tr><th>Carrier</th><th>Flights</th><th>On-time departure</th><th>Avg delay</th></tr></thead><tbody>${carrierData.map((item) =>
        `<tr data-testid="row-carrier-${escapeHtml(item.code)}"><td><span class="code-pill">${escapeHtml(item.code)}</span></td><td>${number(item.flights)}</td><td class="on-time-cell"><div class="table-bar"><span>${one(item.onTimeDeparturePct)}%</span><div class="bar-track"><div class="bar-fill" style="width:${Math.max(0, Math.min(100, item.onTimeDeparturePct))}%"></div></div></div></td><td>${one(item.avgDepartureDelayMinutes)} min</td></tr>`,
      ).join('')}</tbody></table><p class="chart-note">Sorted by departure volume. Carrier codes are BTS reporting-carrier codes.</p></div>`;

  const totalCauseMinutes = causeData.reduce((sum, item) => sum + item.minutes, 0);
  $('arrival-panel').innerHTML = invalid ? empty(message) : summary.pending || causes.pending ? loading(250)
    : summary.error || causes.error ? empty('Arrival outcomes could not be retrieved.', true)
      : !hasData ? empty(message) : `<div class="mini-kpis"><div><strong data-testid="text-arrival-flights">${number(summary.data.arrivalFlights)}</strong><span>Arrival records</span></div><div><strong data-testid="text-arrival-delay">${one(summary.data.avgArrivalDelayMinutes)}</strong><span>Avg arrival delay, min</span></div><div><strong data-testid="text-diversions">${number(summary.data.divertedFlights)}</strong><span>Diverted flights</span></div></div><div class="panel-kicker cause-heading">BTS-reported arrival delay causes / minutes</div>${causeData.length ? causeData.map((item) =>
        `<div class="cause-row" data-testid="row-cause-${escapeHtml(item.cause.replace(/\W+/g, '-'))}"><div class="cause-line"><span>${escapeHtml(item.cause)}</span><strong>${number(item.minutes)} min</strong></div><div class="cause-track"><div class="cause-fill" style="width:${totalCauseMinutes ? item.minutes / totalCauseMinutes * 100 : 0}%"></div></div></div>`,
      ).join('') : empty('No arrival-delay cause minutes were reported for this selection.')}<p class="chart-note">Cause minutes are reported at the destination for these departing flights; they are not causes of departure delay. Categories may not sum to total arrival delay.</p>`;
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
  if (action === 'retry-airlines') loadAvailableAirlines();
  if (action === 'remove-rule') {
    const id = Number(event.target.closest('[data-rule-id]')?.dataset.ruleId);
    state.rules = state.rules.filter((rule) => rule.id !== id);
    renderRules();
    loadResults();
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
  $('airline-value').textContent = state.airlines.size ? [...state.airlines].sort().join(', ') : 'All airlines';
  updateQueryChips();
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
  state.airlines.clear();
  $('airline-menu').hidden = true;
  $('airline-trigger').setAttribute('aria-expanded', 'false');
  loadAvailableAirlines();
  loadResults();
});
for (const id of ['from', 'to']) $(id).addEventListener('change', loadResults);
for (const id of ['compare-from', 'compare-to']) $(id).addEventListener('change', loadComparison);
$('compare-reset').addEventListener('click', () => {
  $('compare-from').value = '';
  $('compare-to').value = '';
  loadComparison();
});
$('compare-refresh').addEventListener('click', async () => {
  $('compare-refresh').disabled = true;
  await Promise.all([loadMetadata(), loadComparison(), loadHubOptions(true)]);
  $('compare-refresh').disabled = false;
});
window.addEventListener('hashchange', switchView);
$('advanced-toggle').addEventListener('click', () => {
  const expanded = $('advanced-toggle').getAttribute('aria-expanded') !== 'true';
  $('advanced-toggle').setAttribute('aria-expanded', String(expanded));
  $('advanced-body').hidden = !expanded;
});
$('add-rule').addEventListener('click', () => {
  state.rules.push({ id: state.nextRuleId++, column: 'flights', operator: 'gte', value: '0' });
  renderRules();
  loadResults();
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
  updateQueryChips();
  loadResults();
});
$('rule-list').addEventListener('input', (event) => {
  if (!event.target.matches('.rule-value')) return;
  const rule = state.rules.find((item) => item.id === Number(event.target.closest('[data-rule-id]').dataset.ruleId));
  if (rule) rule.value = event.target.value;
  if (state.controller) state.controller.abort();
  state.requestId++;
  const valid = validateRules();
  updateQueryChips();
  state.results = valid
    ? Object.fromEntries(Object.keys(paths).map((name) => [name, { pending: true }]))
    : {};
  renderResults(valid ? '' : 'Complete each record rule with a nonnegative whole number.');
  clearTimeout(ruleInputTimer);
  if (valid) ruleInputTimer = setTimeout(loadResults, 350);
});
$('metric-options').addEventListener('change', (event) => {
  if (event.target.type !== 'checkbox') return;
  if (event.target.checked) state.shownMetrics.add(event.target.value);
  else state.shownMetrics.delete(event.target.value);
  $('metric-choice-count').textContent = `${state.shownMetrics.size} of ${HEADLINE_METRICS.length + RAW_METRICS.length} cards shown`;
  renderResults();
});
$('reset-metrics').addEventListener('click', () => {
  state.shownMetrics = new Set(DEFAULT_METRICS);
  renderMetricChoices();
  renderResults();
});
$('reset-dates').addEventListener('click', () => {
  $('from').value = '';
  $('to').value = '';
  loadResults();
});
$('refresh').addEventListener('click', async () => {
  $('refresh').disabled = true;
  await Promise.all([loadMetadata(), loadAvailableAirlines(), loadResults()]);
  $('refresh').disabled = false;
});
Promise.all([loadMetadata(), loadAvailableAirlines(), loadResults()]);
switchView();