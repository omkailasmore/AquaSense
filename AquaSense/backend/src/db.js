import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const file = process.env.DB_PATH || path.join(here, '..', 'data', 'aquasense.db');
fs.mkdirSync(path.dirname(file), { recursive: true });

export const db = new Database(file);
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS readings(
  id INTEGER PRIMARY KEY, source TEXT NOT NULL, device_id TEXT, ts TEXT NOT NULL,
  flow_lpm REAL, pulses INTEGER, interval_ms INTEGER, litres REAL, sensor_status TEXT, rssi INTEGER);
CREATE INDEX IF NOT EXISTS idx_readings ON readings(source, ts);
CREATE TABLE IF NOT EXISTS alerts(
  id INTEGER PRIMARY KEY, source TEXT NOT NULL, type TEXT NOT NULL, severity TEXT NOT NULL, message TEXT NOT NULL,
  first_ts TEXT NOT NULL, last_ts TEXT NOT NULL, count INTEGER DEFAULT 1, acknowledged INTEGER DEFAULT 0, resolved INTEGER DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_alerts ON alerts(source, first_ts);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS devices(
  source TEXT PRIMARY KEY, device_id TEXT, last_seen TEXT, last_status TEXT, last_rssi INTEGER);
`);

export const DEFAULTS = {
  deviceName: 'Water line A',
  deviceId: 'aquasense-01',
  mode: 'physical',            // 'physical' | 'simulation'
  pulsesPerLitre: 450,         // initial estimate for ZJ-S201 (flow Hz / 7.5 = L/min). Calibrate it.
  maxFlowLpm: 15,
  continuousFlowLpm: 0.3,
  continuousFlowMinutes: 5,
  baselineDeviationPct: 75,    // lower = more sensitive
  persistenceReadings: 3,      // consecutive readings required before an alert
  offlineSeconds: 20,
  refreshSeconds: 2,
};
const LIMITS = {
  pulsesPerLitre: [10, 5000], maxFlowLpm: [0.1, 60], continuousFlowLpm: [0.01, 60],
  continuousFlowMinutes: [0.5, 1440], baselineDeviationPct: [10, 500], persistenceReadings: [1, 20],
  offlineSeconds: [5, 3600], refreshSeconds: [1, 60],
};

export function getSettings() {
  const out = { ...DEFAULTS };
  for (const r of db.prepare('SELECT key, value FROM settings').all()) {
    if (r.key in DEFAULTS) out[r.key] = typeof DEFAULTS[r.key] === 'number' ? Number(r.value) : r.value;
  }
  return out;
}

export function saveSettings(input) {
  const errors = [], clean = {};
  for (const [k, v] of Object.entries(input || {})) {
    if (!(k in DEFAULTS)) { errors.push(`Unknown setting "${k}"`); continue; }
    if (k in LIMITS) {
      const n = Number(v), [lo, hi] = LIMITS[k];
      if (v === '' || v === null || !Number.isFinite(n) || n < lo || n > hi) errors.push(`${k} must be a number between ${lo} and ${hi}`);
      else clean[k] = n;
    } else if (k === 'mode') {
      if (v === 'physical' || v === 'simulation') clean[k] = v; else errors.push('mode must be "physical" or "simulation"');
    } else if (typeof v !== 'string' || !v.trim() || v.length > 40) errors.push(`${k} must be 1-40 characters`);
    else if (k === 'deviceId' && !/^[\w.-]+$/.test(v)) errors.push('deviceId may only contain letters, digits, ".", "_" and "-"');
    else clean[k] = v.trim();
  }
  if (errors.length) return { errors };
  const up = db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  db.transaction(() => { for (const [k, v] of Object.entries(clean)) up.run(k, String(v)); })();
  return { settings: getSettings() };
}
