const SVG_NS = 'http://www.w3.org/2000/svg';
const TEAL = '#217f89';
const AMBER = '#d99b4c';
const GRID = '#dce6e6';
const TICK = '#758d94';
let chartId = 0;
const resizeObservers = new WeakMap();

const number = (value) => value === null || value === undefined || value === ''
  ? null : Number.isFinite(Number(value)) ? Number(value) : null;
const fmtOne = (value) => value === null ? '—' : value.toFixed(1);

function svgElement(name, attributes = {}, text) {
  const element = document.createElementNS(SVG_NS, name);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
  if (text !== undefined) element.textContent = text;
  return element;
}

function formatDate(value) {
  const parsed = typeof value === 'string' ? new Date(`${value.slice(0, 10)}T00:00:00`) : null;
  return parsed && !Number.isNaN(parsed.getTime())
    ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(parsed)
    : String(value ?? 'Date unavailable');
}

function shortDate(value) {
  const parsed = typeof value === 'string' ? new Date(`${value.slice(0, 10)}T00:00:00`) : null;
  return parsed && !Number.isNaN(parsed.getTime())
    ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(parsed)
    : String(value ?? '');
}

function chartWidth(container) {
  return Math.max(1, Math.round(container.getBoundingClientRect().width || container.clientWidth || 800));
}

function renderResponsive(container, draw) {
  const previous = resizeObservers.get(container);
  if (previous) previous.disconnect();
  draw(chartWidth(container));
  if (typeof ResizeObserver === 'undefined') return;

  let lastWidth = chartWidth(container);
  const observer = new ResizeObserver((entries) => {
    const nextWidth = Math.round(entries[0]?.contentRect.width || 0);
    if (!nextWidth || nextWidth === lastWidth) return;
    lastWidth = nextWidth;
    requestAnimationFrame(() => {
      if (resizeObservers.get(container) === observer) draw(chartWidth(container));
    });
  });
  resizeObservers.set(container, observer);
  observer.observe(container);
}

export function disposeChart(container) {
  if (!container) return;
  resizeObservers.get(container)?.disconnect();
  resizeObservers.delete(container);
}

function makeChart(container, width, description, instructions) {
  container.replaceChildren();
  const frame = document.createElement('div');
  frame.style.cssText = 'position:relative;width:100%;height:270px;min-width:0;';
  const svg = svgElement('svg', {
    viewBox: `0 0 ${width} 270`,
    preserveAspectRatio: 'none',
    role: 'group',
    'aria-label': description,
    style: 'display:block;width:100%;height:100%;overflow:visible;',
  });
  const title = svgElement('title', {}, description);
  const desc = svgElement('desc', {}, instructions || `${description} Focus chart marks to reveal exact values.`);
  svg.append(title, desc);
  const tooltip = document.createElement('div');
  tooltip.className = 'chart-tooltip';
  tooltip.setAttribute('role', 'status');
  tooltip.setAttribute('aria-live', 'polite');
  tooltip.hidden = true;
  tooltip.style.cssText = 'position:absolute;z-index:2;pointer-events:none;max-width:min(260px,90%);';
  frame.append(svg, tooltip);
  container.append(frame);
  return { frame, svg, tooltip };
}

function addTooltipRow(tooltip, label, value, color) {
  const row = document.createElement('div');
  if (color) {
    const swatch = document.createElement('span');
    swatch.style.cssText = `display:inline-block;width:6px;height:6px;background:${color};margin-right:7px;`;
    swatch.setAttribute('aria-hidden', 'true');
    row.append(swatch);
  }
  row.append(document.createTextNode(`${label}: ${value}`));
  tooltip.append(row);
}

