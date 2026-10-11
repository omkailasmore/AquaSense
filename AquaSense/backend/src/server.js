import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { db, getSettings, saveSettings } from './db.js';
import { ingest, watchdog, systemStatus, sim, simTick, SCENARIOS, seedHistory, clearSimulatorData, raiseAlert } from './engine.js';

const PORT = Number(process.env.PORT) || 3001;
const HOST = process.env.HOST || '0.0.0.0'; // LAN only: the ESP8266 needs to reach the laptop. Do not port-forward this.
const API_KEY = process.env.DEVICE_API_KEY || '';
const started = Date.now();

const app = express();
app.use(cors());
app.use(express.json({ limit: '50kb' }));

const toIso = (v) => (v && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
const srcOf = (q) => (q === 'physical' || q === 'simulator' ? q : getSettings().mode === 'simulation' ? 'simulator' : 'physical');
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });

app.get('/api/health', (_q, res) => res.json({ ok: true, time: new Date().toISOString(), uptimeSeconds: Math.round((Date.now() - started) / 1000), database: 'sqlite', deviceKeyRequired: !!API_KEY }));

// ---- Device ingestion (always stored as source "physical") ----
app.post('/api/readings', (req, res) => {
  if (API_KEY && req.get('x-api-key') !== API_KEY) return bad(res, 'Missing or wrong x-api-key header.', 401);
  const b = req.body || {}, errs = [];
  if (typeof b.deviceId !== 'string' || !b.deviceId) errs.push('deviceId (string) is required');
  if (!Number.isInteger(b.pulseCount) || b.pulseCount < 0 || b.pulseCount > 1e6) errs.push('pulseCount must be an integer 0-1000000');
  if (!Number.isFinite(b.intervalMs) || b.intervalMs < 100 || b.intervalMs > 300000) errs.push('intervalMs must be 100-300000');
  if (b.sensorStatus !== undefined && !['online', 'error'].includes(b.sensorStatus)) errs.push('sensorStatus must be "online" or "error"');
  if (errs.length) {
    raiseAlert('physical', 'invalid', 'warning', `Invalid reading received: ${errs[0]}.`);
    return bad(res, errs.join('; '));
  }
  const r = ingest('physical', { deviceId: b.deviceId, pulseCount: b.pulseCount, intervalMs: b.intervalMs, sensorStatus: b.sensorStatus || 'online', rssi: Number.isFinite(b.rssi) ? b.rssi : null });
  if (r.error) return bad(res, r.error, 422);
  res.status(201).json({ ok: true, id: r.id, flowRateLpm: r.flow, litres: r.litres, serverTime: new Date().toISOString() });
});

const READING_COLS = 'id, source, device_id AS deviceId, ts, flow_lpm AS flowRateLpm, pulses AS pulseCount, interval_ms AS intervalMs, litres, sensor_status AS sensorStatus, rssi';
app.get('/api/readings/latest', (req, res) => {
  const row = db.prepare(`SELECT ${READING_COLS} FROM readings WHERE source=? ORDER BY ts DESC LIMIT 1`).get(srcOf(req.query.source));
  res.json({ reading: row || null });
});
app.get('/api/readings', (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 200, 1), 5000);
  const rows = db.prepare(`SELECT * FROM (SELECT ${READING_COLS} FROM readings WHERE source=? AND ts>=? AND ts<=? ORDER BY ts DESC LIMIT ?) ORDER BY ts`)
    .all(srcOf(req.query.source), toIso(req.query.from) || '0000', toIso(req.query.to) || '9999', limit);
  res.json({ readings: rows, truncated: rows.length === limit, limit });
});

// ---- Alerts ----
const ALERT_COLS = 'id, source, type, severity, message, first_ts AS firstTs, last_ts AS lastTs, count, acknowledged, resolved';
app.get('/api/alerts', (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 100, 1), 1000);
  const open = req.query.status === 'open' ? 'AND resolved=0' : '';
  const rows = db.prepare(`SELECT ${ALERT_COLS} FROM alerts WHERE source=? AND first_ts>=? AND first_ts<=? ${open} ORDER BY last_ts DESC LIMIT ?`)
    .all(srcOf(req.query.source), toIso(req.query.from) || '0000', toIso(req.query.to) || '9999', limit);
  res.json({ alerts: rows.map((a) => ({ ...a, acknowledged: !!a.acknowledged, resolved: !!a.resolved })) });
});
app.patch('/api/alerts/:id', (req, res) => {
  const id = Number(req.params.id), b = req.body || {};
  if (!db.prepare('SELECT 1 FROM alerts WHERE id=?').get(id)) return bad(res, 'Alert not found.', 404);
  if (b.resolved === true) db.prepare('UPDATE alerts SET resolved=1, acknowledged=1 WHERE id=?').run(id);
  else if (b.acknowledged === true) db.prepare('UPDATE alerts SET acknowledged=1 WHERE id=?').run(id);
  else return bad(res, 'Send {"acknowledged":true} or {"resolved":true}.');
  res.json({ ok: true });
});

