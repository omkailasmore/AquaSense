// Run with the backend already started: npm run smoke
const B = process.env.API || 'http://localhost:3001/api';
let fails = 0;
const j = async (p, o = {}) => { const r = await fetch(B + p, { headers: { 'Content-Type': 'application/json' }, ...o, body: o.body && JSON.stringify(o.body) }); return [r.status, await r.json().catch(() => ({}))]; };
const ok = (name, cond) => { console.log(cond ? 'PASS' : 'FAIL', name); if (!cond) fails++; };

ok('health', (await j('/health'))[1].ok === true);
ok('rejects bad payload', (await j('/readings', { method: 'POST', body: { deviceId: 'x', pulseCount: -4, intervalMs: 2000 } }))[0] === 400);
ok('rejects impossible flow', (await j('/readings', { method: 'POST', body: { deviceId: 'smoke', pulseCount: 90000, intervalMs: 1000 } }))[0] === 422);
const [c, r] = await j('/readings', { method: 'POST', body: { deviceId: 'smoke', pulseCount: 30, intervalMs: 2000, sensorStatus: 'online' } });
ok('accepts valid reading', c === 201 && Math.abs(r.flowRateLpm - 2.0) < 0.01); // 30 pulses / 450 per L = 0.0667 L in 2 s = 2 L/min
const [, s] = await j('/settings'); await j('/settings', { method: 'PUT', body: { mode: 'physical' } });
ok('physical latest', (await j('/readings/latest?source=physical'))[1].reading?.deviceId === 'smoke');
ok('analytics', (await j('/analytics/summary?source=physical'))[1].totals.readings >= 1);
ok('simulator blocked in physical mode', (await j('/simulator/control', { method: 'POST', body: { action: 'start' } }))[0] === 409);
ok('settings validation', (await j('/settings', { method: 'PUT', body: { pulsesPerLitre: -1 } }))[0] === 400);
console.log(fails ? `${fails} FAILED` : 'All smoke tests passed'); process.exit(fails ? 1 : 0);
