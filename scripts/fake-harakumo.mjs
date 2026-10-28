#!/usr/bin/env node
/**
 * Local contract stub of the Harakumo endpoints Launchpad uses — for offline
 * integration tests only. It mirrors the paths and shapes the official
 * @harakumo/sdk 0.4.0 calls (see node_modules/@harakumo/sdk/universal.js) and
 * enforces Hobby-style limits (1 database, 2 buckets) so failure paths can be
 * exercised. Never used in production.
 *
 *   node scripts/fake-harakumo.mjs            # listens on :4010
 *   HARAKUMO_URL=http://localhost:4010 HARAKUMO_API_KEY=hk_live_test HARAKUMO_PROJECT_ID=1 npm run dev
 *
 * FAKE_AI=json|error|garbage controls /api/ai/chat.
 */
import http from "node:http";
import { DatabaseSync } from "node:sqlite";

const PORT = Number(process.env.FAKE_PORT ?? 4010);
const LIMITS = { databases: 1, storage: 2, vectors: 3, memory: 3, functions: 5 };
const now = () => new Date().toISOString();
let seq = 100;
const state = { databases: [], storage: [], vectors: [], memory: [], functions: [] };
const engines = new Map();

const send = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};
const refuse = (res, status, code, error) => send(res, status, { error, code });

function make(kind, projectId, body) {
  const base = { id: ++seq, project_id: projectId, name: body.name, created_at: now() };
  switch (kind) {
    case "databases": engines.set(base.id, new DatabaseSync(":memory:"));
      return { ...base, engine: "sqlite", status: "running", provider: "edge-sqlite", connection_string: "SECRET-should-never-reach-browser", size_bytes: 0 };
    case "storage": return { ...base, status: "active", size_bytes: 0, file_count: 0 };
    case "vectors": return { ...base, dimensions: body.dimensions ?? 768, metric: body.metric ?? "cosine", vector_count: 0, metadata_indexes: [], status: "ready", endpoint: `https://harakumo.com/api/vectors/${base.id}`, provider: "edge", visitor_chat: false };
    case "memory": return { ...base, kind: body.kind ?? "memory", item_count: 0, size_bytes: 0, ttl_seconds: 0, status: "active", searchable: true, edge_fallback: false };
    case "functions": return { ...base, runtime: body.runtime ?? "edge", status: "active", url: `https://hk-demo--${body.name}.harakumo.app`, last_error: "", test_call_count: 0, invocation_count: null, last_deployed_at: now(), _source: body.code ?? "" };
  }
}

function run(db, sql, params = []) {
  const stmt = db.prepare(sql);
  if (/^\s*(select|with|pragma)/i.test(sql)) return { results: stmt.all(...params), meta: { rows_read: 0 } };
  const r = stmt.run(...params);
  return { results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
}

const server = http.createServer(async (req, res) => {
  if (!/^Bearer hk_/.test(req.headers.authorization ?? "")) return refuse(res, 401, "unauthorized", "Missing or invalid API key.");
  let raw = "";
  for await (const c of req) raw += c;
  const body = raw ? JSON.parse(raw) : {};
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  let m;
  console.log(req.method, p);

  if ((m = p.match(/^\/api\/projects\/(\d+)\/(databases|storage|vectors|memory|functions)$/))) {
    const [, pid, kind] = m;
    const key = { databases: "databases", storage: "buckets", vectors: "collections", memory: "stores", functions: "functions" }[kind];
    const single = { databases: "database", storage: "bucket", vectors: "collection", memory: "store", functions: "function" }[kind];
    if (req.method === "GET") return send(res, 200, { [key]: state[kind].filter((r) => r.project_id === +pid).map(({ _source, ...r }) => r) });
    if (state[kind].length >= LIMITS[kind]) return refuse(res, 402, "plan_limit", `Your plan allows ${LIMITS[kind]} ${kind}.`);
    if (state[kind].some((r) => r.name === body.name)) return refuse(res, 409, "name_taken", `A ${single} named ${body.name} already exists.`);
    const row = make(kind, +pid, body);
    state[kind].push(row);
    const { _source, ...pub } = row;
    return send(res, 201, { [single]: pub });
  }
  if ((m = p.match(/^\/api\/databases\/(\d+)$/))) {
    const db = state.databases.find((d) => d.id === +m[1]);
    if (!db) return refuse(res, 404, "not_found", "Database not found.");
    if (req.method === "GET") return send(res, 200, { database: db, project: { id: db.project_id, name: "demo", slug: "demo" }, endpoint: "x", limits: { maxBatch: 100 }, canWrite: true });
    try {
      const eng = engines.get(db.id);
      if (body.batch) return send(res, 200, { batch: body.batch.map((s) => run(eng, s.sql, s.params)) });
      const r = run(eng, body.sql, body.params);
      return send(res, 200, { ...r, statements: 1 });
    } catch (e) { return refuse(res, 400, "sql_error", String(e.message)); }
  }
  if ((m = p.match(/^\/api\/vectors\/(\d+)$/))) {
    const c = state.vectors.find((d) => d.id === +m[1]);
    return c ? send(res, 200, { collection: { ...c, all_writes_searchable: true } }) : refuse(res, 404, "not_found", "Not found.");
  }
  if ((m = p.match(/^\/api\/functions\/(\d+)$/))) {
    const f = state.functions.find((d) => d.id === +m[1]);
    if (!f) return refuse(res, 404, "not_found", "Not found.");
    const { _source, ...pub } = f;
    return send(res, 200, { function: pub, source: _source, sourceUpdatedAt: f.created_at, envKeys: ["HARAKUMO_PROJECT_ID"], canWrite: true });
  }
  if (p === "/api/ai/chat") {
    const mode = process.env.FAKE_AI ?? "json";
    if (mode === "error") return refuse(res, 402, "insufficient_balance", "The workspace balance is empty.");
    const output = mode === "garbage" ? "Sure! Here is a plan: make a db." : JSON.stringify({
      summary: "A SQL database and an uploads bucket for the recipe app.",
      actions: [
        { type: "database", name: "recipes-db", config: {}, reason: "Recipes and users are relational." },
        { type: "bucket", name: "recipe-photos", config: {}, reason: "User photo uploads." },
        { type: "database", name: "BAD NAME", config: {}, reason: "invalid on purpose" },
      ],
      notes: ["Postgres is not available; using edge SQLite."],
    });
    return send(res, 200, { requestId: "req_fake123", model: "harakumo-1", modelUsed: "fake-model", provider: "fake", simulated: false, output, message: { role: "assistant", content: output }, finishReason: "stop", truncated: false, maxTokens: 700, latencyMs: 5, tokensIn: 1, tokensOut: 1, usage: { tokensIn: 1, tokensOut: 1 }, cost: 0.0001, costMicros: 100 });
  }
  refuse(res, 404, "not_found", `No fake for ${req.method} ${p}`);
});

server.listen(PORT, () => console.log(`fake harakumo on :${PORT}`));