// ---- Status & analytics ----
app.get('/api/status', (req, res) => {
  const s = getSettings(), source = s.mode === 'simulation' ? 'simulator' : 'physical';
  res.json({ mode: s.mode, source, serverTime: new Date().toISOString(), ...systemStatus(source, toIso(req.query.dayStart)),
    simulator: { running: sim.running, scenario: sim.scenario, phase: sim.current }, pressure: { available: false } });
});
app.get('/api/analytics/summary', (req, res) => {
  const source = srcOf(req.query.source);
  const to = toIso(req.query.to) || new Date().toISOString();
  const from = toIso(req.query.from) || new Date(Date.parse(to) - 24 * 3600e3).toISOString();
  const tz = Math.max(-840, Math.min(840, parseInt(req.query.tz) || 0));
  const fmt = req.query.bucket === 'day' ? '%Y-%m-%d' : '%Y-%m-%d %H:00';
  const mod = `${tz} minutes`;
  const totals = db.prepare('SELECT COALESCE(SUM(litres),0) litres, COUNT(*) readings, AVG(flow_lpm) avgFlow, MAX(flow_lpm) peakFlow FROM readings WHERE source=? AND ts>=? AND ts<=? AND flow_lpm IS NOT NULL').get(source, from, to);
  const buckets = db.prepare('SELECT strftime(?, ts, ?) bucket, SUM(litres) litres, AVG(flow_lpm) avgFlow, MAX(flow_lpm) maxFlow, COUNT(*) readings FROM readings WHERE source=? AND ts>=? AND ts<=? AND flow_lpm IS NOT NULL GROUP BY bucket ORDER BY bucket').all(fmt, mod, source, from, to);
  const alertBuckets = db.prepare('SELECT strftime(?, first_ts, ?) bucket, COUNT(*) alerts FROM alerts WHERE source=? AND first_ts>=? AND first_ts<=? GROUP BY bucket ORDER BY bucket').all(fmt, mod, source, from, to);
  const bySeverity = db.prepare('SELECT severity, COUNT(*) n FROM alerts WHERE source=? AND first_ts>=? AND first_ts<=? GROUP BY severity').all(source, from, to);
  res.json({ source, from, to, bucket: req.query.bucket === 'day' ? 'day' : 'hour', totals, buckets, alertBuckets, bySeverity,
    note: 'Litres are derived from pulse count divided by the configured pulses-per-litre value.' });
});

// ---- CSV export ----
const csv = (rows) => {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]), esc = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v);
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
};
app.get('/api/export/:kind.csv', (req, res) => {
  const source = srcOf(req.query.source), from = toIso(req.query.from) || '0000', to = toIso(req.query.to) || '9999';
  let rows;
  if (req.params.kind === 'readings') rows = db.prepare(`SELECT ${READING_COLS} FROM readings WHERE source=? AND ts>=? AND ts<=? ORDER BY ts LIMIT 200000`).all(source, from, to);
  else if (req.params.kind === 'alerts') rows = db.prepare(`SELECT ${ALERT_COLS} FROM alerts WHERE source=? AND first_ts>=? AND first_ts<=? ORDER BY first_ts`).all(source, from, to);
  else return bad(res, 'Export kind must be "readings" or "alerts".', 404);
  res.type('text/csv').attachment(`aquasense-${source}-${req.params.kind}.csv`).send(csv(rows) || 'no data\n');
});

// ---- Settings ----
app.get('/api/settings', (_q, res) => res.json({ settings: getSettings(), pressureSensor: false, pumpControl: 'disabled' }));
app.put('/api/settings', (req, res) => {
  const r = saveSettings(req.body);
  if (r.errors) return bad(res, r.errors.join('; '));
  if (r.settings.mode !== 'simulation') sim.running = false;
  res.json(r);
});

// ---- Simulator (simulation mode only; never writes physical rows) ----
const needSim = (res) => (getSettings().mode === 'simulation' ? true : (bad(res, 'Switch to Simulation Mode first.', 409), false));
app.post('/api/simulator/control', (req, res) => {
  if (!needSim(res)) return;
  const { action, scenario } = req.body || {};
  if (action === 'start') { sim.running = true; if (scenario) { if (!SCENARIOS.includes(scenario)) return bad(res, `Unknown scenario. Use: ${SCENARIOS.join(', ')}`); sim.scenario = scenario; sim.demoIdx = 0; sim.phaseTicks = 0; } }
  else if (action === 'stop') sim.running = false;
  else return bad(res, 'action must be "start" or "stop".');
  res.json({ simulator: { running: sim.running, scenario: sim.scenario } });
});
app.post('/api/simulator/seed', (_q, res) => { if (needSim(res)) res.json({ inserted: seedHistory(48) }); });
app.post('/api/simulator/test-alert', (_q, res) => {
  if (!needSim(res)) return;
  const t = Date.now() % 100000;
  raiseAlert('simulator', 'test', 'warning', 'Test alert: generated manually from Settings. This is not a real detection.');
  res.json({ ok: true, ref: t });
});
app.delete('/api/simulator/data', (_q, res) => res.json({ deleted: clearSimulatorData(), note: 'Only simulator rows were removed. Physical readings are untouched.' }));

app.use('/api', (_q, res) => bad(res, 'Unknown API route.', 404));
app.use((err, _q, res, _n) => { console.error(err); bad(res, 'Server error: ' + err.message, err.type === 'entity.parse.failed' ? 400 : 500); });

setInterval(simTick, 2000);
setInterval(watchdog, 2000);
app.listen(PORT, HOST, () => console.log(`AquaSense backend listening on http://${HOST}:${PORT}  (API: /api/health)`));
