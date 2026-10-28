import "server-only";
import type { Operation, Plan } from "../schemas";
import { getConfig } from "../config";
import { getHarakumo } from "../harakumo";
import { MIGRATIONS, MIGRATIONS_TABLE } from "./migrations";
import { log } from "../log";

/**
 * Persistence for app metadata: the provisioning activity log and assistant
 * plans. In live mode it lives in a Harakumo edge SQLite database in the same
 * project (found by LAUNCHPAD_DATABASE_ID or by name); otherwise, or until
 * that database exists, it falls back to process memory and says so.
 */
export interface MetadataStore {
  kind: "harakumo-sqlite" | "memory";
  detail: string;
  insertOperation(op: Operation): Promise<void>;
  updateOperation(id: string, patch: Partial<Operation>): Promise<void>;
  listOperations(limit: number): Promise<Operation[]>;
  savePlan(plan: Plan): Promise<void>;
  getPlan(id: string): Promise<Plan | null>;
}

/* ---------------- In-memory store ---------------- */

class MemoryStore implements MetadataStore {
  kind = "memory" as const;
  private ops: Operation[] = [];
  private plans = new Map<string, Plan>();
  constructor(public detail: string) {}
  async insertOperation(op: Operation) {
    this.ops.unshift(op);
    this.ops.length = Math.min(this.ops.length, 200);
  }
  async updateOperation(id: string, patch: Partial<Operation>) {
    const op = this.ops.find((o) => o.id === id);
    if (op) Object.assign(op, patch);
  }
  async listOperations(limit: number) {
    return this.ops.slice(0, limit);
  }
  async savePlan(plan: Plan) {
    this.plans.set(plan.id, structuredClone(plan));
    if (this.plans.size > 200) this.plans.delete(this.plans.keys().next().value!);
  }
  async getPlan(id: string) {
    const p = this.plans.get(id);
    return p ? structuredClone(p) : null;
  }
}

/* ---------------- Harakumo edge SQLite store ---------------- */

type Row = Record<string, unknown>;

class HarakumoSqlStore implements MetadataStore {
  kind = "harakumo-sqlite" as const;
  private migrated: Promise<void> | null = null;
  constructor(private dbId: number, public detail: string) {}

  private async q(sql: string, params: unknown[] = []): Promise<Row[]> {
    await this.migrate();
    const { results } = await getHarakumo().databases.query(this.dbId, sql, params);
    return results;
  }

  migrate(): Promise<void> {
    if (!this.migrated) {
      this.migrated = (async () => {
        const hk = getHarakumo();
        await hk.databases.query(this.dbId, MIGRATIONS_TABLE);
        const { results } = await hk.databases.query<{ id: string }>(this.dbId, "SELECT id FROM schema_migrations");
        const applied = new Set(results.map((r) => r.id));
        for (const m of MIGRATIONS) {
          if (applied.has(m.id)) continue;
          await hk.databases.batch(this.dbId, [
            ...m.statements.map((sql) => ({ sql })),
            { sql: "INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)", params: [m.id, new Date().toISOString()] },
          ]);
          log.info("migration_applied", { id: m.id, dbId: this.dbId });
        }
      })().catch((err) => {
        this.migrated = null;
        throw err;
      });
    }
    return this.migrated;
  }

  async insertOperation(op: Operation) {
    await this.q(
      `INSERT INTO operations (id, created_at, kind, execution, resource_type, resource_name, status, harakumo_id,
        error_code, error_message, duration_ms, plan_id, sdk_call) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [op.id, op.createdAt, op.kind, op.execution, op.resourceType, op.resourceName, op.status, op.harakumoId,
        op.errorCode, op.errorMessage, op.durationMs, op.planId, op.sdkCall],
    );
  }

  async updateOperation(id: string, patch: Partial<Operation>) {
    const cols: Record<string, keyof Operation> = {
      status: "status", harakumo_id: "harakumoId", error_code: "errorCode",
      error_message: "errorMessage", duration_ms: "durationMs",
    };
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [col, key] of Object.entries(cols)) {
      if (key in patch) {
        sets.push(`${col} = ?`);
        params.push(patch[key] ?? null);
      }
    }
    if (!sets.length) return;
    await this.q(`UPDATE operations SET ${sets.join(", ")} WHERE id = ?`, [...params, id]);
  }

  async listOperations(limit: number) {
    const rows = await this.q("SELECT * FROM operations ORDER BY created_at DESC LIMIT ?", [limit]);
    return rows.map(
      (r): Operation => ({
        id: String(r.id),
        createdAt: String(r.created_at),
        kind: "provision",
        execution: r.execution === "real" ? "real" : "simulated",
        resourceType: r.resource_type as Operation["resourceType"],
        resourceName: String(r.resource_name),
        status: r.status as Operation["status"],
        harakumoId: r.harakumo_id == null ? null : Number(r.harakumo_id),
        errorCode: (r.error_code as string) ?? null,
        errorMessage: (r.error_message as string) ?? null,
        durationMs: r.duration_ms == null ? null : Number(r.duration_ms),
        planId: (r.plan_id as string) ?? null,
        sdkCall: String(r.sdk_call),
      }),
    );
  }

  async savePlan(plan: Plan) {
    await this.q(
      `INSERT INTO plans (id, created_at, prompt, status, payload) VALUES (?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET status = excluded.status, payload = excluded.payload`,
      [plan.id, plan.createdAt, plan.prompt, plan.status, JSON.stringify(plan)],
    );
  }

  async getPlan(id: string) {
    const rows = await this.q("SELECT payload FROM plans WHERE id = ?", [id]);
    return rows[0] ? (JSON.parse(String(rows[0].payload)) as Plan) : null;
  }
}

/* ---------------- Store selection ---------------- */

const memory = new MemoryStore("In-process memory: resets when the server restarts.");
let resolved: { store: MetadataStore; at: number } | null = null;

export async function getStore(): Promise<MetadataStore> {
  const cfg = getConfig();
  if (cfg.mode !== "live" || !cfg.projectId) {
    memory.detail = "In-process memory (demo mode): resets when the server restarts.";
    return memory;
  }
  // Re-check every minute while falling back, so creating the database later is picked up.
  if (resolved && (resolved.store.kind === "harakumo-sqlite" || Date.now() - resolved.at < 60_000)) {
    return resolved.store;
  }
  try {
    let dbId = cfg.metadataDatabaseId;
    if (!dbId) {
      const { databases } = await getHarakumo().databases.list(cfg.projectId);
      const db = databases.find(
        (d) => d.name === cfg.metadataDatabaseName && d.provider === "edge-sqlite" && d.status === "running",
      );
      dbId = db?.id ?? null;
    }
    if (dbId) {
      const store = new HarakumoSqlStore(dbId, `Harakumo edge SQLite database #${dbId} (${cfg.metadataDatabaseName}).`);
      await store.migrate();
      resolved = { store, at: Date.now() };
      return store;
    }
    memory.detail = `No running database named "${cfg.metadataDatabaseName}" in project #${cfg.projectId} yet; using in-process memory. Provision one with that name to persist the log.`;
  } catch (err) {
    log.error("metadata_store_unavailable", { err });
    memory.detail = "Metadata database unreachable; using in-process memory until it recovers.";
  }
  resolved = { store: memory, at: Date.now() };
  return memory;
}

export function resetStoreCache() {
  resolved = null;
}
