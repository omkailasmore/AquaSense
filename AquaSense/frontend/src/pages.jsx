import { useEffect, useMemo, useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Download, Check, CheckCheck } from 'lucide-react';
import { api, usePoll } from './api.js';
import { Btn, C, Card, Empty, ErrorNote, Pill, SourceBadge, Stat, ago, dt, fmt, time } from './ui.jsx';

const TIP = { contentStyle: { background: '#111A2B', border: '1px solid #1F2B42', borderRadius: 8, fontSize: 12 } };
const Axes = ({ unit }) => (<><CartesianGrid stroke={C.grid} vertical={false} /><XAxis dataKey="t" stroke={C.axis} fontSize={11} minTickGap={40} /><YAxis stroke={C.axis} fontSize={11} width={40} unit={unit} /><Tooltip {...TIP} /></>);
const useReadings = (src, ms, limit = 150) => usePoll(() => api(`/readings?source=${src}&limit=${limit}`), ms, [src]);

function FlowChart({ rows, h = 220 }) {
  if (!rows.length) return <Empty>No readings yet. Data appears here as soon as the source reports.</Empty>;
  return (
    <ResponsiveContainer width="100%" height={h}>
      <AreaChart data={rows}><defs><linearGradient id="fg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={C.blue} stopOpacity={0.45} /><stop offset="1" stopColor={C.blue} stopOpacity={0} /></linearGradient></defs>
        <Axes /><Area type="monotone" dataKey="flow" name="L/min" stroke={C.blue} fill="url(#fg)" strokeWidth={2} isAnimationActive={false} connectNulls={false} /></AreaChart>
    </ResponsiveContainer>
  );
}
const toRows = (rs = []) => { let cum = 0; return rs.map((r) => ({ t: time(r.ts), flow: r.flowRateLpm, cum: (cum += r.litres || 0) })); };
const devLabel = (st) => (!st ? '—' : st.device.online ? 'Online' : st.device.lastSeen ? 'Offline' : 'Not connected');

export function Overview({ status: st, src, ms }) {
  const { data, error } = useReadings(src, ms);
  const rows = useMemo(() => toRows(data?.readings), [data]);
  const latest = data?.readings.at(-1);
  const live = st?.device.online && latest;
  return (
    <>
      <div className="flex items-center justify-between"><SourceBadge src={src} />{st && <span className="text-sm text-slate-400">{st.system.detail}</span>}</div>
      <ErrorNote error={error} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Flow rate" className="lg:col-span-2">
          <div className="mb-2 text-4xl font-semibold">{live ? fmt(latest.flowRateLpm) : '—'}<span className="ml-2 text-base font-normal text-slate-400">L/min</span></div>
          <FlowChart rows={rows} />
        </Card>
        <div className="grid grid-cols-2 content-start gap-4 lg:grid-cols-1">
          <Stat label="System status" value={st?.system.label ?? '—'} tone={st?.system.level === 'crit' ? 'crit' : st?.system.level === 'warn' ? 'warn' : undefined} />
          <Stat label="Active alerts" value={st?.activeAlerts ?? '—'} hint="Unacknowledged" tone={st?.activeAlerts ? 'crit' : undefined} />
          <Stat label="Sensor connection" value={devLabel(st)} hint={`Last data ${ago(st?.device.lastSeen)}`} />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Stat label="Total volume measured" value={fmt(st?.totals.allTime)} unit="L" hint="All stored readings for this source" />
        <Stat label="Estimated usage today" value={fmt(st?.totals.today)} unit="L" hint="Derived: pulses ÷ pulses-per-litre" />
        <Stat label="Pressure" value="Not available" hint="No pressure sensor connected" />
      </div>
      <Card title="Cumulative usage (recent readings window)">
        {rows.length ? <ResponsiveContainer width="100%" height={180}><LineChart data={rows}><Axes unit=" L" /><Line dataKey="cum" name="Litres" stroke={C.violet} dot={false} strokeWidth={2} isAnimationActive={false} /></LineChart></ResponsiveContainer> : <Empty>No readings yet.</Empty>}
      </Card>
    </>
  );
}

