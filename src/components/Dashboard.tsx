"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, timeAgo } from "./api";
import { Badge, Button, cx, ErrorNote, Panel, Spinner, StatusPill, TypeIcon } from "./ui";
import { ResourceDrawer } from "./ResourceDrawer";
import { ProvisionForm } from "./ProvisionForm";
import { AssistantPanel } from "./AssistantPanel";
import { ActivityLog } from "./ActivityLog";
import { OperatorDialog } from "./OperatorDialog";
import { RESOURCE_META, RESOURCE_TYPES, type Operation, type Resource, type ResourceType, type ResourcesResponse, type SessionInfo } from "@/lib/schemas";

type Load<T> = { state: "loading" } | { state: "ready"; data: T; refreshing?: boolean } | { state: "error"; error: ApiError };

export function Dashboard() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [resources, setResources] = useState<Load<ResourcesResponse>>({ state: "loading" });
  const [ops, setOps] = useState<Load<Operation[]>>({ state: "loading" });
  const [filter, setFilter] = useState<ResourceType | "all">("all");
  const [selected, setSelected] = useState<Resource | null>(null);
  const [operatorOpen, setOperatorOpen] = useState(false);

  const loadSession = useCallback(async () => {
    try {
      setSession(await api<SessionInfo>("/api/session"));
    } catch {
      /* the resources call surfaces connectivity errors */
    }
  }, []);

  const loadResources = useCallback(async () => {
    setResources((r) => (r.state === "ready" ? { ...r, refreshing: true } : { state: "loading" }));
    try {
      const data = await api<ResourcesResponse>("/api/resources");
      setResources({ state: "ready", data });
    } catch (e) {
      setResources({ state: "error", error: e as ApiError });
    }
  }, []);

  const loadOps = useCallback(async () => {
    try {
      const { operations } = await api<{ operations: Operation[] }>("/api/operations?limit=30");
      setOps({ state: "ready", data: operations });
    } catch (e) {
      setOps({ state: "error", error: e as ApiError });
    }
  }, []);

  const refreshAll = useCallback(() => {
    void loadSession();
    void loadResources();
    void loadOps();
  }, [loadSession, loadResources, loadOps]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  // Poll while anything is still provisioning.
  const hasPending = resources.state === "ready" && resources.data.resources.some((r) => r.tone === "pending");
  useEffect(() => {
    if (!hasPending) return;
    const t = setInterval(() => void loadResources(), 5000);
    return () => clearInterval(t);
  }, [hasPending, loadResources]);

  const onProvisioned = useCallback(() => {
    void loadResources();
    void loadOps();
    void loadSession();
  }, [loadResources, loadOps, loadSession]);

  const counts = useMemo(() => {
    const c = Object.fromEntries(RESOURCE_TYPES.map((t) => [t, 0])) as Record<ResourceType, number>;
    if (resources.state === "ready") for (const r of resources.data.resources) c[r.type]++;
    return c;
  }, [resources]);

  const visible = resources.state === "ready" ? resources.data.resources.filter((r) => filter === "all" || r.type === filter) : [];
  const live = session?.mode === "live";

  return (
    <div className="relative min-h-dvh">
      <div className="grid-bg pointer-events-none absolute inset-x-0 top-0 h-80" aria-hidden />
      <TopBar session={session} onOperator={() => setOperatorOpen(true)} onSignedOut={refreshAll} />

      <main className="relative mx-auto max-w-7xl px-4 pb-16 sm:px-6">
        <ModeBanner session={session} onOperator={() => setOperatorOpen(true)} />

        <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
          {RESOURCE_TYPES.map((t) => (
            <button key={t} onClick={() => setFilter(filter === t ? "all" : t)}
              className={cx("group rounded-xl border bg-panel px-3.5 py-3 text-left transition hover:border-ink-3",
                filter === t ? "border-accent/60" : "border-line")}>
              <div className="flex items-center justify-between text-ink-3">
                <TypeIcon type={t} className={filter === t ? "text-accent" : ""} />
                <span className="font-mono text-[10px] uppercase tracking-wider">{RESOURCE_META[t].sdkList.replace("hk.", "")}</span>
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-semibold tabular-nums">{resources.state === "ready" ? counts[t] : "–"}</span>
                <span className="text-xs text-ink-2">{counts[t] === 1 ? RESOURCE_META[t].short : RESOURCE_META[t].plural}</span>
              </div>
            </button>
          ))}
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_400px]">
          <div className="flex min-w-0 flex-col gap-5">
            <Panel
              title={<span className="flex items-center gap-2">Resources {filter !== "all" && <Badge tone="accent">{RESOURCE_META[filter].short}</Badge>}</span>}
              subtitle={
                resources.state === "ready"
                  ? live
                    ? `Harakumo project #${resources.data.projectId} · fetched ${timeAgo(resources.data.fetchedAt)} via the SDK`
                    : "Sample inventory — demo mode, not fetched from Harakumo"
                  : "Loading inventory…"
              }
              actions={
                <>
                  {filter !== "all" && <Button variant="ghost" onClick={() => setFilter("all")}>Clear filter</Button>}
                  <Button onClick={() => void loadResources()} disabled={resources.state === "loading" || (resources.state === "ready" && !!resources.refreshing)}>
                    {resources.state === "ready" && resources.refreshing ? <Spinner /> : <RefreshIcon />} Refresh
                  </Button>
                </>
              }
            >
              <ResourceList load={resources} visible={visible} onSelect={setSelected} onRetry={() => void loadResources()} filtered={filter !== "all"} />
            </Panel>

            <ActivityLog load={ops} onRefresh={() => void loadOps()} storeDetail={session?.storeDetail} storeKind={session?.store} />
          </div>

          <div className="order-first flex min-w-0 flex-col gap-5 lg:order-none">
            <AssistantPanel session={session} onExecuted={onProvisioned} onOperator={() => setOperatorOpen(true)} />
            <ProvisionForm session={session} onProvisioned={onProvisioned} />
          </div>
        </div>

        <Footer />
      </main>

      {selected && <ResourceDrawer resource={selected} onClose={() => setSelected(null)} live={live} />}
      {operatorOpen && <OperatorDialog onClose={() => setOperatorOpen(false)} onUnlocked={() => { setOperatorOpen(false); refreshAll(); }} configured={!!session?.operatorConfigured} />}
    </div>
  );
}

