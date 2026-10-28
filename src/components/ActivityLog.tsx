"use client";

import type { ApiError } from "./api";
import { timeAgo, fullTime } from "./api";
import { Badge, Button, ErrorNote, Panel, TypeIcon } from "./ui";
import { RefreshIcon } from "./Dashboard";
import { RESOURCE_META, type Operation } from "@/lib/schemas";

type Load = { state: "loading" } | { state: "ready"; data: Operation[] } | { state: "error"; error: ApiError };

const tone = { succeeded: "ok", failed: "err", simulated: "warn", pending: "neutral" } as const;

export function ActivityLog({ load, onRefresh, storeDetail, storeKind }: { load: Load; onRefresh: () => void; storeDetail?: string; storeKind?: string }) {
  return (
    <Panel
      title={<span className="flex items-center gap-2">Provisioning log {storeKind && <Badge tone={storeKind === "harakumo-sqlite" ? "ok" : "neutral"}>{storeKind === "harakumo-sqlite" ? "edge sqlite" : "memory"}</Badge>}</span>}
      subtitle={storeDetail ?? "Every provisioning attempt, real or simulated."}
      actions={<Button variant="ghost" onClick={onRefresh} title="Refresh log"><RefreshIcon /></Button>}
    >
      {load.state === "loading" && <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-9" />)}</div>}
      {load.state === "error" && <div className="p-4"><ErrorNote code={load.error.code} message={load.error.message} onRetry={onRefresh} /></div>}
      {load.state === "ready" && load.data.length === 0 && (
        <p className="px-4 py-8 text-center text-xs text-ink-3">No provisioning activity yet. Attempts — including failures and simulations — are recorded here.</p>
      )}
      {load.state === "ready" && load.data.length > 0 && (
        <ul className="divide-y divide-line-soft">
          {load.data.map((op) => (
            <li key={op.id} className="flex items-start gap-3 px-4 py-2.5 text-sm">
              <TypeIcon type={op.resourceType} className="mt-0.5 shrink-0 text-ink-3" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium">{RESOURCE_META[op.resourceType].short}</span>
                  <span className="font-mono text-ink-2">{op.resourceName}</span>
                  <Badge tone={tone[op.status]}>{op.status}</Badge>
                  {op.execution === "real" && op.harakumoId && <span className="font-mono text-[11px] text-ink-3">#{op.harakumoId}</span>}
                </div>
                {op.errorMessage && <p className="mt-0.5 text-xs text-err"><span className="font-mono">{op.errorCode}</span> — {op.errorMessage}</p>}
                <p className="mt-0.5 truncate font-mono text-[10.5px] text-ink-3" title={op.sdkCall}>{op.sdkCall}</p>
              </div>
              <div className="shrink-0 text-right text-[11px] text-ink-3" title={fullTime(op.createdAt)}>
                {timeAgo(op.createdAt)}
                {op.durationMs != null && <div className="font-mono">{op.durationMs}ms</div>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