export function Live({ status: st, src, ms }) {
  const { data, error } = useReadings(src, ms, 120);
  const rs = data?.readings || [], rows = useMemo(() => toRows(rs), [data]), last = rs.at(-1);
  return (
    <>
      <div className="flex flex-wrap items-center gap-2"><SourceBadge src={src} /><Pill tone={st?.device.online ? 'ok' : 'crit'}>{devLabel(st)}</Pill></div>
      <ErrorNote error={error} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Flow rate" value={st?.device.online && last ? fmt(last.flowRateLpm) : '—'} unit="L/min" />
        <Stat label="Pulses (last interval)" value={last?.pulseCount ?? '—'} hint={last ? `${fmt(last.pulseCount / (last.intervalMs / 1000), 1)} pulses/s over ${fmt(last.intervalMs / 1000, 1)} s` : 'No data'} />
        <Stat label="Litres measured" value={fmt(st?.totals.allTime)} unit="L" hint="Cumulative, stored readings" />
        <Stat label="Last reading" value={time(last?.ts)} hint={ago(last?.ts)} />
      </div>
      <Card title="Live flow rate"><FlowChart rows={rows} h={260} /></Card>
      <Card title="Latest readings">
        {rs.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-xs text-slate-500"><tr><th className="py-1">Time</th><th>Pulses</th><th>L/min</th><th>Litres</th><th>Status</th></tr></thead>
          <tbody>{rs.slice(-12).reverse().map((r) => <tr key={r.id} className="border-t border-line"><td className="py-1.5">{time(r.ts)}</td><td>{r.pulseCount}</td><td>{fmt(r.flowRateLpm)}</td><td>{fmt(r.litres, 4)}</td><td>{r.sensorStatus}</td></tr>)}</tbody></table></div> : <Empty>Nothing received yet.</Empty>}
      </Card>
    </>
  );
}

