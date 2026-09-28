import "server-only";
import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  APP_MODE: z.enum(["demo", "live"]).default("demo"),
  DATABASE_URL: z.string().min(1),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
  ENCRYPTION_KEY: z.string().min(32, "ENCRYPTION_KEY must be a base64-encoded 32-byte key"),
  MARKET_DATA_PROVIDER: z.enum(["binance", "disabled"]).default("binance"),
  MARKET_DATA_BASE_URL: z.string().url().default("https://data-api.binance.vision"),
  EMAIL_PROVIDER: z.enum(["console", "smtp"]).default("console"),
  EMAIL_FROM: z.string().default("HarborFinance <no-reply@harborfinance.test>"),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  STORAGE_PROVIDER: z.enum(["local", "supabase"]).default("local"),
  SUPABASE_URL: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_STORAGE_BUCKET: z.string().default("harborfinance-private"),
  PAYMENT_PROVIDER: z.string().default("manual"),
  // Reverse proxies in front of the app that append to X-Forwarded-For. The client IP is
  // taken this many entries from the right; entries further left are client-supplied.
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
});

let cached = null;

export function env() {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration — ${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Demo mode: balances, deposits, withdrawals and fills are simulated and labelled as such. */
export const isDemoMode = () => env().APP_MODE === "demo";
export const isProduction = () => env().NODE_ENV === "production";
export const appUrl = () => env().NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
