/**
 * Structured JSON logs (one line per event) so failures are greppable in
 * `harakumo logs <deploymentId>`. Error objects are reduced to code/status/
 * message: request bodies and keys are never logged.
 */
type Fields = Record<string, unknown>;

function serialize(fields: Fields) {
  const out: Fields = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v instanceof Error) {
      const e = v as Error & { code?: unknown; status?: unknown; upstreamStatus?: unknown };
      out[k] = { name: e.name, message: e.message, code: e.code ?? null, status: e.status ?? null, upstreamStatus: e.upstreamStatus ?? null };
    } else out[k] = v;
  }
  return out;
}

function emit(level: "info" | "warn" | "error", event: string, fields: Fields = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, app: "launchpad", event, ...serialize(fields) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  info: (event: string, fields?: Fields) => emit("info", event, fields),
  warn: (event: string, fields?: Fields) => emit("warn", event, fields),
  error: (event: string, fields?: Fields) => emit("error", event, fields),
};