const SEV = { critical: 'crit', warning: 'warn' };
export function Alerts({ settings: s, src, ms, go }) {
  const [view, setView] = useState('open');
  const { data, error, reload } = usePoll(() => api(`/alerts?source=${src}&status=${view === 'open' ? 'open' : 'all'}`), ms, [src, view]);
  const act = async (id, body) => { await api(`/alerts/${id}`, { method: 'PATCH', body }); reload(); };
  const list = data?.alerts || [];
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">{[['open', 'Open'], ['all', 'All history']].map(([v, l]) => <Btn key={v} tone={view === v ? 'primary' : 'default'} onClick={() => setView(v)}>{l}</Btn>)}</div>
        <SourceBadge src={src} />
      </div>
      <ErrorNote error={error} />
      {s && <Card title="Active rules"><p className="text-sm text-slate-400">High flow above {s.maxFlowLpm} L/min · continuous flow above {s.continuousFlowLpm} L/min for {s.continuousFlowMinutes} min · {s.baselineDeviationPct}% deviation from learned baseline · offline after {s.offlineSeconds} s · each needs {s.persistenceReadings} consecutive readings. <button className="text-blue underline" onClick={() => go('settings')}>Edit thresholds</button></p></Card>}
      <div className="space-y-3">
        {list.length === 0 && <Card><Empty>{view === 'open' ? 'No open alerts.' : 'No alerts recorded for this source.'}</Empty></Card>}
        {list.map((a) => (
          <Card key={a.id} className={a.resolved ? 'opacity-60' : ''}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex flex-wrap items-center gap-2"><Pill tone={SEV[a.severity] || 'mute'}>{a.severity}</Pill>{a.acknowledged && <Pill>Acknowledged</Pill>}{a.resolved && <Pill>Resolved</Pill>}{a.count > 1 && <span className="text-xs text-slate-500">seen {a.count}×</span>}</div>
                <p className="text-sm">{a.message}</p>
                <p className="mt-1 text-xs text-slate-500">First {dt(a.firstTs)} · latest {dt(a.lastTs)}</p>
              </div>
              {!a.resolved && <div className="flex gap-2">{!a.acknowledged && <Btn onClick={() => act(a.id, { acknowledged: true })}><Check size={14} className="mr-1 inline" />Acknowledge</Btn>}<Btn onClick={() => act(a.id, { resolved: true })}><CheckCheck size={14} className="mr-1 inline" />Resolve</Btn></div>}
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}

const iso = (d) => d.toISOString();
export function Analytics({ src, ms }) {
  const [range, setRange] = useState('24h'), [bucket, setBucket] = useState('hour');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const win = useMemo(() => {
    const to = new Date();
    if (range === 'custom' && custom.from) return { from: iso(new Date(custom.from)), to: iso(custom.to ? new Date(custom.to + 'T23:59:59') : to) };
    return { from: iso(new Date(to - ({ '24h': 1, '7d': 7, '30d': 30 }[range] || 1) * 864e5)), to: iso(to) };
  }, [range, custom]);
  const q = `source=${src}&from=${encodeURIComponent(win.from)}&to=${encodeURIComponent(win.to)}`;
  const { data, error } = usePoll(() => api(`/analytics/summary?${q}&bucket=${bucket}&tz=${-new Date().getTimezoneOffset()}`), Math.max(ms * 5, 10000), [q, bucket]);
  const rows = useMemo(() => (data?.buckets || []).map((b) => ({ t: b.bucket.slice(bucket === 'day' ? 5 : 5), litres: +b.litres.toFixed(3), avg: +b.avgFlow.toFixed(3), max: +b.maxFlow.toFixed(3), alerts: data.alertBuckets.find((a) => a.bucket === b.bucket)?.alerts || 0 })), [data, bucket]);
  const tt = data?.totals;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {['24h', '7d', '30d', 'custom'].map((r) => <Btn key={r} tone={range === r ? 'primary' : 'default'} onClick={() => setRange(r)}>{r === 'custom' ? 'Custom' : `Last ${r}`}</Btn>)}
        {range === 'custom' && <><input type="date" aria-label="From" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} /><input type="date" aria-label="To" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} /></>}
        <select aria-label="Summary interval" value={bucket} onChange={(e) => setBucket(e.target.value)}><option value="hour">Hourly</option><option value="day">Daily</option></select>
        <SourceBadge src={src} />
      </div>
      <ErrorNote error={error} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total measured volume" value={fmt(tt?.litres)} unit="L" hint="Derived from pulse counts" />
        <Stat label="Readings stored" value={tt?.readings ?? '—'} />
        <Stat label="Average flow" value={fmt(tt?.avgFlow)} unit="L/min" hint="Mean of stored readings, including zeros" />
        <Stat label="Peak flow" value={fmt(tt?.peakFlow)} unit="L/min" />
      </div>
      <Card title={`Water usage per ${bucket} (litres, derived)`}>{rows.length ? <ResponsiveContainer width="100%" height={220}><BarChart data={rows}><Axes /><Bar dataKey="litres" fill={C.blue} radius={[3, 3, 0, 0]} isAnimationActive={false} /></BarChart></ResponsiveContainer> : <Empty>No stored readings in this range.</Empty>}</Card>
      <Card title={`Flow rate per ${bucket} (L/min)`}>{rows.length ? <ResponsiveContainer width="100%" height={220}><LineChart data={rows}><Axes /><Line dataKey="avg" name="Average" stroke={C.blue} dot={false} isAnimationActive={false} /><Line dataKey="max" name="Peak" stroke={C.violet} dot={false} isAnimationActive={false} /></LineChart></ResponsiveContainer> : <Empty>No stored readings in this range.</Empty>}</Card>
      <Card title="Alert frequency" right={<span className="text-xs text-slate-500">{(data?.bySeverity || []).map((s) => `${s.n} ${s.severity}`).join(' · ') || 'none'}</span>}>
        {rows.length ? <ResponsiveContainer width="100%" height={160}><BarChart data={rows}><Axes /><Bar dataKey="alerts" fill={C.violet} radius={[3, 3, 0, 0]} isAnimationActive={false} /></BarChart></ResponsiveContainer> : <Empty>No data in this range.</Empty>}
      </Card>
      <Card title="Export">
        <div className="flex flex-wrap gap-2">{['readings', 'alerts'].map((k) => <a key={k} href={`/api/export/${k}.csv?${q}`} className="inline-flex items-center gap-2 rounded-lg border border-line bg-ink px-3 py-1.5 text-sm hover:border-blue/60"><Download size={14} />{k === 'readings' ? 'Readings' : 'Alerts'} CSV</a>)}</div>
      </Card>
      <Card title="Future predictive analytics" right={<Pill>Not active</Pill>}>
        <p className="text-sm text-slate-400">No predictive model exists yet and nothing here is a forecast. A model would need weeks of real, labelled readings (including confirmed leak events) and a proper validation step. The stored history and CSV export are the starting point.</p>
      </Card>
    </>
  );
}