function showTooltip(tooltip, frame, event, anchor, heading, rows) {
  tooltip.replaceChildren();
  const strong = document.createElement('strong');
  strong.textContent = heading;
  tooltip.append(strong);
  rows.forEach((row) => addTooltipRow(tooltip, row.label, row.value, row.color));
  tooltip.hidden = false;

  const rect = frame.getBoundingClientRect();
  const viewWidth = frame.querySelector('svg').viewBox.baseVal.width;
  const scaleX = rect.width / viewWidth;
  const scaleY = rect.height / 270;
  const pointX = event && Number.isFinite(event.clientX) && event.type.startsWith('pointer')
    ? event.clientX - rect.left
    : anchor.x * scaleX;
  const pointY = event && Number.isFinite(event.clientY) && event.type.startsWith('pointer')
    ? event.clientY - rect.top
    : anchor.y * scaleY;
  const left = Math.max(4, Math.min(rect.width - tooltip.offsetWidth - 4, pointX + 12));
  const top = Math.max(4, Math.min(rect.height - tooltip.offsetHeight - 4, pointY - tooltip.offsetHeight - 10));
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function attachTooltip(mark, tooltip, frame, anchor, heading, rows, label) {
  mark.setAttribute('tabindex', '0');
  mark.setAttribute('role', 'img');
  mark.setAttribute('aria-label', label);
  const reveal = (event) => showTooltip(tooltip, frame, event, anchor, heading, rows);
  mark.addEventListener('pointerenter', reveal);
  mark.addEventListener('pointermove', reveal);
  mark.addEventListener('focus', reveal);
  mark.addEventListener('pointerleave', () => { tooltip.hidden = true; });
  mark.addEventListener('blur', () => { tooltip.hidden = true; });
}

function niceMax(value) {
  if (!Number.isFinite(value) || value <= 0) return 10;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const fraction = value / magnitude;
  const step = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return step * magnitude;
}

function addText(svg, x, y, text, attributes = {}) {
  svg.append(svgElement('text', {
    x, y, fill: TICK, 'font-size': 11, 'font-family': "'Space Mono', monospace",
    'text-anchor': 'end', ...attributes,
  }, text));
}

export function renderDailyChart(container, data) {
  renderResponsive(container, (width) => drawDailyChart(container, data, width));
}

function drawDailyChart(container, data, chartWidth) {
  const records = Array.isArray(data) ? data.map((item) => ({
    ...item,
    pct: number(item.onTimeDeparturePct),
    delay: number(item.avgDepartureDelayMinutes),
    flights: number(item.flights),
  })).filter((item) => item.pct !== null || item.delay !== null) : [];
  const { frame, svg, tooltip } = makeChart(
    container,
    chartWidth,
    'Daily on-time departure percentage and average departure delay',
    'Daily observations. Press Tab to focus the first day, then use Left and Right Arrow keys to inspect each day. Hover anywhere in the plot to inspect the nearest day.',
  );
  const left = 43;
  const right = 41;
  const top = 18;
  const bottom = 226;
  const plotWidth = chartWidth - left - right;
  const height = bottom - top;
  const delayValues = records.map((item) => item.delay).filter((value) => value !== null);
  const delayMax = niceMax(delayValues.reduce((max, value) => Math.max(max, value), 0));
  const yPct = (value) => bottom - Math.max(0, Math.min(100, value)) / 100 * height;
  const yDelay = (value) => bottom - Math.max(0, Math.min(delayMax, value)) / delayMax * height;

  for (let tick = 0; tick <= 4; tick += 1) {
    const y = top + height * tick / 4;
    const pct = 100 - tick * 25;
    const delay = delayMax * (4 - tick) / 4;
    svg.append(svgElement('line', {
      x1: left, x2: chartWidth - right, y1: y, y2: y,
      stroke: GRID, 'stroke-dasharray': '3 4',
    }));
    addText(svg, left - 9, y + 4, `${pct}%`);
    addText(svg, chartWidth - right + 7, y + 4, `${Math.round(delay * 10) / 10}`, { 'text-anchor': 'start', fill: '#b3844e' });
  }

  if (!records.length) {
    addText(svg, chartWidth / 2, 128, 'No daily observations available', { 'text-anchor': 'middle', fill: TICK });
    return;
  }

  const x = (index) => records.length === 1 ? left + plotWidth / 2 : left + index * plotWidth / (records.length - 1);
  const pctPoints = records.map((item, index) => item.pct === null ? null : [x(index), yPct(item.pct)]);
  const delayPoints = records.map((item, index) => item.delay === null ? null : [x(index), yDelay(item.delay)]);
  const pathFor = (points) => {
    let path = '';
    let drawing = false;
    points.forEach((point) => {
      if (!point) { drawing = false; return; }
      path += `${drawing ? ' L' : ' M'}${point[0]} ${point[1]}`;
      drawing = true;
    });
    return path.trim();
  };
  const areaSegments = [];
  let segment = [];
  pctPoints.forEach((point) => {
    if (point) segment.push(point);
    else if (segment.length) { areaSegments.push(segment); segment = []; }
  });
  if (segment.length) areaSegments.push(segment);

  const defs = svgElement('defs');
  chartId += 1;
  const gradient = svgElement('linearGradient', { id: `daily-area-${chartId}`, x1: 0, y1: 0, x2: 0, y2: 1 });
  gradient.append(
    svgElement('stop', { offset: '0%', 'stop-color': TEAL, 'stop-opacity': '.24' }),
    svgElement('stop', { offset: '100%', 'stop-color': TEAL, 'stop-opacity': '.015' }),
  );
  defs.append(gradient);
  svg.append(defs);
  const gradientId = gradient.getAttribute('id');
  areaSegments.forEach((points) => {
    const line = points.map(([px, py], index) => `${index ? 'L' : 'M'}${px} ${py}`).join(' ');
    const area = `${line} L${points[points.length - 1][0]} ${bottom} L${points[0][0]} ${bottom} Z`;
    svg.append(svgElement('path', { d: area, fill: `url(#${gradientId})`, stroke: 'none' }));
  });
  const pctPath = pathFor(pctPoints);
  const delayPath = pathFor(delayPoints);
  if (pctPath) svg.append(svgElement('path', { d: pctPath, fill: 'none', stroke: TEAL, 'stroke-width': 2.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
  if (delayPath) svg.append(svgElement('path', { d: delayPath, fill: 'none', stroke: AMBER, 'stroke-width': 1.8, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));

  const maxDateTicks = Math.max(2, Math.floor(plotWidth / 76));
  const dateStep = Math.max(1, Math.ceil(records.length / maxDateTicks));
  records.forEach((item, index) => {
    const px = x(index);
    if (index % dateStep === 0 || index === records.length - 1) {
      addText(svg, px, bottom + 22, shortDate(item.date), {
        'text-anchor': index === 0 ? 'start' : index === records.length - 1 ? 'end' : 'middle',
        'font-size': 10,
      });
    }
  });

  const pointDetails = (index) => {
    const item = records[index];
    const rows = [];
    if (item.pct !== null) rows.push({ label: 'On-time departures', value: `${fmtOne(item.pct)}%`, color: TEAL });
    if (item.delay !== null) rows.push({ label: 'Departure delay', value: `${fmtOne(item.delay)} min`, color: AMBER });
    if (item.flights !== null) rows.push({ label: 'Flights', value: new Intl.NumberFormat('en-US').format(item.flights) });
    const heading = formatDate(item.date);
    const label = `${heading}. ${rows.map((row) => `${row.label}: ${row.value}`).join('. ')}`;
    return { item, rows, heading, label, x: x(index), y: item.pct !== null ? yPct(item.pct) : yDelay(item.delay) };
  };
  const showIndex = (index, event) => {
    const detail = pointDetails(index);
    showTooltip(tooltip, frame, event, { x: detail.x, y: detail.y }, detail.heading, detail.rows);
    return detail;
  };

  const hitArea = svgElement('rect', {
    x: left, y: top, width: plotWidth, height,
    fill: 'transparent', 'pointer-events': 'all', 'aria-hidden': 'true',
  });
  hitArea.addEventListener('pointermove', (event) => {
    const rect = svg.getBoundingClientRect();
    const localX = (event.clientX - rect.left) * chartWidth / rect.width;
    const index = Math.max(0, Math.min(records.length - 1,
      Math.round((localX - left) / plotWidth * Math.max(0, records.length - 1))));
    showIndex(index, event);
  });
  hitArea.addEventListener('pointerleave', () => { tooltip.hidden = true; });
  svg.append(hitArea);

  const keyboardPoint = svgElement('circle', {
    cx: x(0), cy: pointDetails(0).y, r: 6,
    fill: '#f8faf9', stroke: TEAL, 'stroke-width': 2,
    opacity: 0, 'pointer-events': 'none', tabindex: 0,
    'data-chart-point': 'daily-keyboard',
  });
  keyboardPoint.setAttribute('role', 'img');
  keyboardPoint.setAttribute('aria-label', pointDetails(0).label);
  keyboardPoint.addEventListener('focus', (event) => {
    keyboardPoint.setAttribute('opacity', '1');
    showIndex(Number(keyboardPoint.dataset.index || 0), event);
  });
  keyboardPoint.addEventListener('blur', () => {
    keyboardPoint.setAttribute('opacity', '0');
    tooltip.hidden = true;
  });
  keyboardPoint.addEventListener('keydown', (event) => {
    let next = Number(keyboardPoint.dataset.index || 0);
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = Math.min(records.length - 1, next + 1);
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = Math.max(0, next - 1);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = records.length - 1;
    else return;
    event.preventDefault();
    const detail = pointDetails(next);
    keyboardPoint.dataset.index = String(next);
    keyboardPoint.setAttribute('cx', detail.x);
    keyboardPoint.setAttribute('cy', detail.y);
    keyboardPoint.setAttribute('aria-label', detail.label);
    showTooltip(tooltip, frame, event, { x: detail.x, y: detail.y }, detail.heading, detail.rows);
  });
  keyboardPoint.dataset.index = '0';
  svg.append(keyboardPoint);
}

export function renderWeekdayChart(container, data) {
  renderResponsive(container, (width) => drawWeekdayChart(container, data, width));
}

function drawWeekdayChart(container, data, chartWidth) {
  const records = Array.isArray(data) ? data.map((item) => ({
    ...item,
    pct: number(item.onTimeDeparturePct),
    flights: number(item.flights),
  })).filter((item) => item.pct !== null) : [];
  const { frame, svg, tooltip } = makeChart(container, chartWidth, 'On-time departure percentage by day of week');
  const left = 43;
  const right = 12;
  const top = 18;
  const bottom = 226;
  const plotWidth = chartWidth - left - right;
  const height = bottom - top;

  for (let tick = 0; tick <= 4; tick += 1) {
    const y = top + height * tick / 4;
    const pct = 100 - tick * 25;
    svg.append(svgElement('line', {
      x1: left, x2: chartWidth - right, y1: y, y2: y,
      stroke: GRID, 'stroke-dasharray': '3 4',
    }));
    addText(svg, left - 9, y + 4, `${pct}%`);
  }

  if (!records.length) {
    addText(svg, chartWidth / 2, 128, 'No weekday observations available', { 'text-anchor': 'middle', fill: TICK });
    return;
  }

  const slot = plotWidth / records.length;
  const barWidth = Math.min(58, slot * 0.64);
  records.forEach((item, index) => {
    const center = left + slot * (index + 0.5);
    const value = Math.max(0, Math.min(100, item.pct));
    const barHeight = value / 100 * height;
    const bar = svgElement('rect', {
      x: center - barWidth / 2,
      y: bottom - barHeight,
      width: barWidth,
      height: barHeight,
      rx: 2,
      fill: TEAL,
      'data-chart-point': 'weekday',
    });
    const heading = item.dayOfWeek || `Day ${index + 1}`;
    const rows = [
      { label: 'On-time departures', value: `${fmtOne(item.pct)}%`, color: TEAL },
      ...(item.flights !== null ? [{ label: 'Flights', value: new Intl.NumberFormat('en-US').format(item.flights) }] : []),
    ];
    const accessible = `${heading}. ${rows.map((row) => `${row.label}: ${row.value}`).join('. ')}`;
    attachTooltip(bar, tooltip, frame, { x: center, y: bottom - barHeight }, heading, rows, accessible);
    svg.append(bar);
    addText(svg, center, bottom + 22, heading.slice(0, 3), {
      'text-anchor': 'middle',
      'font-size': 10,
    });
  });
}