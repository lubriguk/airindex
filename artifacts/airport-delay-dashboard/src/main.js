import { disposeChart, renderDailyChart, renderWeekdayChart } from './charts.js';

const CODES = ['ATL', 'DFW', 'DEN', 'ORD', 'LAX', 'JFK', 'LGA', 'EWR', 'SFO', 'SEA', 'CLT', 'PHX', 'MIA', 'PHL', 'DCA', 'IAD', 'IAH', 'DTW', 'MSP', 'SLC', 'BOS', 'PDX', 'ANC', 'HNL', 'DAL', 'HOU', 'MDW', 'BWI', 'LAS', 'MCO', 'FLL', 'SJU'];
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const fmt = new Intl.NumberFormat('en-US');
const $ = (id) => document.getElementById(id);
const apiRoot = new URL('api/', new URL(import.meta.env.BASE_URL, window.location.origin));
const state = {
  airports: { pending: true }, status: { pending: true },
  results: {}, requestId: 0, controller: null, metadataId: 0,
};
const paths = {
  summary: 'delays/summary', daily: 'delays/daily', carriers: 'delays/carriers',
  causes: 'delays/causes', weekday: 'delays/weekday',
};

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
  $('from').max = $('to').value || data?.lastDate || '';
  $('to').max = data?.lastDate || '';
  $('to').min = $('from').value || '';
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
}

function filterValues() {
  return { airport: $('airport').value, ...($('from').value && { from: $('from').value }), ...($('to').value && { to: $('to').value }) };
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

async function loadResults() {
  if (state.controller) state.controller.abort();
  const id = ++state.requestId;
  if (!validateDates()) {
    state.results = {};
    renderResults(true);
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

function renderResults(invalid = false) {
  const { summary = { pending: true }, daily = { pending: true }, carriers = { pending: true },
    causes = { pending: true }, weekday = { pending: true } } = state.results;
  const airport = $('airport').value || 'ATL';
  const selected = state.airports.data?.find((item) => item.code === airport);
  $('snapshot-label').textContent = `01 / Airport snapshot — ${airport}${selected ? ` · ${selected.city}` : ''}`;
  $('period-label').textContent = $('from').value || $('to').value
    ? `${$('from').value ? dateLabel($('from').value) : 'First available'} → ${$('to').value ? dateLabel($('to').value) : 'Latest available'}`
    : 'Full available period';
  const message = invalid ? 'Choose a date range with the start on or before the end.'
    : state.status.data?.importing ? 'The BTS dataset is still being imported. Figures will appear when records for this selection are available.'
      : 'No reported departing flights match this airport and date range. Try the full available period or another airport.';
  const hasData = !!summary.data && summary.data.flights > 0;

  $('metrics').innerHTML = invalid ? empty(message) : summary.pending ? loading(140).repeat(4)
    : summary.error ? empty('The airport snapshot could not be retrieved. Check the connection and retry.', true)
      : !hasData ? empty(message) : [
        metric('On-time departures', `${one(summary.data.onTimeDeparturePct)}%`, 'Departed less than 15 minutes late'),
        metric('Flights scheduled', number(summary.data.flights), `${number(summary.data.delayedDepartures)} departed 15+ min late`),
        metric('Avg departure delay', `${one(summary.data.avgDepartureDelayMinutes)} min`, 'Average across reported departures'),
        metric('Cancellation rate', `${one(summary.data.cancellationPct)}%`, `${number(summary.data.cancelledFlights)} cancelled flights`),
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
renderResults();
document.addEventListener('click', (event) => {
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'retry') loadResults();
  if (action === 'retry-metadata') loadMetadata();
});
$('airport').addEventListener('change', loadResults);
for (const id of ['from', 'to']) $(id).addEventListener('change', loadResults);
$('reset-dates').addEventListener('click', () => {
  $('from').value = '';
  $('to').value = '';
  loadResults();
});
$('refresh').addEventListener('click', async () => {
  $('refresh').disabled = true;
  await Promise.all([loadMetadata(), loadResults()]);
  $('refresh').disabled = false;
});
Promise.all([loadMetadata(), loadResults()]);