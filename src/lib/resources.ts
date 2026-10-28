import "server-only";
import { randomBytes } from "node:crypto";
import { getConfig } from "./config";
import { AppError, getHarakumo, toAppError } from "./harakumo";
import { getStore, resetStoreCache } from "./store";
import { log } from "./log";
import {
  RESOURCE_META,
  RESOURCE_TYPES,
  type Operation,
  type ProvisionRequest,
  type Resource,
  type ResourceType,
  type ResourcesResponse,
  type StatusTone,
} from "./schemas";
import { DEMO_RESOURCES } from "./demo";

export function newId(prefix: string) {
  return `${prefix}_${randomBytes(9).toString("base64url").toLowerCase().replace(/[^a-z0-9]/g, "x")}`;
}

function tone(status: string): StatusTone {
  const s = status.toLowerCase();
  if (["running", "active", "ready", "live"].includes(s)) return "ok";
  if (["provisioning", "creating", "pending", "building"].includes(s)) return "pending";
  if (["error", "failed"].includes(s)) return "error";
  return "neutral";
}

const fmtBytes = (n: number | null | undefined) =>
  n == null ? null : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;

/* ---- Normalizers: copy only display-safe fields (allow-list, never spread). ---- */

/* eslint-disable @typescript-eslint/no-explicit-any */
const normalize: Record<ResourceType, (r: any) => Resource> = {
  database: (d) => ({
    type: "database", id: d.id, name: d.name, status: d.status, tone: tone(d.status),
    createdAt: d.created_at ?? null, provider: d.provider ?? null,
    details: { engine: d.engine ?? "sqlite", size: fmtBytes(d.size_bytes), lastError: d.last_error || null },
  }),
  bucket: (b) => ({
    type: "bucket", id: b.id, name: b.name, status: b.status, tone: tone(b.status),
    createdAt: b.created_at ?? null, provider: "storage",
    details: { files: b.file_count ?? 0, size: fmtBytes(b.size_bytes) },
  }),
  vectors: (c) => ({
    type: "vectors", id: c.id, name: c.name, status: c.status, tone: tone(c.status),
    createdAt: c.created_at ?? null, provider: c.provider ?? null,
    details: { dimensions: c.dimensions, metric: c.metric, vectors: c.vector_count ?? 0, visitorChat: !!c.visitor_chat },
  }),
  memory: (m) => ({
    type: "memory", id: m.id, name: m.name, status: m.status, tone: tone(m.status),
    createdAt: m.created_at ?? null, provider: "memory",
    details: { kind: m.kind, items: m.item_count ?? null, searchable: !!m.searchable, ttlSeconds: m.ttl_seconds ?? null },
  }),
  function: (f) => ({
    type: "function", id: f.id, name: f.name, status: f.status, tone: tone(f.status),
    createdAt: f.last_deployed_at ?? f.created_at ?? null, provider: f.runtime ?? null,
    details: { runtime: f.runtime, url: f.url ?? null, testCalls: f.test_call_count ?? 0, lastError: f.last_error || null },
  }),
};
/* eslint-enable @typescript-eslint/no-explicit-any */

async function listType(type: ResourceType, projectId: number): Promise<Resource[]> {
  const hk = getHarakumo();
  switch (type) {
    case "database": return (await hk.databases.list(projectId)).databases.map(normalize.database);
    case "bucket": return (await hk.storage.list(projectId)).buckets.map(normalize.bucket);
    case "vectors": return (await hk.vectors.list(projectId)).collections.map(normalize.vectors);
    case "memory": return (await hk.memory.list(projectId)).stores.map(normalize.memory);
    case "function": return (await hk.functions.list(projectId)).functions.map(normalize.function);
  }
}