export function Sensor({ status: st, settings: s, src, ms, reload }) {
  const { data } = useReadings(src, ms, 100);
  const rs = data?.readings || [], last = rs.at(-1);
  const errors = rs.filter((r) => r.sensorStatus === 'error').length;
  const [pulses, setPulses] = useState(''), [litres, setLitres] = useState(''), [msg, setMsg] = useState('');
  const calc = pulses > 0 && litres > 0 ? Math.round(pulses / litres) : null;
  const apply = async () => { try { await api('/settings', { method: 'PUT', body: { pulsesPerLitre: calc } }); setMsg('Saved.'); reload(); } catch (e) { setMsg(e.message); } };
  const age = st?.device.ageSeconds, fresh = age != null && age <= (s?.offlineSeconds || 20);
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Connectivity" value={devLabel(st)} hint={st?.device.deviceId ? `Device ${st.device.deviceId}` : 'No device has reported yet'} />
        <Stat label="Data freshness" value={age == null ? '—' : fresh ? 'Fresh' : 'Stale'} hint={`Last data ${ago(st?.device.lastSeen)}`} tone={age != null && !fresh ? 'crit' : undefined} />
        <Stat label="Last pulse count" value={last?.pulseCount ?? '—'} hint={last ? `over ${fmt(last.intervalMs / 1000, 1)} s` : undefined} />
        <Stat label="Sensor errors (last 100)" value={errors} tone={errors ? 'crit' : undefined} hint={src === 'physical' && st?.device.rssi != null ? `Wi-Fi signal ${st.device.rssi} dBm` : undefined} />
      </div>
      <Card title="Sensor configuration">
        <dl className="grid gap-2 text-sm sm:grid-cols-2"><dt className="text-slate-400">Sensor</dt><dd>Sea ZJ-S201 pulse flow sensor (single)</dd><dt className="text-slate-400">Pulses per litre</dt><dd>{s?.pulsesPerLitre} <span className="text-slate-500">(initial estimate 450; calibrate below)</span></dd><dt className="text-slate-400">Formula</dt><dd>L/min = pulses ÷ pulses-per-litre ÷ interval in minutes</dd></dl>
      </Card>
      <Card title="Calibrate pulses per litre">
        <p className="mb-3 text-sm text-slate-400">Run the pump into a measuring jug. Enter the pulses counted and the litres collected (the Serial Monitor prints the pulses). Typical sensors vary, so measure rather than trust 450.</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-slate-400">Pulses counted<br /><input type="number" min="1" value={pulses} onChange={(e) => setPulses(e.target.value)} className="mt-1 w-32" /></label>
          <label className="text-xs text-slate-400">Litres collected<br /><input type="number" min="0.01" step="0.01" value={litres} onChange={(e) => setLitres(e.target.value)} className="mt-1 w-32" /></label>
          <div className="text-sm">Result: <b>{calc ?? '—'}</b> pulses/L</div>
          <Btn tone="primary" disabled={!calc} onClick={apply}>Save calibration</Btn>
          {msg && <span className="text-sm text-slate-400">{msg}</span>}
        </div>
      </Card>
    </>
  );
}