function ResourceList({ load, visible, onSelect, onRetry, filtered }: { load: Load<ResourcesResponse>; visible: Resource[]; onSelect: (r: Resource) => void; onRetry: () => void; filtered: boolean }) {
  if (load.state === "loading") {
    return (
      <div className="space-y-2 p-4" aria-busy>
        {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-11" />)}
      </div>
    );
  }
  if (load.state === "error") {
    return <div className="p-4"><ErrorNote code={load.error.code} message={load.error.message} onRetry={onRetry} /></div>;
  }
  const { errors } = load.data;
  return (
    <div>
      {errors.length > 0 && (
        <div className="border-b border-line-soft px-4 py-2.5 text-xs text-warn">
          Partial result — could not list {errors.map((e) => `${RESOURCE_META[e.type].plural.toLowerCase()} (${e.code})`).join(", ")}.
        </div>
      )}
      {visible.length === 0 ? (
        <div className="flex flex-col items-center px-6 py-12 text-center">
          <div className="rounded-full border border-line bg-panel-2 p-3 text-ink-3"><TypeIcon type="database" className="h-5 w-5" /></div>
          <p className="mt-3 text-sm font-medium">{filtered ? "No resources of this type yet" : "No resources in this project yet"}</p>
          <p className="mt-1 max-w-sm text-xs text-ink-3">Describe what your app needs to the assistant, or provision a resource directly with the form. Everything you create shows up here with its live status.</p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <table className="hidden w-full text-sm md:table">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-ink-3">
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-2 py-2 font-medium">Type</th>
                <th className="px-2 py-2 font-medium">Status</th>
                <th className="px-2 py-2 font-medium">Config</th>
                <th className="px-2 py-2 font-medium">Created</th>
                <th className="px-4 py-2 text-right font-medium">ID</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={`${r.type}-${r.id}`} onClick={() => onSelect(r)} tabIndex={0}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelect(r)}
                  className="cursor-pointer border-t border-line-soft transition hover:bg-panel-2 focus:bg-panel-2 focus:outline-none">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2 font-medium">
                      {r.name}
                      {r.sample && <Badge tone="warn" title="Demo-mode sample data">sample</Badge>}
                    </div>
                  </td>
                  <td className="px-2 py-2.5 text-ink-2"><span className="inline-flex items-center gap-1.5"><TypeIcon type={r.type} className="text-ink-3" />{RESOURCE_META[r.type].short}</span></td>
                  <td className="px-2 py-2.5"><StatusPill status={r.status} tone={r.tone} /></td>
                  <td className="max-w-[220px] truncate px-2 py-2.5 font-mono text-xs text-ink-3">{summarize(r)}</td>
                  <td className="px-2 py-2.5 text-xs text-ink-2">{timeAgo(r.createdAt)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-ink-3">#{r.id}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {/* Mobile cards */}
          <ul className="divide-y divide-line-soft md:hidden">
            {visible.map((r) => (
              <li key={`${r.type}-${r.id}`}>
                <button onClick={() => onSelect(r)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
                  <span className="rounded-lg border border-line bg-panel-2 p-2 text-ink-2"><TypeIcon type={r.type} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-sm font-medium">{r.name}{r.sample && <Badge tone="warn">sample</Badge>}</span>
                    <span className="block truncate font-mono text-[11px] text-ink-3">{RESOURCE_META[r.type].short} · #{r.id} · {timeAgo(r.createdAt)}</span>
                  </span>
                  <StatusPill status={r.status} tone={r.tone} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function summarize(r: Resource): string {
  return Object.entries(r.details)
    .filter(([k, v]) => v !== null && v !== "" && k !== "lastError" && k !== "url")
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
}

function TopBar({ session, onOperator, onSignedOut }: { session: SessionInfo | null; onOperator: () => void; onSignedOut: () => void }) {
  const signOut = async () => {
    await api("/api/session", { method: "DELETE" }).catch(() => {});
    onSignedOut();
  };
  return (
    <header className="relative border-b border-line-soft bg-bg/70 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="" className="h-7 w-7" />
          <div>
            <div className="text-sm font-semibold tracking-tight">Launchpad</div>
            <div className="font-mono text-[10.5px] text-ink-3">for Harakumo · @harakumo/sdk 0.4.0</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {session ? (
            session.mode === "live" ? (
              <Badge tone="ok"><span className="h-1.5 w-1.5 rounded-full bg-ok" /> live · project #{session.projectId}</Badge>
            ) : (
              <Badge tone="warn">demo mode</Badge>
            )
          ) : (
            <span className="skeleton h-5 w-28" />
          )}
          {session?.mode === "live" &&
            (session.operator ? (
              <Button variant="ghost" onClick={signOut} title="Sign out of operator mode">Operator · sign out</Button>
            ) : (
              <Button variant="secondary" onClick={onOperator}><LockIcon /> Operator</Button>
            ))}
          <a href="https://github.com/whoguri/Harakumo" target="_blank" rel="noreferrer" className="rounded-lg px-2 py-1.5 text-sm text-ink-2 hover:bg-panel-2 hover:text-ink">Source</a>
        </div>
      </div>
    </header>
  );
}

function ModeBanner({ session, onOperator }: { session: SessionInfo | null; onOperator: () => void }) {
  if (!session) return <div className="skeleton mt-5 h-16" />;
  if (session.mode === "demo") {
    return (
      <div className="mt-5 rounded-xl border border-warn/30 bg-warn/5 px-4 py-3 text-sm">
        <div className="font-medium text-warn">Demo mode — nothing here talks to Harakumo</div>
        <p className="mt-1 text-ink-2">{session.demoReason} The inventory is sample data and every provisioning action is recorded as <span className="font-mono text-xs">simulated</span>. Set <span className="font-mono text-xs">HARAKUMO_API_KEY</span> on the server to go live.</p>
      </div>
    );
  }
  if (!session.canExecute) {
    return (
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-panel px-4 py-3 text-sm">
        <div className="min-w-0">
          <div className="font-medium">Live inventory, safe actions</div>
          <p className="mt-0.5 text-ink-2">Resources below are read from Harakumo in real time. As a visitor, provisioning runs as a <span className="font-mono text-xs text-warn">simulated</span> dry run showing the exact SDK call. {session.operatorConfigured ? "The owner can unlock real provisioning." : ""}</p>
        </div>
        {session.operatorConfigured && <Button onClick={onOperator}><LockIcon /> Unlock real provisioning</Button>}
      </div>
    );
  }
  return (
    <div className="mt-5 rounded-xl border border-accent/30 bg-accent/5 px-4 py-3 text-sm">
      <div className="font-medium text-accent">Operator mode — actions call Harakumo for real</div>
      <p className="mt-0.5 text-ink-2">Approved plans and the provision form create real resources in project #{session.projectId}. Launchpad never deletes anything.</p>
    </div>
  );
}

function Footer() {
  return (
    <footer className="mt-10 flex flex-wrap items-center justify-between gap-2 border-t border-line-soft pt-5 text-xs text-ink-3">
      <span>Harakumo Launchpad — a Next.js App Router demo built on the official Harakumo SDK.</span>
      <span className="font-mono">API: /api/resources · /api/assistant/plan · /api/assistant/execute · /api/operations</span>
    </footer>
  );
}

export function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
      <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}
