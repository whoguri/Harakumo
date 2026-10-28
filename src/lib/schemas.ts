import { z } from "zod";

/**
 * Shared request/response contracts. Imported by route handlers (server-side
 * validation) and by client components (types only).
 */

export const RESOURCE_TYPES = ["database", "bucket", "vectors", "memory", "function"] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

export const RESOURCE_META: Record<
  ResourceType,
  { label: string; short: string; plural: string; sdkCreate: string; sdkList: string; description: string }
> = {
  database: {
    label: "Edge SQLite database",
    short: "Database",
    plural: "Databases",
    sdkCreate: "hk.databases.create",
    sdkList: "hk.databases.list",
    description: "SQL over HTTPS. Up to 10 GB, batches of 100 statements, .sql export.",
  },
  bucket: {
    label: "Storage bucket",
    short: "Bucket",
    plural: "Buckets",
    sdkCreate: "hk.storage.create",
    sdkList: "hk.storage.list",
    description: "Private object storage with signed upload/download links.",
  },
  vectors: {
    label: "Vector collection",
    short: "Vectors",
    plural: "Vector sets",
    sdkCreate: "hk.vectors.create",
    sdkList: "hk.vectors.list",
    description: "Search by meaning. Send text; the platform embeds it.",
  },
  memory: {
    label: "AI memory store",
    short: "Memory",
    plural: "Memory stores",
    sdkCreate: "hk.memory.create",
    sdkList: "hk.memory.list",
    description: "Per-end-user threads, facts and keys for AI apps.",
  },
  function: {
    label: "Edge function",
    short: "Function",
    plural: "Functions",
    sdkCreate: "hk.functions.create",
    sdkList: "hk.functions.list",
    description: "One ES module with its own URL. Created from a vetted template.",
  },
};

export const resourceName = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z][a-z0-9-]{2,38}[a-z0-9]$/, "Use 4–40 characters: lowercase letters, digits and dashes, starting with a letter.");

export const FUNCTION_TEMPLATES = ["health", "echo"] as const;

export const provisionRequest = z.discriminatedUnion("type", [
  z.object({ type: z.literal("database"), name: resourceName, config: z.object({}).strict().default({}) }),
  z.object({ type: z.literal("bucket"), name: resourceName, config: z.object({}).strict().default({}) }),
  z.object({
    type: z.literal("vectors"),
    name: resourceName,
    config: z
      .object({
        dimensions: z.union([z.literal(384), z.literal(768), z.literal(1024)]).default(768),
        metric: z.enum(["cosine", "euclidean", "dot"]).default("cosine"),
      })
      .strict()
      .default({}),
  }),
  z.object({ type: z.literal("memory"), name: resourceName, config: z.object({}).strict().default({}) }),
  z.object({
    type: z.literal("function"),
    name: resourceName,
    config: z
      .object({
        runtime: z.enum(["edge", "node22"]).default("edge"),
        template: z.enum(FUNCTION_TEMPLATES).default("health"),
      })
      .strict()
      .default({}),
  }),
]);
export type ProvisionRequest = z.infer<typeof provisionRequest>;

export const planRequest = z.object({
  prompt: z.string().trim().min(4, "Describe what you need.").max(600, "Keep the request under 600 characters."),
});

export const executeRequest = z.object({
  planId: z.string().regex(/^plan_[a-z0-9]{12,}$/),
  approve: z.literal(true, { errorMap: () => ({ message: "Explicit approval (approve: true) is required." }) }),
});

export const sessionRequest = z.object({ token: z.string().min(16).max(256) });

/* ---------- Response shapes (shared with the client) ---------- */

export type StatusTone = "ok" | "pending" | "error" | "neutral";

export interface Resource {
  type: ResourceType;
  id: number;
  name: string;
  status: string;
  tone: StatusTone;
  createdAt: string | null;
  provider: string | null;
  /** Sanitized, display-safe configuration. Never secrets or connection strings. */
  details: Record<string, string | number | boolean | null>;
  sample?: boolean;
}

export interface ResourcesResponse {
  mode: "live" | "demo";
  projectId: number | null;
  fetchedAt: string;
  resources: Resource[];
  errors: { type: ResourceType; code: string; message: string }[];
}

export interface Operation {
  id: string;
  createdAt: string;
  kind: "provision";
  execution: "real" | "simulated";
  resourceType: ResourceType;
  resourceName: string;
  status: "pending" | "succeeded" | "failed" | "simulated";
  harakumoId: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  durationMs: number | null;
  planId: string | null;
  sdkCall: string;
}

export interface PlanAction {
  id: string;
  request: ProvisionRequest;
  reason: string;
  sdkCall: string;
}

export interface Plan {
  id: string;
  createdAt: string;
  prompt: string;
  summary: string;
  planner: "harakumo-ai" | "rules";
  plannerDetail: string;
  actions: PlanAction[];
  notes: string[];
  status: "proposed" | "executing" | "executed" | "partial" | "failed";
}

export interface SessionInfo {
  mode: "live" | "demo";
  demoReason: string | null;
  projectId: number | null;
  operator: boolean;
  operatorConfigured: boolean;
  canExecute: boolean;
  store: "harakumo-sqlite" | "memory";
  storeDetail: string;
  aiPlanner: boolean;
}

export interface ApiErrorBody {
  error: { code: string; message: string; retryable: boolean; issues?: { path: string; message: string }[] };
}
