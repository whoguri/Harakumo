import { getConfig } from "@/lib/config";
import { ok } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Liveness + configuration summary. Never returns secrets. */
export function GET() {
  const cfg = getConfig();
  return ok({ ok: true, mode: cfg.mode, projectId: cfg.projectId, sdk: "@harakumo/sdk@0.4.0", time: new Date().toISOString() });
}
