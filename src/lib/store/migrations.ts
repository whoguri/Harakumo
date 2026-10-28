/**
 * Ordered, append-only migrations for the metadata database (Harakumo edge
 * SQLite). Never edit a shipped migration: add a new one.
 */
export interface Migration {
  id: string;
  statements: string[];
}

export const MIGRATIONS: Migration[] = [
  {
    id: "001_operations",
    statements: [
      `CREATE TABLE IF NOT EXISTS operations (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        kind TEXT NOT NULL,
        execution TEXT NOT NULL CHECK (execution IN ('real','simulated')),
        resource_type TEXT NOT NULL,
        resource_name TEXT NOT NULL,
        status TEXT NOT NULL,
        harakumo_id INTEGER,
        error_code TEXT,
        error_message TEXT,
        duration_ms INTEGER,
        plan_id TEXT,
        sdk_call TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS operations_created_at ON operations (created_at DESC)`,
    ],
  },
  {
    id: "002_plans",
    statements: [
      `CREATE TABLE IF NOT EXISTS plans (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        prompt TEXT NOT NULL,
        status TEXT NOT NULL,
        payload TEXT NOT NULL
      )`,
    ],
  },
];

export const MIGRATIONS_TABLE = `CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
)`;
