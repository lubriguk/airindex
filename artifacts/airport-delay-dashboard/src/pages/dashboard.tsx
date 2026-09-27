import { useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, Database, ExternalLink, FileText, Plane, RefreshCw, RotateCcw, Signal, TriangleAlert } from 'lucide-react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListAirports, useGetDataStatus, useGetDelaySummary, useGetDailyDelays,
  useGetCarrierDelays, useGetDelayCauses, useGetWeekdayDelays,
  getGetDelaySummaryQueryKey, getGetDailyDelaysQueryKey, getGetCarrierDelaysQueryKey,
  getGetDelayCausesQueryKey, getGetWeekdayDelaysQueryKey,
  type AirportParameter, type DailyDelay, type WeekdayDelay,
} from '@workspace/api-client-react';

const CODES = ['ATL','DFW','DEN','ORD','LAX','JFK','LGA','EWR','SFO','SEA','CLT','PHX','MIA','PHL','DCA','IAD','IAH','DTW','MSP','SLC','BOS','PDX','ANC','HNL','DAL','HOU','MDW','BWI','LAS','MCO','FLL','SJU'] as const;
const SOURCE = 'https://www.transtats.bts.gov/Fields.asp?gnoyr_VQ=FGJ';
const ink = '#217f89';
const amber = '#d99b4c';
const fmt = (value: number) => new Intl.NumberFormat('en-US').format(value);
const one = (value: number) => Number.isFinite(value) ? value.toFixed(1) : '—';
const dateLabel = (value?: string | null) => {
  if (!value) return 'Not available';
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(year, month - 1, day));
};
const shortDate = (value: string) => {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(year, month - 1, day));
};

function Empty({ kind = 'empty', message, onRetry }: { kind?: 'empty' | 'error'; message: string; onRetry?: () => void }) {
  return <div className="state-box" role={kind === 'error' ? 'alert' : 'status'} data-testid={`status-${kind}-${message.slice(0, 12).replace(/\W/g,'-')}`}>
    {kind === 'error' ? <TriangleAlert size={23} strokeWidth={1.5} /> : <Database size={24} strokeWidth={1.5} />}
    <strong>{kind === 'error' ? 'Could not load this view' : 'No observations in this view'}</strong>
    <p>{message}</p>
    {onRetry && <button type="button" onClick={onRetry} data-testid="button-retry-section">Try again</button>}
  </div>;
}
function Loading({ height = 220 }: { height?: number }) {
  return <div aria-label="Loading data" role="status" style={{ height, padding: '30px 24px', display:'flex', flexDirection:'column', justifyContent:'space-between' }}>
    <div className="skeleton" style={{ width:'28%' }} /><div className="skeleton" style={{ width:'76%', height:'40%' }} /><div className="skeleton" style={{ width:'95%' }} />
  </div>;
}
function Panel({ index, title, caption, children }: { index: string; title: string; caption?: string; children: ReactNode }) {
  return <section className="panel">
    <div className="panel-head"><div><div className="panel-kicker">{index}</div><h2 className="panel-title">{title}</h2></div>{caption && <div className="panel-caption">{caption}</div>}</div>
    <div className="panel-body">{children}</div>
  </section>;
}
function ChartTooltip({ active, payload, label, suffix = '' }: { active?: boolean; payload?: Array<{ name?: string; value?: number; color?: string }>; label?: string; suffix?: string }) {
  if (!active || !payload?.length) return null;
  return <div className="chart-tooltip"><strong>{label && /^\d{4}-\d{2}-\d{2}/.test(label) ? dateLabel(label) : label}</strong>{payload.map((entry, i) => <div key={i}><span style={{display:'inline-block',width:6,height:6,background:entry.color ?? '#8bd5d0',marginRight:7}} />{entry.name}: {typeof entry.value === 'number' ? one(entry.value) : '—'}{entry.name?.includes('delay') ? ' min' : suffix}</div>)}</div>;
}
function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return <div className="metric"><div className="metric-label">{label}</div><div className="metric-value" data-testid={`text-metric-${label.toLowerCase().replace(/\W+/g,'-')}`}>{value}</div><div className="metric-note">{note}</div></div>;
}
function ChartLegend({ secondary = false }: { secondary?: boolean }) {
  return <div className="chart-legend"><span className="legend-item"><i className="legend-swatch" style={{background:ink}} /> On-time departures</span>{secondary && <span className="legend-item"><i className="legend-swatch" style={{background:amber}} /> Departure delay, min</span>}</div>;
}