const FIELDS = [
  ['Device', [['deviceName', 'Device name', 'text'], ['deviceId', 'Device ID', 'text', 'Match DEVICE_ID in the firmware.']]],
  ['Flow thresholds', [['maxFlowLpm', 'Maximum flow', 'L/min'], ['continuousFlowLpm', 'Continuous-flow threshold', 'L/min', 'Flow at or above this counts as "flowing".'], ['continuousFlowMinutes', 'Continuous-flow duration', 'min', 'Flowing this long without stopping raises a possible-leak alert.']]],
  ['Anomaly detection', [['baselineDeviationPct', 'Baseline deviation', '%', 'Lower is more sensitive. Compared with a moving average of normal flow.'], ['persistenceReadings', 'Consecutive readings required', 'readings', 'Debounce: ignores single noisy readings.'], ['offlineSeconds', 'Offline after', 's']]],
  ['Sensor & display', [['pulsesPerLitre', 'Pulses per litre', 'pulses/L', 'Calibration. Applies to new readings.'], ['refreshSeconds', 'Dashboard refresh', 's']]],
];
export function SettingsPage({ settings: s, status: st, reload, src }) {
  const [draft, setDraft] = useState({}), [msg, setMsg] = useState(null);
  const health = usePoll(() => api('/health'), 5000);
  useEffect(() => { if (s) setDraft((d) => (Object.keys(d).length ? d : s)); }, [s]);
  const save = async () => { try { await api('/settings', { method: 'PUT', body: draft }); setMsg({ ok: 'Settings saved.' }); reload(); } catch (e) { setMsg({ err: e.message }); } };
  const simCall = async (path, method = 'POST', body) => { try { const r = await api(path, { method, body }); setMsg({ ok: JSON.stringify(r) }); reload(); } catch (e) { setMsg({ err: e.message }); } };
  const sim = s?.mode === 'simulation';
  return (
    <>
      <Card title="API connection" right={<Pill tone={health.error ? 'crit' : 'ok'}>{health.error ? 'Unreachable' : 'Connected'}</Pill>}>
        <p className="text-sm text-slate-400">{health.error || `Backend up ${health.data?.uptimeSeconds ?? '…'} s · SQLite storage · device key ${health.data?.deviceKeyRequired ? 'required' : 'not required'}`}</p>
      </Card>
      {FIELDS.map(([title, fields]) => (
        <Card key={title} title={title}>
          <div className="grid gap-4 sm:grid-cols-2">
            {fields.map(([k, label, unit, hint]) => (
              <label key={k} className="text-sm"><span className="text-slate-300">{label}</span>{unit !== 'text' && <span className="ml-1 text-slate-500">({unit})</span>}
                <input className="mt-1 w-full" type={unit === 'text' ? 'text' : 'number'} step="any" value={draft[k] ?? ''} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
                {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}</label>
            ))}
          </div>
        </Card>
      ))}
      <div className="flex items-center gap-3"><Btn tone="primary" onClick={save}>Save settings</Btn>{msg?.ok && <span className="break-all text-sm text-sky-300">{msg.ok}</span>}{msg?.err && <span className="text-sm text-red-300">{msg.err}</span>}</div>

      <Card title="Simulator" right={<Pill tone={sim ? 'warn' : 'mute'}>{sim ? (st?.simulator.running ? 'Running' : 'Stopped') : 'Simulation mode off'}</Pill>}>
        <p className="mb-3 text-sm text-slate-400">Switch to Simulation in the top bar to use this. Simulated rows are stored separately and are never counted as physical measurements.</p>
        <div className="mb-3 flex flex-wrap gap-2">
          {[['demo', 'Full demo cycle'], ['idle', 'No flow'], ['normal', 'Normal flow'], ['high', 'High flow'], ['abnormal', 'Abnormal event'], ['leak', 'Low continuous flow'], ['offline', 'Device offline']].map(([sc, l]) => <Btn key={sc} disabled={!sim} onClick={() => simCall('/simulator/control', 'POST', { action: 'start', scenario: sc })}>{l}</Btn>)}
        </div>
        <div className="flex flex-wrap gap-2">
          <Btn disabled={!sim} onClick={() => simCall('/simulator/control', 'POST', { action: 'stop' })}>Stop simulator</Btn>
          <Btn disabled={!sim} onClick={() => simCall('/simulator/seed')}>Add 48 h sample history</Btn>
          <Btn disabled={!sim} onClick={() => simCall('/simulator/test-alert')}>Generate test alert</Btn>
          <Btn onClick={() => confirm('Delete ALL simulated readings and alerts? Physical data is not touched.') && simCall('/simulator/data', 'DELETE')}>Clear simulated data</Btn>
        </div>
        <p className="mt-3 text-xs text-slate-500">Recovery to normal is part of the full demo cycle. “Low continuous flow” only alerts after the continuous-flow duration above (lower it to 1 min to see it).</p>
      </Card>
      <Card title="Not available yet">
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-400">
          <li>Pressure monitoring: no pressure sensor is connected, so no pressure values are shown or estimated.</li>
          <li>Leak location: one flow sensor cannot locate a leak. Alerts say “possible leakage” only.</li>
          <li>Pump control: disabled. The relay is not driven by this software. Wire and test it separately before enabling any control feature.</li>
        </ul>
      </Card>
    </>
  );
}
