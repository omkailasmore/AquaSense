export const cx = (...a) => a.filter(Boolean).join(' ');
export const fmt = (v, d = 2) => (v == null || Number.isNaN(v) ? '—' : Number(v).toFixed(d));
export const time = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour12: false }) : '—');
export const dt = (iso) => (iso ? new Date(iso).toLocaleString([], { hour12: false }) : '—');
export function ago(iso) {
  if (!iso) return 'never';
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 60 ? `${s} s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
}
export const C = { blue: '#4C8DFF', violet: '#8B6CFF', grid: '#1F2B42', axis: '#64748b' };

const TONES = {
  ok: 'text-sky-300 bg-blue/10 border-blue/30', warn: 'text-violet-300 bg-violet/10 border-violet/30',
  crit: 'text-red-300 bg-alert/10 border-alert/40', mute: 'text-slate-400 bg-slate-500/10 border-slate-500/30',
};
export const Pill = ({ tone = 'mute', children }) => (
  <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium', TONES[tone])}>{children}</span>
);
export const SourceBadge = ({ src }) => (src === 'simulator' ? <Pill tone="warn">Simulated data</Pill> : <Pill tone="ok">Physical device</Pill>);

export const Card = ({ title, right, children, className }) => (
  <section className={cx('rounded-xl border border-line bg-panel p-4', className)}>
    {(title || right) && <div className="mb-3 flex items-center justify-between gap-2"><h2 className="text-sm font-semibold text-slate-300">{title}</h2>{right}</div>}
    {children}
  </section>
);
export const Stat = ({ label, value, unit, hint, tone }) => (
  <Card>
    <div className="text-xs text-slate-400">{label}</div>
    <div className={cx('mt-1 text-2xl font-semibold', tone === 'crit' && 'text-red-300', tone === 'warn' && 'text-violet-300')}>
      {value}{unit && <span className="ml-1 text-sm font-normal text-slate-400">{unit}</span>}
    </div>
    {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
  </Card>
);
export const Empty = ({ children }) => <div className="grid h-40 place-items-center px-4 text-center text-sm text-slate-500">{children}</div>;
export const Btn = ({ tone = 'default', className, ...p }) => (
  <button {...p} className={cx('rounded-lg border px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40',
    tone === 'primary' ? 'border-blue bg-blue text-ink hover:brightness-110' : 'border-line bg-ink text-slate-200 hover:border-blue/60', className)} />
);
export const StatusPill = ({ system }) => system && <Pill tone={system.level}><span className="h-1.5 w-1.5 rounded-full bg-current" />{system.label}</Pill>;
export const ErrorNote = ({ error }) => error && <div className="rounded-lg border border-alert/40 bg-alert/10 px-3 py-2 text-sm text-red-200">{error}</div>;
