import "server-only";
import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { AppError, ERROR_CATALOG } from "@/lib/api/errors";
import { getRawSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rate-limit";
import { requestMeta } from "@/lib/security/request";
import { authenticateApiKey } from "@/lib/auth/api-keys";
import { randomToken } from "@/lib/security/crypto";

export function route(opts, handler) {
  return async (req, context) => {
    const requestId = randomToken(6);
    try {
      const { ip, userAgent } = await requestMeta();
      const authMode = opts.auth ?? "user";

      let session = null;
      if (authMode !== "none" || opts.admin) {
        const raw = await getRawSession();
        if (raw) {
          if (raw.user.twoFactor?.enabled && !raw.mfaVerified) {
            if (authMode !== "optional") throw new AppError("MFA_REQUIRED");
          } else {
            session = raw;
          }
        } else {
          const header = req.headers.get("authorization");
          if (header?.startsWith("Bearer ")) {
            const scope = opts.apiKeyScope ?? (req.method === "GET" ? "read" : null);
            if (!scope) throw new AppError("FORBIDDEN", "API keys cannot be used for this endpoint.");
            session = await authenticateApiKey(header.slice(7).trim(), scope);
          }
        }
      }

      if ((authMode === "user" || authMode === "verified" || opts.admin) && !session) {
        throw new AppError("UNAUTHENTICATED");
      }
      if (authMode === "verified" && session && !session.user.emailVerifiedAt) {
        throw new AppError("EMAIL_NOT_VERIFIED");
      }
      if (opts.admin) {
        const admin = session?.user.adminUser;
        if (!admin || !admin.isActive || !can(admin.role, opts.admin)) throw new AppError("FORBIDDEN");
      }

      const identity = session?.user.id ?? ip;
      await enforceRateLimit(opts.rateLimit ?? RATE_LIMITS.api, identity);

      let body = undefined;
      if (opts.body) {
        let json;
        try {
          json = await req.json();
        } catch {
          throw new AppError("VALIDATION_ERROR", "Request body must be valid JSON.");
        }
        body = opts.body.parse(json);
      }

      let query = undefined;
      if (opts.query) {
        query = opts.query.parse(Object.fromEntries(req.nextUrl.searchParams.entries()));
      }

      const params = (await context.params) ?? {};
      const result = await handler({
        req,
        params,
        body: body,
        query: query,
        session: session,
        ip,
        userAgent,
      });
      if (result instanceof Response) return result;
      return NextResponse.json({ data: result ?? null });
    } catch (err) {
      return errorResponse(err, requestId);
    }
  };
}

export function errorResponse(err, requestId = randomToken(6)) {
  if (err instanceof ZodError) {
    const fields = {};
    for (const issue of err.issues) {
      const key = issue.path.join(".") || "_";
      if (!fields[key]) fields[key] = issue.message;
    }
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: ERROR_CATALOG.VALIDATION_ERROR.message, fields } }, { status: 400 });
  }
  if (err instanceof AppError) {
    const headers = {};
    if (err.code === "RATE_LIMITED" && err.details?.retryAfter) headers["Retry-After"] = String(err.details.retryAfter);
    return NextResponse.json({ error: { code: err.code, message: err.message, details: err.details } }, { status: err.status, headers });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      return NextResponse.json({ error: { code: "DUPLICATE_REQUEST", message: ERROR_CATALOG.DUPLICATE_REQUEST.message } }, { status: 409 });
    }
    if (err.code === "P2025") {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: ERROR_CATALOG.NOT_FOUND.message } }, { status: 404 });
    }
  }
  // Check-constraint violations (e.g. a balance would go negative) surface as a safe balance error.
  const message = err instanceof Error ? err.message : String(err);
  if (/wallet_available_non_negative|wallet_locked_non_negative/.test(message)) {
    return NextResponse.json({ error: { code: "INSUFFICIENT_BALANCE", message: ERROR_CATALOG.INSUFFICIENT_BALANCE.message } }, { status: 422 });
  }
  console.error(`[api] request ${requestId} failed:`, err);
  return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: ERROR_CATALOG.INTERNAL_ERROR.message, requestId } }, { status: 500 });
}

/** Standard pagination query fields. */
export const paginationSchema = {
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
};

export function paginate(page, pageSize) {
  return { skip: (page - 1) * pageSize, take: pageSize };
}

export function pageResult(items, total, page, pageSize) {
  return { items, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}
