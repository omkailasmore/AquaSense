// Ingestion, rule-based detection, simulator. Rules are plain thresholds - not AI.
import { db, getSettings } from './db.js';

const iso = () => new Date().toISOString();
const blank = () => ({ highRun: 0, devRun: 0, lowRun: 0, contSince: null, baseline: null, baseN: 0 });
const mem = { physical: blank(), simulator: blank() };
export const resetMemory = (src) => { mem[src] = blank(); };

export function raiseAlert(source, type, severity, message) {
  const t = iso();
  const open = db.prepare('SELECT id FROM alerts WHERE source=? AND type=? AND resolved=0').get(source, type);
  if (open) { // de-duplicate: bump the counter instead of adding a new row
    db.prepare('UPDATE alerts SET last_ts=?, count=count+1 WHERE id=?').run(t, open.id);
    return null;
  }
  return db.prepare('INSERT INTO alerts(source,type,severity,message,first_ts,last_ts) VALUES(?,?,?,?,?,?)')
    .run(source, type, severity, message, t, t).lastInsertRowid;
}
const clearAlerts = (source, types) =>
  db.prepare(`UPDATE alerts SET resolved=1 WHERE source=? AND resolved=0 AND type IN (${types.map(() => '?').join(',')})`).run(source, ...types);

const upsertDevice = (source, p, status, ts) =>
  db.prepare(`INSERT INTO devices(source,device_id,last_seen,last_status,last_rssi) VALUES(?,?,?,?,?)
    ON CONFLICT(source) DO UPDATE SET device_id=excluded.device_id,last_seen=excluded.last_seen,last_status=excluded.last_status,last_rssi=excluded.last_rssi`)
    .run(source, p.deviceId, ts, status, p.rssi ?? null);

