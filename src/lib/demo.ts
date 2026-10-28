import type { Resource } from "./schemas";

/**
 * Sample inventory shown only in demo mode (no Harakumo credentials on the
 * server). Every row is flagged `sample: true` and the UI labels it.
 */
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

export const DEMO_RESOURCES: Resource[] = [
  {
    type: "database", id: 101, name: "app-primary", status: "running", tone: "ok", createdAt: ago(60 * 26),
    provider: "edge-sqlite", details: { engine: "sqlite", size: "48.0 KB", lastError: null }, sample: true,
  },
  {
    type: "bucket", id: 202, name: "user-uploads", status: "active", tone: "ok", createdAt: ago(60 * 5),
    provider: "storage", details: { files: 12, size: "3.4 MB" }, sample: true,
  },
  {
    type: "vectors", id: 303, name: "help-center", status: "ready", tone: "ok", createdAt: ago(90),
    provider: "edge", details: { dimensions: 768, metric: "cosine", vectors: 214, visitorChat: false }, sample: true,
  },
  {
    type: "function", id: 404, name: "webhook-relay", status: "error", tone: "error", createdAt: ago(12),
    provider: "edge", details: { runtime: "edge", url: null, testCalls: 0, lastError: "Sample: the edge rejected the last deploy." }, sample: true,
  },
];