export async function listResources(): Promise<ResourcesResponse> {
  const cfg = getConfig();
  const fetchedAt = new Date().toISOString();
  if (cfg.mode === "demo" || !cfg.projectId) {
    return { mode: "demo", projectId: null, fetchedAt, resources: DEMO_RESOURCES, errors: [] };
  }
  const settled = await Promise.allSettled(RESOURCE_TYPES.map((t) => listType(t, cfg.projectId!)));
  const resources: Resource[] = [];
  const errors: ResourcesResponse["errors"] = [];
  settled.forEach((s, i) => {
    if (s.status === "fulfilled") resources.push(...s.value);
    else {
      const e = toAppError(s.reason);
      log.warn("list_failed", { type: RESOURCE_TYPES[i], err: e });
      errors.push({ type: RESOURCE_TYPES[i], code: e.code, message: e.message });
    }
  });
  if (errors.length === RESOURCE_TYPES.length) {
    const first = toAppError((settled[0] as PromiseRejectedResult).reason);
    throw first;
  }
  resources.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  return { mode: "live", projectId: cfg.projectId, fetchedAt, resources, errors };
}

export async function getResource(type: ResourceType, id: number): Promise<Resource & { extra: Record<string, unknown> }> {
  const cfg = getConfig();
  if (cfg.mode === "demo") {
    const r = DEMO_RESOURCES.find((x) => x.type === type && x.id === id);
    if (!r) throw new AppError("not_found", 404, "No sample resource with that id.");
    return { ...r, extra: { note: "Sample data shown in demo mode. Not fetched from Harakumo." } };
  }
  const hk = getHarakumo();
  const projectId = cfg.projectId!;
  try {
    let r: Resource;
    const extra: Record<string, unknown> = {};
    switch (type) {
      case "database": {
        const d = await hk.databases.get(id);
        if (d.project.id !== projectId) throw new AppError("not_found", 404, "Not in this project.");
        r = normalize.database(d.database);
        extra.limits = d.limits;
        extra.writable = d.canWrite;
        break;
      }
      case "bucket": {
        const { buckets } = await hk.storage.list(projectId);
        const b = buckets.find((x) => x.id === id);
        if (!b) throw new AppError("not_found", 404, "Not in this project.");
        r = normalize.bucket(b);
        break;
      }
      case "vectors": {
        const { collection, note } = await hk.vectors.get(id);
        if (collection.project_id !== projectId) throw new AppError("not_found", 404, "Not in this project.");
        r = normalize.vectors(collection);
        extra.allWritesSearchable = collection.all_writes_searchable ?? null;
        if (note) extra.note = note;
        break;
      }
      case "memory": {
        const { stores } = await hk.memory.list(projectId);
        const m = stores.find((x) => x.id === id);
        if (!m) throw new AppError("not_found", 404, "Not in this project.");
        r = normalize.memory(m);
        if (m.quota) extra.quota = m.quota;
        break;
      }
      case "function": {
        const f = await hk.functions.get(id);
        if (f.function.project_id !== projectId) throw new AppError("not_found", 404, "Not in this project.");
        r = normalize.function(f.function);
        // Source is safe to show: Launchpad only deploys its own vetted templates. Env var names, never values.
        extra.source = f.source;
        extra.envKeys = f.envKeys?.length ?? 0;
        break;
      }
    }
    return { ...r, extra };
  } catch (err) {
    throw toAppError(err);
  }
}

/* ---------------- Provisioning ---------------- */

const FUNCTION_SOURCE: Record<"health" | "echo", (name: string) => string> = {
  health: (name) => `// Deployed by Harakumo Launchpad (template: health)
export default {
  async fetch(request) {
    return Response.json({ ok: true, service: ${JSON.stringify(name)}, at: new Date().toISOString() });
  },
};
`,
  echo: (name) => `// Deployed by Harakumo Launchpad (template: echo)
export default {
  async fetch(request) {
    const url = new URL(request.url);
    return Response.json({ service: ${JSON.stringify(name)}, method: request.method, path: url.pathname, query: Object.fromEntries(url.searchParams) });
  },
};
`,
};

export function describeSdkCall(req: ProvisionRequest): string {
  const meta = RESOURCE_META[req.type];
  const body: Record<string, unknown> = { name: req.name };
  if (req.type === "vectors") Object.assign(body, req.config);
  if (req.type === "memory") body.kind = "memory";
  if (req.type === "function") Object.assign(body, { runtime: req.config.runtime, code: `<template:${req.config.template}>` });
  return `${meta.sdkCreate}(projectId, ${JSON.stringify(body)})`;
}

