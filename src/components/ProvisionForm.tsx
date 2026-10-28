"use client";

import { useState } from "react";
import { api, ApiError } from "./api";
import { Badge, Button, cx, ErrorNote, Panel, Spinner, TypeIcon } from "./ui";
import { RESOURCE_META, RESOURCE_TYPES, type Operation, type Resource, type ResourceType, type SessionInfo } from "@/lib/schemas";

export interface ProvisionResponse {
  operation: Operation;
  resource: Resource | null;
  error: { code: string; message: string; retryable: boolean } | null;
}

const NAME_RE = /^[a-z][a-z0-9-]{2,38}[a-z0-9]$/;

export function ProvisionForm({ session, onProvisioned }: { session: SessionInfo | null; onProvisioned: () => void }) {
  const [type, setType] = useState<ResourceType>("bucket");
  const [name, setName] = useState("");
  const [dimensions, setDimensions] = useState(768);
  const [metric, setMetric] = useState("cosine");
  const [runtime, setRuntime] = useState("edge");
  const [template, setTemplate] = useState("health");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ProvisionResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const nameValid = NAME_RE.test(name);
  const real = !!session?.canExecute;

  const config =
    type === "vectors" ? { dimensions, metric } : type === "function" ? { runtime, template } : {};

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameValid || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await api<ProvisionResponse>("/api/resources", { method: "POST", body: { type, name, config } });
      setResult(res);
      onProvisioned();
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      id="provision"
      title="Provision a resource"
      subtitle={<>Calls <span className="font-mono">{RESOURCE_META[type].sdkCreate}</span> on the server</>}
      actions={real ? <Badge tone="accent">real</Badge> : <Badge tone="warn">dry run</Badge>}
    >
      <form onSubmit={submit} className="space-y-4 p-4">
        <fieldset>
          <legend className="mb-1.5 text-xs font-medium text-ink-2">Resource type</legend>
          <div className="grid grid-cols-5 gap-1.5">
            {RESOURCE_TYPES.map((t) => (
              <button key={t} type="button" onClick={() => setType(t)} aria-pressed={type === t}
                className={cx("flex flex-col items-center gap-1 rounded-lg border px-1 py-2 text-[11px] transition",
                  type === t ? "border-accent/60 bg-accent/10 text-accent" : "border-line bg-panel-2 text-ink-2 hover:border-ink-3")}>
                <TypeIcon type={t} />
                {RESOURCE_META[t].short}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-ink-3">{RESOURCE_META[type].description}</p>
        </fieldset>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-ink-2">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value.toLowerCase())} placeholder={`e.g. myapp-${type === "bucket" ? "uploads" : type}`}
            maxLength={40} autoComplete="off" spellCheck={false} aria-invalid={!!name && !nameValid}
            className="w-full rounded-lg border border-line bg-bg px-3 py-2 font-mono text-sm outline-none transition placeholder:text-ink-3 focus:border-accent/60" />
          <span className={cx("mt-1 block text-[11px]", name && !nameValid ? "text-err" : "text-ink-3")}>
            4–40 chars · lowercase letters, digits, dashes · starts with a letter
          </span>
        </label>

        {type === "vectors" && (
          <div className="grid grid-cols-2 gap-3">
            <Select label="Dimensions" value={String(dimensions)} onChange={(v) => setDimensions(Number(v))} options={[["384", "384 · bge-small"], ["768", "768 · bge-base"], ["1024", "1024 · bge-large"]]} />
            <Select label="Metric" value={metric} onChange={setMetric} options={[["cosine", "cosine"], ["euclidean", "euclidean"], ["dot", "dot"]]} />
          </div>
        )}
        {type === "function" && (
          <div className="grid grid-cols-2 gap-3">
            <Select label="Runtime" value={runtime} onChange={setRuntime} options={[["edge", "edge (Web APIs)"], ["node22", "node22"]]} />
            <Select label="Template" value={template} onChange={setTemplate} options={[["health", "health check"], ["echo", "request echo"]]} />
          </div>
        )}

        <Button type="submit" variant="primary" disabled={!nameValid || busy || !session} className="w-full">
          {busy ? <><Spinner /> Provisioning…</> : real ? `Provision ${RESOURCE_META[type].short.toLowerCase()}` : `Dry-run ${RESOURCE_META[type].short.toLowerCase()}`}
        </Button>

        {error && <ErrorNote code={error.code} message={error.message} />}
        {result && <ResultCard result={result} />}
      </form>
    </Panel>
  );
}

export function ResultCard({ result }: { result: ProvisionResponse }) {
  const { operation: op, resource, error } = result;
  if (error) {
    return (
      <div className="rounded-lg border border-err/30 bg-err/5 p-3 text-sm" role="alert">
        <div className="flex items-center gap-2"><Badge tone="err">failed</Badge><span className="font-mono text-xs text-err">{error.code}</span></div>
        <p className="mt-1.5 text-ink-2">{error.message}</p>
        <p className="mt-1.5 font-mono text-[11px] text-ink-3">{op.sdkCall} · {op.durationMs}ms · {op.id}</p>
      </div>
    );
  }
  if (op.execution === "simulated") {
    return (
      <div className="rounded-lg border border-warn/30 bg-warn/5 p-3 text-sm">
        <div className="flex items-center gap-2"><Badge tone="warn">simulated</Badge><span className="text-xs text-ink-2">Not sent to Harakumo</span></div>
        <p className="mt-1.5 text-ink-2">An operator session would run:</p>
        <pre className="mt-1 overflow-x-auto rounded bg-bg p-2 font-mono text-[11px] text-ink-2">{op.sdkCall}</pre>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-ok/30 bg-ok/5 p-3 text-sm">
      <div className="flex items-center gap-2"><Badge tone="ok">created</Badge><span className="text-xs text-ink-2">Harakumo returned {RESOURCE_META[op.resourceType].short.toLowerCase()} #{resource?.id}</span></div>
      {resource && (
        <pre className="mt-2 overflow-x-auto rounded bg-bg p-2 font-mono text-[11px] text-ink-2">{JSON.stringify({ id: resource.id, name: resource.name, status: resource.status, provider: resource.provider, ...resource.details }, null, 2)}</pre>
      )}
      <p className="mt-1.5 font-mono text-[11px] text-ink-3">{op.durationMs}ms · {op.id}</p>
    </div>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-ink-2">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg border border-line bg-bg px-2.5 py-2 text-sm outline-none focus:border-accent/60">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}
