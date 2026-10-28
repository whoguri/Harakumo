import type { ApiErrorBody } from "@/lib/schemas";

export class ApiError extends Error {
  constructor(public code: string, public status: number, message: string, public retryable = false) {
    super(message);
  }
}

/** fetch wrapper for the app's own route handlers. Throws ApiError with the server's code/message. */
export async function api<T>(path: string, init?: { method?: string; body?: unknown; signal?: AbortSignal }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init?.method ?? "GET",
      headers: init?.body !== undefined ? { "content-type": "application/json" } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: init?.signal,
      cache: "no-store",
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ApiError("network_error", 0, "Could not reach the Launchpad server. Check your connection.", true);
  }
  const data = (await res.json().catch(() => null)) as (T & Partial<ApiErrorBody>) | null;
  if (!res.ok && data && "error" in data && data.error && !("operation" in data)) {
    throw new ApiError(data.error.code, res.status, data.error.message, data.error.retryable);
  }
  if (!data) throw new ApiError("bad_response", res.status, `Unexpected response (${res.status}).`);
  return data as T;
}

export function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const t = new Date(iso.includes("T") || iso.endsWith("Z") ? iso : iso.replace(" ", "T") + "Z").getTime();
  if (Number.isNaN(t)) return iso;
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export function fullTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso.includes("T") || iso.endsWith("Z") ? iso : iso.replace(" ", "T") + "Z");
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}