export default function Dashboard() {
  const queryClient = useQueryClient();
  const [airport, setAirport] = useState<AirportParameter>('ATL');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [dateError, setDateError] = useState('');
  const airports = useListAirports();
  const status = useGetDataStatus();
  const params = useMemo(() => ({ airport, ...(from ? { from } : {}), ...(to ? { to } : {}) }), [airport, from, to]);
  const valid = !from || !to || from <= to;
  const summary = useGetDelaySummary(params, { query: { enabled: valid, queryKey: getGetDelaySummaryQueryKey(params) } });
  const daily = useGetDailyDelays(params, { query: { enabled: valid, queryKey: getGetDailyDelaysQueryKey(params) } });
  const carriers = useGetCarrierDelays(params, { query: { enabled: valid, queryKey: getGetCarrierDelaysQueryKey(params) } });
  const causes = useGetDelayCauses(params, { query: { enabled: valid, queryKey: getGetDelayCausesQueryKey(params) } });
  const weekdays = useGetWeekdayDelays(params, { query: { enabled: valid, queryKey: getGetWeekdayDelaysQueryKey(params) } });
  const selectedAirport = airports.data?.find(item => item.code === airport);
  const hasSummary = !!summary.data && summary.data.flights > 0;
  const refreshing = [airports, status, summary, daily, carriers, causes, weekdays].some(q => q.isFetching && !q.isPending);
  const resetDates = () => { setFrom(''); setTo(''); setDateError(''); };
  const changeDate = (which: 'from' | 'to', value: string) => {
    const nextFrom = which === 'from' ? value : from;
    const nextTo = which === 'to' ? value : to;
    setDateError(nextFrom && nextTo && nextFrom > nextTo ? 'Start date must be on or before end date.' : '');
    if (which === 'from') setFrom(value); else setTo(value);
  };
  const refresh = () => queryClient.invalidateQueries({ predicate: q => String(q.queryKey[0]).startsWith('/api/') });
  const dataMessage = status.data?.importing ? 'The BTS dataset is still being imported. Figures will appear when records for this selection are available.' : 'No reported departing flights match this airport and date range. Try the full available period or another airport.';
  const hasData = !summary.isPending && hasSummary;
  const dailyData = (daily.data ?? []).filter((item: DailyDelay) => item.flights > 0).slice().sort((a,b) => a.date.localeCompare(b.date));
  const weekdayOrder = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  const weekdayData = (weekdays.data ?? []).filter((item: WeekdayDelay) => item.flights > 0).slice().sort((a,b) => {
    const order = (day: string) => { const n = weekdayOrder.findIndex(d => d.toLowerCase().startsWith(day.toLowerCase().slice(0,3))); return n < 0 ? 99 : n; };
    return order(a.dayOfWeek) - order(b.dayOfWeek);
  }).map(item => ({...item, day: item.dayOfWeek.slice(0,3)}));
  const carrierData = (carriers.data ?? []).filter(item => item.flights > 0).slice().sort((a,b) => b.flights - a.flights);
  const causeData = (causes.data ?? []).filter(item => item.minutes > 0).slice().sort((a,b) => b.minutes - a.minutes);
  const totalCauseMinutes = causeData.reduce((sum,item) => sum + item.minutes, 0);

  return <div className="app-shell">
    <header className="topbar"><div className="brand"><div className="brand-mark"><Plane size={18} strokeWidth={1.8} /></div><span className="brand-name">AIR / INDEX</span><span className="brand-divider" /><span className="brand-sub">Departure reliability research</span></div>
      <div className="top-right"><span className="desktop-only">BTS · Reporting carriers</span><span><i className="live-dot" />{status.data?.importing ? 'Importing data' : status.data?.totalFlights ? 'Dataset available' : 'Coverage pending'}</span></div>
    </header>
    <main className="dashboard">
      <div className="page-head fade-in"><div><div className="eyebrow">Research desk / Airport performance</div><h1 className="page-title">Departure reliability</h1><p className="page-desc">A closer look at when flights leave, who flies them, and what happens next.</p></div><div className="head-stamp"><Signal size={16} /> ORIGIN-BASED ANALYSIS / 15-MIN THRESHOLD</div></div>
      <div className="filter-panel fade-in" aria-label="Dashboard filters">
        <label className="field field-airport"><span className="field-label">Departure airport</span><span className="select-wrap"><select className="control select-control" value={airport} onChange={e => setAirport(e.target.value as AirportParameter)} data-testid="select-airport" aria-label="Departure airport">{CODES.map(code => {
          const match = airports.data?.find(item => item.code === code);
          return <option key={code} value={code}>{code}{match ? ` — ${match.city} · ${match.name}` : ''}</option>;
        })}</select><ChevronDown className="select-chevron" size={16} /></span></label>
        <label className="field"><span className="field-label">From</span><input className="control" type="date" value={from} max={to || status.data?.lastDate || undefined} onChange={e => changeDate('from',e.target.value)} data-testid="input-from-date" /></label>
        <label className="field"><span className="field-label">To</span><input className="control" type="date" value={to} min={from || undefined} max={status.data?.lastDate || undefined} onChange={e => changeDate('to',e.target.value)} data-testid="input-to-date" /></label>
        <div className="filter-actions"><button className="icon-button" type="button" onClick={resetDates} title="Show all available dates" data-testid="button-reset-dates"><RotateCcw size={15} /> All dates</button><button className="icon-button" type="button" onClick={refresh} disabled={refreshing} title="Refresh dataset" data-testid="button-refresh-data"><RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} /> Refresh</button></div>
        {dateError && <p className="filter-error" role="alert" data-testid="status-date-error">{dateError}</p>}
      </div>
      <section className="coverage fade-in" aria-label="Dataset coverage" data-testid="section-data-coverage">
        <div className="coverage-primary"><div className="coverage-icon"><Database size={20} strokeWidth={1.5} /></div><div><div className="coverage-label">Dataset provenance</div><div className="coverage-value">BTS On-Time Performance</div></div></div>
        <div className="coverage-cell"><div className="coverage-label">Available records</div><strong data-testid="text-total-records">{status.isPending ? 'Loading…' : status.isError ? 'Unavailable' : fmt(status.data?.totalFlights ?? 0)}</strong></div>
        <div className="coverage-cell"><div className="coverage-label">Date coverage</div><strong data-testid="text-date-coverage" style={{fontSize:14, lineHeight:1.45}}>{status.isPending ? 'Loading…' : status.isError ? 'Unavailable' : status.data?.firstDate && status.data?.lastDate ? `${dateLabel(status.data.firstDate)} – ${dateLabel(status.data.lastDate)}` : 'No dates loaded'}</strong></div>
        <div className="coverage-cell"><div className="coverage-label">Source & scope</div><strong style={{fontSize:13,letterSpacing:0}}><a href={SOURCE} target="_blank" rel="noopener noreferrer" data-testid="link-bts-source">Official BTS fields <ExternalLink size={12} style={{display:'inline'}} /></a></strong><span style={{fontSize:11,color:'#a5c4c9'}}>{status.data?.loadedMonths?.length ?? 0} months loaded · all airports</span></div>
      </section>
      {airports.isError && <div className="import-note" role="alert" data-testid="status-airports-error">Airport names could not be loaded. Airport code selection remains available. <button onClick={() => airports.refetch()} data-testid="button-retry-airports" style={{textDecoration:'underline'}}>Retry</button></div>}
      {status.isError && <div className="import-note" role="alert" data-testid="status-coverage-error">Dataset coverage is unavailable. Metrics may still load, but date completeness cannot be verified. <button onClick={() => status.refetch()} data-testid="button-retry-coverage" style={{textDecoration:'underline'}}>Retry</button></div>}
      {status.data?.importing && <div className="import-note" role="status" data-testid="status-importing">BTS records are being imported. Current figures may cover only part of the published dataset; check the dates above before interpreting results.</div>}
      <div className="section-label"><span>01 / Airport snapshot — {airport}{selectedAirport ? ` · ${selectedAirport.city}` : ''}</span><span>{from || to ? `${from ? dateLabel(from) : 'First available'} → ${to ? dateLabel(to) : 'Latest available'}` : 'Full available period'}</span></div>
      {summary.isPending ? <div className="metrics"><Loading height={140}/><Loading height={140}/><Loading height={140}/><Loading height={140}/></div> :
       summary.isError ? <Empty kind="error" message="The airport snapshot could not be retrieved. Check the connection and retry." onRetry={() => summary.refetch()} /> :
       !hasSummary ? <Empty message={dataMessage} /> :
       <div className="metrics fade-in">
         <Metric label="On-time departures" value={`${one(summary.data!.onTimeDeparturePct)}%`} note="Departed less than 15 minutes late" />
         <Metric label="Flights scheduled" value={fmt(summary.data!.flights)} note={`${fmt(summary.data!.delayedDepartures)} departed 15+ min late`} />
         <Metric label="Avg departure delay" value={`${one(summary.data!.avgDepartureDelayMinutes)} min`} note="Average across reported departures" />
         <Metric label="Cancellation rate" value={`${one(summary.data!.cancellationPct)}%`} note={`${fmt(summary.data!.cancelledFlights)} cancelled flights`} />
       </div>}
      <div className="content-grid fade-in">
        <Panel index="02 / Daily trend" title="How the days performed" caption={dailyData.length ? `${fmt(dailyData.length)} reported days` : undefined}>
          {daily.isPending ? <Loading /> : daily.isError ? <Empty kind="error" message="Daily records could not be retrieved." onRetry={() => daily.refetch()} /> : !hasData || !dailyData.length ? <Empty message={dataMessage} /> :
          <><ChartLegend secondary /><div style={{height:270,marginTop:17}}><ResponsiveContainer width="100%" height="100%" debounce={0}><AreaChart data={dailyData} margin={{top:8,right:10,bottom:0,left:-16}}>
            <defs><linearGradient id="onTimeGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={ink} stopOpacity={.24}/><stop offset="100%" stopColor={ink} stopOpacity={.015}/></linearGradient></defs>
            <CartesianGrid vertical={false} stroke="#dce6e6" strokeDasharray="3 4" /><XAxis dataKey="date" tickFormatter={shortDate} tick={{fill:'#758d94',fontSize:11}} tickLine={false} axisLine={false} minTickGap={33}/><YAxis yAxisId="pct" domain={[0,100]} tickFormatter={value=>`${value}%`} tick={{fill:'#758d94',fontSize:11}} tickLine={false} axisLine={false}/><YAxis yAxisId="min" orientation="right" tick={{fill:'#b3844e',fontSize:11}} tickLine={false} axisLine={false} width={28}/>
            <Tooltip content={<ChartTooltip suffix="%" />} isAnimationActive={false} cursor={{stroke:'#5e9399',strokeDasharray:'3 4'}} /><Area yAxisId="pct" type="monotone" dataKey="onTimeDeparturePct" name="On-time departures" stroke={ink} strokeWidth={2.5} fill="url(#onTimeGradient)" isAnimationActive={false} activeDot={{r:5,fill:ink,stroke:'#f8faf9',strokeWidth:2}} /><Line yAxisId="min" type="monotone" dataKey="avgDepartureDelayMinutes" name="Departure delay" stroke={amber} strokeWidth={1.8} dot={false} isAnimationActive={false} activeDot={{r:4,fill:amber}} />
          </AreaChart></ResponsiveContainer></div><p className="chart-note">Each point represents a day with reported departures. Gaps in source coverage are not interpolated.</p></>}
        </Panel>
        <Panel index="03 / Day of week" title="The weekly rhythm" caption="ON-TIME DEPARTURE RATE">
          {weekdays.isPending ? <Loading /> : weekdays.isError ? <Empty kind="error" message="Weekday records could not be retrieved." onRetry={() => weekdays.refetch()} /> : !hasData || !weekdayData.length ? <Empty message={dataMessage} /> :
          <><ChartLegend /><div style={{height:270,marginTop:17}}><ResponsiveContainer width="100%" height="100%" debounce={0}><BarChart data={weekdayData} margin={{top:8,right:0,bottom:0,left:-18}} barCategoryGap="28%">
            <CartesianGrid vertical={false} stroke="#dce6e6" strokeDasharray="3 4" /><XAxis dataKey="day" tick={{fill:'#758d94',fontSize:11}} tickLine={false} axisLine={false}/><YAxis domain={[0,100]} tickFormatter={value=>`${value}%`} tick={{fill:'#758d94',fontSize:11}} tickLine={false} axisLine={false}/><Tooltip content={<ChartTooltip suffix="%" />} isAnimationActive={false} cursor={false}/><Bar dataKey="onTimeDeparturePct" name="On-time departures" fill={ink} radius={[2,2,0,0]} isAnimationActive={false} activeBar={{fill:'#12394a'}} />
          </BarChart></ResponsiveContainer></div><p className="chart-note">Aggregated by departure day, not arrival day. Hover to inspect rates.</p></>}
        </Panel>
        <Panel index="04 / Carrier comparison" title="Who operates here" caption={carrierData.length ? `${carrierData.length} reporting carriers` : undefined}>
          {carriers.isPending ? <Loading height={250} /> : carriers.isError ? <Empty kind="error" message="Carrier records could not be retrieved." onRetry={() => carriers.refetch()} /> : !hasData || !carrierData.length ? <Empty message={dataMessage} /> :
          <div className="table-scroll"><table className="data-table"><thead><tr><th>Carrier</th><th>Flights</th><th>On-time departure</th><th>Avg delay</th></tr></thead><tbody>{carrierData.map(item => <tr key={item.code} data-testid={`row-carrier-${item.code}`}><td><span className="code-pill">{item.code}</span></td><td>{fmt(item.flights)}</td><td style={{minWidth:130}}><div style={{display:'flex',alignItems:'center',gap:9}}><span style={{minWidth:40,fontFamily:'Space Mono',fontSize:11}}>{one(item.onTimeDeparturePct)}%</span><div className="bar-track"><div className="bar-fill" style={{width:`${Math.max(0,Math.min(100,item.onTimeDeparturePct))}%`}} /></div></div></td><td>{one(item.avgDepartureDelayMinutes)} min</td></tr>)}</tbody></table><p className="chart-note">Sorted by departure volume. Carrier codes are BTS reporting-carrier codes.</p></div>}
        </Panel>
        <Panel index="05 / Arrival outcomes" title="What happened after takeoff" caption="FOR FLIGHTS DEPARTING THIS AIRPORT">
          {summary.isPending || causes.isPending ? <Loading height={250} /> : summary.isError || causes.isError ? <Empty kind="error" message="Arrival outcomes could not be retrieved." onRetry={() => { summary.refetch(); causes.refetch(); }} /> : !hasData ? <Empty message={dataMessage} /> :
          <><div className="mini-kpis" style={{borderTop:0,marginTop:0,marginBottom:17}}><div><strong data-testid="text-arrival-flights">{fmt(summary.data!.arrivalFlights)}</strong><span>Arrival records</span></div><div><strong data-testid="text-arrival-delay">{one(summary.data!.avgArrivalDelayMinutes)}</strong><span>Avg arrival delay, min</span></div><div><strong data-testid="text-diversions">{fmt(summary.data!.divertedFlights)}</strong><span>Diverted flights</span></div></div>
          <div className="panel-kicker" style={{margin:'20px 0 7px'}}>BTS-reported arrival delay causes / minutes</div>
          {!causeData.length ? <Empty message="No arrival-delay cause minutes were reported for this selection." /> : causeData.map(item => <div className="cause-row" key={item.cause} data-testid={`row-cause-${item.cause.replace(/\W+/g,'-')}`}><div className="cause-line"><span>{item.cause}</span><strong>{fmt(item.minutes)} min</strong></div><div className="cause-track"><div className="cause-fill" style={{width:`${totalCauseMinutes ? item.minutes / totalCauseMinutes * 100 : 0}%`}} /></div></div>)}
          <p className="chart-note">Cause minutes are reported at the destination for these departing flights; they are not causes of departure delay. Categories may not sum to total arrival delay.</p></>}
        </Panel>
      </div>
      <footer className="footer"><p><strong>Reading the numbers.</strong> “On time” means departure delay under 15 minutes. Cancellation and diversion are separate flight outcomes. Averages and percentages reflect only records available in the selected range; absence of records is never shown as zero performance.</p><p><FileText size={14} style={{display:'inline',marginRight:6}} />Source: <a href={SOURCE} target="_blank" rel="noopener noreferrer" data-testid="link-footer-bts">Bureau of Transportation Statistics</a><br/>Reporting Carrier On-Time Performance{status.data?.sourceUrl?.startsWith('https://') && <><br/><a href={status.data.sourceUrl} target="_blank" rel="noopener noreferrer" data-testid="link-dataset-source">Dataset source</a></>}</p></footer>
    </main>
  </div>;
}