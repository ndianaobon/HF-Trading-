// Small stale-while-revalidate cache shared by all components on a page.
// Keys are API paths. `invalidate(prefix)` refetches every watched key that
// starts with the prefix (used after mutations and by realtime events).

import { api, ApiError } from "./api.js";

const entries = new Map();
const watchers = new Map();

function notify(key) {
  const e = entries.get(key);
  watchers.get(key)?.forEach((cb) => cb(e));
}

async function load(key) {
  const current = entries.get(key) ?? { data: undefined, error: null, at: 0 };
  if (current.inflight) return current.inflight;
  const inflight = (async () => {
    try {
      const data = await api(key);
      entries.set(key, { data, error: null, at: Date.now() });
    } catch (err) {
      entries.set(key, { data: current.data, error: err instanceof ApiError ? err : new ApiError("NETWORK_ERROR", "Network error.", 0), at: current.at });
    }
    notify(key);
  })();
  entries.set(key, { ...current, inflight });
  return inflight;
}

/**
 * Watches an API path. `cb({ data, error })` is called with cached data
 * immediately (if any) and after every (re)load. Returns an unsubscribe fn.
 */
export function watch(key, cb, { refresh, maxAge = 2000 } = {}) {
  if (!watchers.has(key)) watchers.set(key, new Set());
  watchers.get(key).add(cb);
  const e = entries.get(key);
  if (e && (e.data !== undefined || e.error)) cb(e);
  if (!e || Date.now() - e.at > maxAge) void load(key);
  const timer = refresh ? setInterval(() => document.visibilityState === "visible" && load(key), refresh) : null;
  return () => {
    watchers.get(key)?.delete(cb);
    if (timer) clearInterval(timer);
  };
}

/** One-off fetch through the cache. */
export async function get(key, { maxAge = 2000 } = {}) {
  const e = entries.get(key);
  if (!e || Date.now() - e.at > maxAge || e.error) await load(key);
  const r = entries.get(key);
  if (r.error && r.data === undefined) throw r.error;
  return r.data;
}

export function invalidate(match) {
  const test = typeof match === "function" ? match : (k) => k.startsWith(match);
  for (const key of [...entries.keys()]) {
    if (!test(key)) continue;
    if (watchers.get(key)?.size) void load(key);
    else entries.delete(key);
  }
}

window.addEventListener("focus", () => {
  for (const [key, set] of watchers) {
    const e = entries.get(key);
    if (set.size && (!e || Date.now() - e.at > 15000)) void load(key);
  }
});
