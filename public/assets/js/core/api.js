// Fetch wrapper for the HarborFinance API. Errors are thrown as ApiError with a
// user-safe message; field-level validation errors are exposed as `fields`.

export class ApiError extends Error {
  constructor(code, message, status, fields, details) {
    super(message);
    this.code = code;
    this.status = status;
    this.fields = fields;
    this.details = details;
  }
}

export async function api(path, opts = {}) {
  const headers = { Accept: "application/json" };
  let body;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }

  let res;
  try {
    res = await fetch(path, { method: opts.method ?? (body ? "POST" : "GET"), headers, body, signal: opts.signal, credentials: "same-origin" });
  } catch (err) {
    if (err.name === "AbortError") throw err;
    throw new ApiError("NETWORK_ERROR", "Network error. Check your connection and try again.", 0);
  }

  let json = {};
  try {
    json = await res.json();
  } catch {
    /* non-JSON response */
  }
  if (!res.ok || json.error) {
    const e = json.error ?? {};
    if (res.status === 401 && (e.code === "UNAUTHENTICATED" || e.code === "SESSION_EXPIRED") && !opts.allowAnonymous) {
      window.dispatchEvent(new CustomEvent("hf:session-expired"));
    }
    throw new ApiError(e.code ?? "INTERNAL_ERROR", e.message ?? "Something went wrong. Please try again.", res.status, e.fields, e.details);
  }
  return json.data;
}

export const newIdempotencyKey = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