/** Store one reading and run detection. Flow is recomputed from pulses so calibration lives in Settings. */
export function ingest(source, p) {
  const s = getSettings(), m = mem[source], ts = iso();
  const failed = p.sensorStatus === 'error';
  const litres = failed ? null : p.pulseCount / s.pulsesPerLitre;
  const flow = failed ? null : litres / (p.intervalMs / 60000);

  if (flow !== null && flow > 60) {
    raiseAlert(source, 'invalid', 'warning', `Invalid reading: ${flow.toFixed(1)} L/min is outside the sensor's physical range. Check wiring and calibration.`);
    return { error: `Calculated flow ${flow.toFixed(1)} L/min is outside the plausible range; reading rejected.` };
  }
  const id = db.prepare('INSERT INTO readings(source,device_id,ts,flow_lpm,pulses,interval_ms,litres,sensor_status,rssi) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(source, p.deviceId, ts, flow, p.pulseCount, p.intervalMs, litres, failed ? 'error' : 'online', p.rssi ?? null).lastInsertRowid;
  upsertDevice(source, p, failed ? 'error' : 'online', ts);

  if (failed) { raiseAlert(source, 'sensor_error', 'critical', 'Sensor error: the device reports a problem reading the flow sensor.'); return { id, flow, litres }; }
  clearAlerts(source, ['offline', 'sensor_error']);

  const need = s.persistenceReadings;
  // Rule 1: flow above the configured maximum for N consecutive readings
  m.highRun = flow > s.maxFlowLpm ? m.highRun + 1 : 0;
  if (m.highRun >= need) raiseAlert(source, 'high_flow', 'warning', `High flow: ${flow.toFixed(2)} L/min is above the ${s.maxFlowLpm} L/min limit.`);

  // Rule 2: unexpected continuous flow (a drip or leak never reaches zero)
  if (flow >= s.continuousFlowLpm) { m.lowRun = 0; m.contSince ??= Date.now(); }
  else if (++m.lowRun >= 2) m.contSince = null;
  if (m.contSince && Date.now() - m.contSince >= s.continuousFlowMinutes * 60000) {
    const mins = ((Date.now() - m.contSince) / 60000).toFixed(1);
    raiseAlert(source, 'continuous_flow', 'critical', `Possible leakage: abnormal flow detected. Water has flowed without stopping for ${mins} min (above ${s.continuousFlowLpm} L/min).`);
  }

  // Rule 3: deviation from a learned baseline (moving average of normal flowing readings)
  if (flow >= s.continuousFlowLpm) {
    const learn = () => { m.baseline = m.baseline == null ? flow : 0.9 * m.baseline + 0.1 * flow; m.baseN++; };
    if (m.baseN >= 20 && m.baseline > 0) {
      const dev = Math.abs(flow - m.baseline) / m.baseline * 100;
      if (dev > s.baselineDeviationPct) {
        if (++m.devRun >= need) raiseAlert(source, 'baseline_deviation', 'warning', `Abnormal flow: ${flow.toFixed(2)} L/min is ${dev.toFixed(0)}% away from the learned baseline of ${m.baseline.toFixed(2)} L/min.`);
      } else { m.devRun = 0; learn(); }
    } else learn();
  }
  return { id, flow, litres };
}

/** Raise "offline" if the active source has gone quiet. */
export function watchdog() {
  const s = getSettings();
  const source = s.mode === 'simulation' ? 'simulator' : 'physical';
  if (source === 'simulator' && !sim.running) return;
  const dev = db.prepare('SELECT last_seen FROM devices WHERE source=?').get(source);
  if (!dev) return;
  const age = (Date.now() - Date.parse(dev.last_seen)) / 1000;
  if (age > s.offlineSeconds) raiseAlert(source, 'offline', 'critical', `Device offline: no data received for ${Math.round(age)} s (limit ${s.offlineSeconds} s).`);
}

export function systemStatus(source, dayStart) {
  const s = getSettings();
  const dev = db.prepare('SELECT * FROM devices WHERE source=?').get(source);
  const ageSeconds = dev ? (Date.now() - Date.parse(dev.last_seen)) / 1000 : null;
  const online = !!dev && ageSeconds <= s.offlineSeconds;
  const open = db.prepare('SELECT type, acknowledged FROM alerts WHERE source=? AND resolved=0').all(source);
  const has = (t) => open.some((a) => a.type === t);
  let label, level, detail;
  if (source === 'simulator' && !sim.running) [label, level, detail] = ['Simulator stopped', 'mute', 'Start the simulator in Settings.'];
  else if (!dev) [label, level, detail] = [source === 'physical' ? 'Awaiting device' : 'No simulated data yet', 'mute', source === 'physical' ? 'No reading has been received from the ESP8266 yet.' : 'Waiting for the first simulated reading.'];
  else if (!online) [label, level, detail] = ['Device offline', 'crit', `No data for ${Math.round(ageSeconds)} s.`];
  else if (dev.last_status === 'error') [label, level, detail] = ['Sensor error', 'crit', 'The device reports a sensor problem.'];
  else if (has('continuous_flow') || (has('high_flow') && has('baseline_deviation'))) [label, level, detail] = ['Possible leak', 'crit', 'Rule-based detection flagged abnormal flow. Inspect the line.'];
  else if (open.length) [label, level, detail] = ['Warning', 'warn', 'One or more alerts need attention.'];
  else [label, level, detail] = ['Normal', 'ok', 'Flow is within the configured limits.'];

  const sum = (from) => db.prepare('SELECT COALESCE(SUM(litres),0) v FROM readings WHERE source=? AND ts>=?').get(source, from).v;
  return {
    system: { label, level, detail },
    device: { online, ageSeconds, lastSeen: dev?.last_seen ?? null, status: dev?.last_status ?? null, deviceId: dev?.device_id ?? null, rssi: dev?.last_rssi ?? null },
    totals: { allTime: sum('0000'), today: sum(dayStart || '0000') },
    activeAlerts: open.filter((a) => !a.acknowledged).length,
  };
}

// ---------------- Simulator (writes only source='simulator') ----------------
export const sim = { running: false, scenario: 'demo', current: null, demoIdx: 0, phaseTicks: 0 };
const DEMO = [['idle', 5], ['normal', 30], ['high', 6], ['normal', 15], ['abnormal', 7], ['normal', 12], ['offline', 15], ['normal', 15]]; // 2 s ticks
const jitter = () => Math.random() - 0.5;
const FLOW = { idle: () => 0, normal: () => 2 + jitter() * 0.3, high: () => 18 + jitter(), abnormal: () => 8 + jitter(), leak: () => 0.6 + jitter() * 0.1, offline: () => null };
export const SCENARIOS = ['demo', ...Object.keys(FLOW)];

export function simTick() {
  const s = getSettings();
  if (!sim.running || s.mode !== 'simulation') return;
  let sc = sim.scenario;
  if (sc === 'demo') {
    const [name, len] = DEMO[sim.demoIdx];
    sc = name;
    if (++sim.phaseTicks >= len) { sim.phaseTicks = 0; sim.demoIdx = (sim.demoIdx + 1) % DEMO.length; }
  }
  sim.current = sc;
  const flow = FLOW[sc]();
  if (flow == null) return; // offline phase: no data at all
  const intervalMs = 2000;
  ingest('simulator', { deviceId: 'simulator', pulseCount: Math.max(0, Math.round(flow * s.pulsesPerLitre * intervalMs / 60000)), intervalMs, sensorStatus: 'online' });
}

export function seedHistory(hours = 48) {
  const s = getSettings(), end = Date.now();
  const ins = db.prepare('INSERT INTO readings(source,device_id,ts,flow_lpm,pulses,interval_ms,litres,sensor_status) VALUES(?,?,?,?,?,?,?,?)');
  db.transaction(() => {
    for (let i = hours * 60; i > 0; i--) {
      const t = new Date(end - i * 60000), h = t.getHours() + t.getMinutes() / 60;
      const peak = Math.exp(-((h - 7.5) ** 2) / 2) + 0.8 * Math.exp(-((h - 19) ** 2) / 3);
      const flow = Math.max(0, peak * 3 * (0.7 + Math.random() * 0.6) - 0.15), litres = flow / 60;
      ins.run('simulator', 'simulator', t.toISOString(), flow, Math.round(litres * s.pulsesPerLitre), 60000, litres, 'online');
    }
  })();
  return hours * 60;
}

export function clearSimulatorData() {
  return db.transaction(() => {
    const r = db.prepare("DELETE FROM readings WHERE source='simulator'").run().changes;
    const a = db.prepare("DELETE FROM alerts WHERE source='simulator'").run().changes;
    db.prepare("DELETE FROM devices WHERE source='simulator'").run();
    resetMemory('simulator');
    return { readings: r, alerts: a };
  })();
}