async function createReal(req: ProvisionRequest, projectId: number): Promise<Resource> {
  const hk = getHarakumo();
  switch (req.type) {
    case "database": return normalize.database((await hk.databases.create(projectId, { name: req.name, engine: "sqlite" })).database);
    case "bucket": return normalize.bucket((await hk.storage.create(projectId, { name: req.name })).bucket);
    case "vectors": return normalize.vectors((await hk.vectors.create(projectId, { name: req.name, dimensions: req.config.dimensions, metric: req.config.metric })).collection);
    case "memory": return normalize.memory((await hk.memory.create(projectId, { name: req.name, kind: "memory" })).store);
    case "function":
      return normalize.function(
        (await hk.functions.create(projectId, { name: req.name, runtime: req.config.runtime, code: FUNCTION_SOURCE[req.config.template](req.name) })).function,
      );
  }
}

export interface ProvisionResult {
  operation: Operation;
  resource: Resource | null;
  error: { code: string; message: string; retryable: boolean } | null;
}

/**
 * Provision one resource. `real` decides whether the Harakumo API is called;
 * a simulated provision is recorded and returned as `status: "simulated"`,
 * never as success.
 */
export async function provision(req: ProvisionRequest, opts: { real: boolean; planId?: string }): Promise<ProvisionResult> {
  const cfg = getConfig();
  const store = await getStore();
  const op: Operation = {
    id: newId("op"),
    createdAt: new Date().toISOString(),
    kind: "provision",
    execution: opts.real ? "real" : "simulated",
    resourceType: req.type,
    resourceName: req.name,
    status: opts.real ? "pending" : "simulated",
    harakumoId: null,
    errorCode: null,
    errorMessage: null,
    durationMs: null,
    planId: opts.planId ?? null,
    sdkCall: describeSdkCall(req),
  };

  if (!opts.real || cfg.mode !== "live" || !cfg.projectId) {
    op.execution = "simulated";
    op.status = "simulated";
    await safeStore(() => store.insertOperation(op));
    log.info("provision_simulated", { opId: op.id, type: req.type, name: req.name });
    return { operation: op, resource: null, error: null };
  }

  await safeStore(() => store.insertOperation(op));
  const started = Date.now();
  try {
    const resource = await createReal(req, cfg.projectId);
    op.durationMs = Date.now() - started;
    op.harakumoId = resource.id;
    // A database or function can come back created-but-errored: report it as failed with the platform's reason.
    if (resource.tone === "error") {
      op.status = "failed";
      op.errorCode = "created_with_error";
      op.errorMessage = String(resource.details.lastError ?? "Harakumo created the resource but reported an error.");
    } else op.status = "succeeded";
    await safeStore(() => store.updateOperation(op.id, op));
    log.info("provision_completed", { opId: op.id, type: req.type, name: req.name, harakumoId: resource.id, status: op.status, ms: op.durationMs });
    if (req.type === "database" && req.name === cfg.metadataDatabaseName) resetStoreCache();
    return { operation: op, resource, error: op.status === "failed" ? { code: op.errorCode!, message: op.errorMessage!, retryable: false } : null };
  } catch (err) {
    const e = toAppError(err);
    op.durationMs = Date.now() - started;
    op.status = "failed";
    op.errorCode = e.code;
    op.errorMessage = e.message;
    await safeStore(() => store.updateOperation(op.id, op));
    log.error("provision_failed", { opId: op.id, type: req.type, name: req.name, sdkCall: op.sdkCall, ms: op.durationMs, err: e });
    return { operation: op, resource: null, error: { code: e.code, message: e.message, retryable: e.retryable } };
  }
}

/** Metadata writes must never turn a successful provision into an error. */
async function safeStore(fn: () => Promise<void>) {
  try {
    await fn();
  } catch (err) {
    log.error("metadata_write_failed", { err: toAppError(err) });
  }
}
