import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodTypeAny, type z } from "zod";
import { AppError, toAppError } from "./harakumo";
import { log } from "./log";
import type { ApiErrorBody } from "./schemas";

const MAX_BODY_BYTES = 8 * 1024;

export async function readJson<S extends ZodTypeAny>(req: NextRequest, schema: S): Promise<z.output<S>> {
  const type = req.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) throw new AppError("unsupported_media_type", 415, "Send a JSON body (Content-Type: application/json).");
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) throw new AppError("payload_too_large", 413, "Request body is too large.");
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new AppError("invalid_json", 400, "Request body is not valid JSON.");
  }
  return schema.parse(data);
}

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, { ...init, headers: { "cache-control": "no-store", ...(init?.headers ?? {}) } });
}

export function fail(err: unknown, route: string) {
  if (err instanceof ZodError) {
    const body: ApiErrorBody = {
      error: {
        code: "validation_failed",
        message: err.issues[0]?.message ?? "Invalid request.",
        retryable: false,
        issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
    };
    return NextResponse.json(body, { status: 400 });
  }
  const e = toAppError(err);
  if (e.status >= 500) log.error("request_failed", { route, err: e });
  const body: ApiErrorBody = { error: { code: e.code, message: e.message, retryable: e.retryable } };
  return NextResponse.json(body, { status: e.status, headers: { "cache-control": "no-store" } });
}
