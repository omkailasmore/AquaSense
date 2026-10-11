import { useCallback, useEffect, useRef, useState } from 'react';

export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch('/api' + path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error('Backend unreachable. Start it with "npm start" in the backend folder.');
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (HTTP ${res.status})`);
  return json;
}

/** Poll an async function. Keeps the last good data and exposes the error, never invents values. */
export function usePoll(fn, ms, deps = []) {
  const [state, set] = useState({ data: null, error: null, loading: true });
  const ref = useRef(fn);
  ref.current = fn;
  const run = useCallback(async () => {
    try { set({ data: await ref.current(), error: null, loading: false }); }
    catch (e) { set((p) => ({ data: p.data, error: e.message, loading: false })); }
  }, []);
  useEffect(() => { run(); const id = setInterval(run, ms); return () => clearInterval(id); }, [ms, run, ...deps]); // eslint-disable-line
  return { ...state, reload: run };
}
