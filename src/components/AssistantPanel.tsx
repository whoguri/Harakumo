"use client";

import { useState } from "react";
import { api, ApiError } from "./api";
import { Badge, Button, ErrorNote, Panel, Spinner, TypeIcon } from "./ui";
import { ResultCard, type ProvisionResponse } from "./ProvisionForm";
import { RESOURCE_META, type Plan, type SessionInfo } from "@/lib/schemas";

const EXAMPLES = [
  "Create a database for my application.",
  "My recipe app needs user photo uploads and a SQL database.",
  "Set up semantic search and chat memory for a support bot called helpdesk.",
  "Add a health-check endpoint for my api.",
];

type ExecResponse = { plan: Plan; execution: "real" | "simulated"; results: (ProvisionResponse & { actionId: string })[]; skipped: number };

export function AssistantPanel({ session, onExecuted, onOperator }: { session: SessionInfo | null; onExecuted: () => void; onOperator: () => void }) {
  const [prompt, setPrompt] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [planning, setPlanning] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [approved, setApproved] = useState(false);
  const [exec, setExec] = useState<ExecResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const real = !!session?.canExecute;

  const ask = async (text = prompt) => {
    if (text.trim().length < 4 || planning) return;
    setPrompt(text);
    setPlanning(true);
    setError(null);
    setPlan(null);
    setExec(null);
    setApproved(false);
    try {
      const { plan } = await api<{ plan: Plan }>("/api/assistant/plan", { method: "POST", body: { prompt: text } });
      setPlan(plan);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setPlanning(false);
    }
  };

  const execute = async () => {
    if (!plan || !approved) return;
    setExecuting(true);
    setError(null);
    try {
      const res = await api<ExecResponse>("/api/assistant/execute", { method: "POST", body: { planId: plan.id, approve: true } });
      setExec(res);
      setPlan(res.plan);
      onExecuted();
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setExecuting(false);
    }
  };

  return (
    <Panel
      title={<span className="flex items-center gap-2">Infrastructure assistant <Badge tone="neutral">plan → approve → run</Badge></span>}
      subtitle={session?.aiPlanner ? "Plans with the Harakumo AI Gateway; falls back to a deterministic planner. It only proposes — you approve." : "Deterministic keyword planner (AI Gateway available in live mode). It only proposes — you approve."}
    >
      <div className="space-y-3 p-4">
        <form onSubmit={(e) => { e.preventDefault(); void ask(); }}>
          <label htmlFor="assistant-prompt" className="sr-only">Describe the infrastructure you need</label>
          <textarea id="assistant-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={600} rows={3}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void ask(); }}
            placeholder="Create a database for my application."
            className="w-full resize-none rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none transition placeholder:text-ink-3 focus:border-accent/60" />
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-[11px] text-ink-3">⌘/Ctrl + Enter</span>
            <Button type="submit" variant="primary" disabled={planning || prompt.trim().length < 4}>{planning ? <><Spinner /> Planning…</> : "Propose plan"}</Button>
          </div>
        </form>

        {!plan && !planning && !error && (
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES.map((ex) => (
              <button key={ex} onClick={() => void ask(ex)} className="rounded-full border border-line bg-panel-2 px-2.5 py-1 text-left text-[11.5px] text-ink-2 transition hover:border-accent/50 hover:text-ink">{ex}</button>
            ))}
          </div>
        )}

        {planning && <div className="space-y-2"><div className="skeleton h-4 w-3/4" /><div className="skeleton h-14" /><div className="skeleton h-14" /></div>}
        {error && <ErrorNote code={error.code} message={error.message} onRetry={error.retryable ? () => void ask() : undefined} />}

        {plan && (
          <div className="rounded-lg border border-line bg-bg/60">
            <div className="border-b border-line-soft px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone={plan.planner === "harakumo-ai" ? "accent" : "neutral"}>{plan.planner === "harakumo-ai" ? "AI gateway" : "rules"}</Badge>
                <Badge tone={plan.status === "proposed" ? "warn" : plan.status === "executed" ? "ok" : plan.status === "executing" ? "neutral" : "err"}>{plan.status}</Badge>
                <span className="font-mono text-[10.5px] text-ink-3">{plan.id}</span>
              </div>
              <p className="mt-1.5 text-sm">{plan.summary}</p>
              <p className="mt-0.5 font-mono text-[10.5px] text-ink-3">{plan.plannerDetail}</p>
            </div>

            {plan.actions.length > 0 && (
              <ol className="divide-y divide-line-soft">
                {plan.actions.map((a, i) => {
                  const r = exec?.results.find((x) => x.actionId === a.id);
                  return (
                    <li key={a.id} className="px-3 py-2.5">
                      <div className="flex items-start gap-2.5">
                        <span className="mt-0.5 font-mono text-[11px] text-ink-3">{i + 1}.</span>
                        <TypeIcon type={a.request.type} className="mt-0.5 text-accent" />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5 text-sm">
                            <span className="font-medium">{RESOURCE_META[a.request.type].short}</span>
                            <span className="font-mono text-ink-2">{a.request.name}</span>
                            {r && (r.error ? <Badge tone="err">failed</Badge> : r.operation.execution === "simulated" ? <Badge tone="warn">simulated</Badge> : <Badge tone="ok">created #{r.resource?.id}</Badge>)}
                          </div>
                          <p className="text-xs text-ink-3">{a.reason}</p>
                          <pre className="mt-1 overflow-x-auto font-mono text-[10.5px] text-ink-3">{a.sdkCall}</pre>
                          {r?.error && <p className="mt-1 text-xs text-err">{r.error.code}: {r.error.message}</p>}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}

            {plan.notes.length > 0 && (
              <ul className="space-y-1 border-t border-line-soft px-3 py-2.5 text-xs text-ink-2">
                {plan.notes.map((n, i) => <li key={i}>• {n}</li>)}
              </ul>
            )}

            {plan.status === "proposed" && plan.actions.length > 0 && (
              <div className="space-y-2.5 border-t border-line-soft px-3 py-3">
                <label className="flex cursor-pointer items-start gap-2 text-xs text-ink-2">
                  <input type="checkbox" checked={approved} onChange={(e) => setApproved(e.target.checked)} className="mt-0.5 accent-[var(--color-accent)]" />
                  <span>
                    I reviewed these {plan.actions.length} action{plan.actions.length > 1 ? "s" : ""} and approve running them
                    {real ? <> <strong className="text-ink">against Harakumo project #{session?.projectId}</strong>.</> : <> as a <strong className="text-warn">simulation</strong> (no Harakumo calls).</>}
                  </span>
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="primary" onClick={() => void execute()} disabled={!approved || executing}>
                    {executing ? <><Spinner /> Running…</> : real ? "Approve & provision" : "Approve & simulate"}
                  </Button>
                  <Button variant="ghost" onClick={() => { setPlan(null); setApproved(false); }}>Discard</Button>
                  {!real && session?.mode === "live" && session.operatorConfigured && (
                    <button onClick={onOperator} className="text-xs text-accent hover:underline">Unlock real provisioning</button>
                  )}
                </div>
              </div>
            )}

            {exec && (
              <div className="border-t border-line-soft px-3 py-3 text-xs text-ink-2">
                {exec.execution === "simulated"
                  ? "Simulated: the plan was recorded but no Harakumo resources were created."
                  : `Ran ${exec.results.length} action(s) against Harakumo${exec.skipped ? `; ${exec.skipped} skipped after a failure` : ""}.`}
                {exec.results.filter((r) => r.error).slice(0, 1).map((r) => <div key={r.actionId} className="mt-2"><ResultCard result={r} /></div>)}
              </div>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}
