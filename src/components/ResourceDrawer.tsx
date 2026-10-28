"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError, fullTime } from "./api";
import { Badge, Button, ErrorNote, Spinner, StatusPill, TypeIcon } from "./ui";
import { RefreshIcon } from "./Dashboard";
import { RESOURCE_META, type Resource } from "@/lib/schemas";

type Detail = Resource & { extra: Record<string, unknown> };

export function ResourceDrawer({ resource, onClose, live }: { resource: Resource; onClose: () => void; live: boolean }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { resource: r } = await api<{ resource: Detail }>(`/api/resources/${resource.type}/${resource.id}`);
      setDetail(r);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setLoading(false);
    }
  }, [resource.type, resource.id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const r = detail ?? resource;
  const meta = RESOURCE_META[r.type];
  const source = typeof detail?.extra?.source === "string" ? (detail.extra.source as string) : null;
  const extra = detail ? Object.fromEntries(Object.entries(detail.extra).filter(([k]) => k !== "source")) : {};

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal aria-label={`${r.name} details`}>
      <button className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={onClose} aria-label="Close details" />
      <aside className="relative flex h-full w-full max-w-lg flex-col border-l border-line bg-panel shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-line-soft px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="rounded-lg border border-line bg-panel-2 p-2 text-accent"><TypeIcon type={r.type} /></span>
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold">{r.name}</h2>
              <p className="text-xs text-ink-3">{meta.label} · <span className="font-mono">#{r.id}</span></p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" onClick={() => void load()} disabled={loading} title="Refresh status">{loading ? <Spinner /> : <RefreshIcon />}</Button>
            <Button variant="ghost" onClick={onClose} title="Close">✕</Button>
          </div>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4 text-sm">
          {error && <ErrorNote code={error.code} message={error.message} onRetry={() => void load()} />}
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={r.status} tone={r.tone} />
            {r.provider && <Badge>{r.provider}</Badge>}
            {r.sample ? <Badge tone="warn">sample data</Badge> : live && <Badge tone="ok">from Harakumo</Badge>}
          </div>

          <dl className="grid grid-cols-[120px_minmax(0,1fr)] gap-x-3 gap-y-2">
            <Row k="Created" v={fullTime(r.createdAt)} />
            <Row k="Resource ID" v={<span className="font-mono">{r.id}</span>} />
            {Object.entries(r.details).map(([k, v]) => (
              <Row key={k} k={k} v={v === null ? <span className="text-ink-3">—</span> : k === "url" && typeof v === "string" ? <a href={v} target="_blank" rel="noreferrer" className="break-all text-accent hover:underline">{v}</a> : <span className={k === "lastError" ? "text-err" : ""}>{String(v)}</span>} />
            ))}
            {Object.entries(extra).map(([k, v]) => (
              <Row key={k} k={k} v={<span className="break-all font-mono text-xs">{typeof v === "object" ? JSON.stringify(v) : String(v)}</span>} />
            ))}
          </dl>

          {source && (
            <div>
              <div className="mb-1.5 text-xs font-medium text-ink-2">Deployed source</div>
              <pre className="max-h-64 overflow-auto rounded-lg border border-line bg-bg p-3 font-mono text-[11.5px] leading-relaxed text-ink-2">{source}</pre>
            </div>
          )}

          <div className="rounded-lg border border-line-soft bg-bg/60 p-3">
            <div className="text-xs font-medium text-ink-2">Read with the SDK</div>
            <pre className="mt-1.5 overflow-x-auto font-mono text-[11.5px] text-ink-3">{sdkSnippet(r)}</pre>
          </div>
          <p className="text-xs text-ink-3">Connection strings, keys and environment-variable values are never sent to the browser. Launchpad has no delete action by design — remove resources in the Harakumo dashboard.</p>
        </div>
      </aside>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <>
      <dt className="text-ink-3">{k}</dt>
      <dd className="min-w-0 text-ink">{v}</dd>
    </>
  );
}

function sdkSnippet(r: Resource) {
  switch (r.type) {
    case "database": return `await hk.databases.get(${r.id});\nawait hk.databases.query(${r.id}, 'select 1');`;
    case "bucket": return `await hk.storage.list(projectId); // bucket ${r.id}\nawait hk.storage.presign(${r.id}, { key, method: 'put', contentType, size });`;
    case "vectors": return `await hk.vectors.get(${r.id});\nawait hk.vectors.query(${r.id}, { text: '…', topK: 3 });`;
    case "memory": return `await hk.memory.search(${r.id}, { userId, query: '…' });`;
    case "function": return `await hk.functions.get(${r.id});\nawait hk.functions.invoke(${r.id}, { path: '/' });`;
  }
}
