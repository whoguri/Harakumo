import "server-only";
import Harakumo, { HarakumoError } from "@harakumo/sdk";
import { getConfig } from "./config";

/**
 * The only place the Harakumo SDK is constructed. `server-only` makes the
 * build fail if a client component ever imports this module, so the API key
 * can never be bundled into browser code.
 */
let cached: { key: string; client: Harakumo } | null = null;

export function getHarakumo(): Harakumo {
  const cfg = getConfig();
  if (cfg.mode !== "live" || !cfg.apiKey) {
    throw new AppError("not_configured", 503, cfg.demoReason ?? "Harakumo is not configured.");
  }
  if (!cached || cached.key !== cfg.apiKey) {
    cached = {
      key: cfg.apiKey,
      client: new Harakumo({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, maxRetries: 1 }),
    };
  }
  return cached.client;
}

/** An error that is safe to show to the browser. */
export class AppError extends Error {
  constructor(
    public code: string,
    public status: number,
    message: string,
    public retryable = false,
    public upstreamStatus: number | null = null,
  ) {
    super(message);
  }
}

const FRIENDLY: Record<string, string> = {
  plan_limit: "Your Harakumo plan's limit for this resource type is reached. Upgrade the plan or reuse an existing resource.",
  rate_limited: "Harakumo is rate limiting requests. Wait a few seconds and try again.",
  insufficient_balance: "The workspace balance is empty, so Harakumo refused this paid request.",
  spend_limit_reached: "The workspace spend limit is reached.",
  ai_credits_exhausted: "The workspace has no AI credit left.",
  email_unverified: "Verify the workspace owner's email address in the Harakumo dashboard first.",
  invalid_request: "Harakumo rejected the configuration.",
  not_found: "That resource was not found in this project.",
};

/**
 * Turn anything thrown by the SDK (or fetch) into an AppError with a stable
 * code. Upstream messages are kept: Harakumo's messages are written for
 * people and never contain secrets.
 */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof HarakumoError) {
    const code = err.code ?? `http_${err.status}`;
    const retryable = err.status === 408 || err.status === 429 || err.status >= 500;
    const generic = !err.message || /^Request failed/.test(err.message);
    const msg = generic ? FRIENDLY[code] ?? `Harakumo refused the request (${err.status}).` : err.message;
    const status = err.status >= 500 ? 502 : err.status;
    return new AppError(code, status, msg, retryable, err.status);
  }
  if (err instanceof TypeError) {
    return new AppError("network_error", 503, "Could not reach Harakumo. Check the network and try again.", true);
  }
  return new AppError("internal_error", 500, "Unexpected server error.");
}
