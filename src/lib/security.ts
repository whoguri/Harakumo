import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { getConfig } from "./config";
import { AppError } from "./harakumo";

/* ---------------- Rate limiting (fixed window, per instance) ---------------- */

const buckets = new Map<string, { count: number; resetAt: number }>();

export function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

export function rateLimit(req: NextRequest, scope: string, limit: number, windowMs: number) {
  const key = `${scope}:${clientIp(req)}`;
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 5000) for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
    return;
  }
  if (++b.count > limit) {
    const retry = Math.ceil((b.resetAt - now) / 1000);
    throw new AppError("rate_limited", 429, `Too many requests. Try again in ${retry}s.`, true);
  }
}

/* ---------------- Same-origin check for state-changing requests ---------------- */

export function assertSameOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (!origin) return; // non-browser clients (curl) carry no ambient cookies worth protecting
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    if (new URL(origin).host === host) return;
  } catch {}
  throw new AppError("forbidden_origin", 403, "Cross-origin request refused.");
}

/* ---------------- Operator session ---------------- */

export const OPERATOR_COOKIE = "lp_operator";

function sessionValue(token: string) {
  return createHmac("sha256", token).update("launchpad-operator-session-v1").digest("hex");
}

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function checkOperatorToken(candidate: string): string | null {
  const { operatorToken } = getConfig();
  if (!operatorToken || !safeEqual(candidate, operatorToken)) return null;
  return sessionValue(operatorToken);
}

/** Operator = valid session cookie, or `Authorization: Bearer <LAUNCHPAD_OPERATOR_TOKEN>` for scripts. */
export function isOperator(req: NextRequest): boolean {
  const { operatorToken } = getConfig();
  if (!operatorToken) return false;
  const bearer = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (bearer && safeEqual(bearer, operatorToken)) return true;
  const cookie = req.cookies.get(OPERATOR_COOKIE)?.value;
  return !!cookie && safeEqual(cookie, sessionValue(operatorToken));
}

/** Real provisioning needs live credentials AND an operator. Everyone else gets clearly-labelled simulations. */
export function canExecuteReal(req: NextRequest): boolean {
  return getConfig().mode === "live" && isOperator(req);
}
