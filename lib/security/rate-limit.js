import "server-only";
import { AppError } from "@/lib/api/errors";

class MemoryStore {
  buckets = new Map();

  async hit(key, windowMs) {
    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      const fresh = { count: 1, resetAt: now + windowMs };
      this.buckets.set(key, fresh);
      if (this.buckets.size > 50_000) this.sweep(now);
      return fresh;
    }
    bucket.count++;
    return bucket;
  }

  sweep(now) {
    for (const [k, v] of this.buckets) if (v.resetAt <= now) this.buckets.delete(k);
  }
}

const g = globalThis;
const store = (g.__hfRateStore ??= new MemoryStore());

export const RATE_LIMITS = {
  auth: { name: "auth", limit: 10, windowMs: 60_000 },
  register: { name: "register", limit: 5, windowMs: 10 * 60_000 },
  emailSend: { name: "email", limit: 3, windowMs: 10 * 60_000 },
  orders: { name: "orders", limit: 60, windowMs: 60_000 },
  money: { name: "money", limit: 10, windowMs: 60_000 },
  support: { name: "support", limit: 20, windowMs: 60_000 },
  api: { name: "api", limit: 300, windowMs: 60_000 },
};

export async function enforceRateLimit(rule, identity) {
  const { count, resetAt } = await store.hit(`${rule.name}:${identity}`, rule.windowMs);
  if (count > rule.limit) {
    throw new AppError("RATE_LIMITED", undefined, { retryAfter: Math.ceil((resetAt - Date.now()) / 1000) });
  }
}
