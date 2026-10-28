import "server-only";
import { z } from "zod";
import { getConfig } from "./config";
import { getHarakumo, toAppError } from "./harakumo";
import { describeSdkCall, newId } from "./resources";
import { log } from "./log";
import { provisionRequest, RESOURCE_META, RESOURCE_TYPES, type Plan, type PlanAction, type ResourceType } from "./schemas";

/**
 * Natural language → structured infrastructure plan.
 *
 * 1. If the AI planner is on, ask the Harakumo AI Gateway (hk.ai.chat) for a
 *    JSON plan and validate every action with the same zod schema the
 *    provisioning endpoint uses. The model can only *propose*; nothing runs
 *    until the user approves the stored plan.
 * 2. If the gateway is off, out of credit, or returns something invalid, a
 *    deterministic keyword planner produces the plan, and the response says
 *    which planner was used.
 */

const MAX_ACTIONS = 4;

const aiPlanSchema = z.object({
  summary: z.string().max(400),
  actions: z
    .array(z.object({ type: z.enum(RESOURCE_TYPES), name: z.string(), config: z.record(z.unknown()).optional(), reason: z.string().max(300) }))
    .max(MAX_ACTIONS),
  notes: z.array(z.string().max(300)).max(5).default([]),
});

const SYSTEM_PROMPT = `You plan cloud resources on Harakumo for a developer. Reply with ONE JSON object and nothing else:
{"summary": string, "actions": [{"type": T, "name": string, "config": object, "reason": string}], "notes": string[]}
T is one of:
- "database": edge SQLite database (the ONLY SQL engine; Postgres/MySQL/Redis are not available). config {}
- "bucket": private object storage for files/uploads. config {}
- "vectors": vector collection for semantic search/RAG. config {"dimensions": 384|768|1024, "metric": "cosine"|"euclidean"|"dot"}
- "memory": per-end-user AI memory (chat threads, facts). config {}
- "function": small HTTP edge function. config {"runtime": "edge"|"node22", "template": "health"|"echo"}
Rules: at most ${MAX_ACTIONS} actions; only what the request needs; names are 4-40 chars, lowercase letters, digits, dashes, start with a letter;
if something requested is unsupported, leave it out and explain in notes. Never include deletes or secrets.`;

// Small in-process guard so anonymous traffic cannot burn the workspace's AI balance.
const aiBudget = { day: "", used: 0, max: Number(process.env.LAUNCHPAD_AI_DAILY_LIMIT ?? 60) };
function takeAiBudget(): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (aiBudget.day !== today) Object.assign(aiBudget, { day: today, used: 0 });
  if (aiBudget.used >= aiBudget.max) return false;
  aiBudget.used++;
  return true;
}

function toActions(raw: { type: ResourceType; name: string; config?: Record<string, unknown>; reason: string }[]) {
  const actions: PlanAction[] = [];
  const dropped: string[] = [];
  const seen = new Set<string>();
  for (const a of raw.slice(0, MAX_ACTIONS)) {
    const parsed = provisionRequest.safeParse({ type: a.type, name: a.name, config: a.config ?? {} });
    if (!parsed.success) {
      dropped.push(`Dropped a proposed ${a.type} "${a.name}": ${parsed.error.issues[0]?.message ?? "invalid"}`);
      continue;
    }
    const key = `${parsed.data.type}:${parsed.data.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    actions.push({ id: newId("act"), request: parsed.data, reason: a.reason, sdkCall: describeSdkCall(parsed.data) });
  }
  return { actions, dropped };
}

function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object in model output");
  return JSON.parse(text.slice(start, end + 1));
}

type PlanBody = Omit<Plan, "id" | "createdAt" | "prompt" | "status">;

async function planWithAi(prompt: string): Promise<PlanBody | string> {
  const cfg = getConfig();
  if (cfg.mode !== "live") return "demo mode";
  if (!cfg.aiPlanner) return "AI planner disabled";
  if (!takeAiBudget()) {
    log.warn("ai_planner_daily_limit");
    return "daily AI budget for this demo used up";
  }
  try {
    const answer = await getHarakumo().ai.chat({
      model: cfg.aiModel,
      tier: "fast",
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 700,
      temperature: 0,
      projectId: cfg.projectId ?? undefined,
    });
    const parsed = aiPlanSchema.parse(extractJson(answer.output));
    const { actions, dropped } = toActions(parsed.actions);
    const detail = `Harakumo AI Gateway · ${answer.modelUsed}${answer.simulated ? " (gateway reported simulated output)" : ""} · $${answer.cost.toFixed(4)} · ${answer.requestId}`;
    return { summary: parsed.summary, planner: "harakumo-ai", plannerDetail: detail, actions, notes: [...parsed.notes, ...dropped] };
  } catch (err) {
    const e = err instanceof z.ZodError || err instanceof SyntaxError ? err : toAppError(err);
    log.warn("ai_planner_fallback", { err: e });
    return err instanceof z.ZodError || err instanceof SyntaxError || (err instanceof Error && err.message.includes("JSON"))
      ? "model output failed validation"
      : `AI Gateway refused: ${(e as { code?: string }).code ?? "error"}`;
  }
}

/* ---------------- Deterministic fallback planner ---------------- */

const RULES: { type: ResourceType; re: RegExp; suffix: string; reason: string }[] = [
  { type: "database", re: /\b(database|db|sql|sqlite|postgres|mysql|tables?|relational|records)\b/, suffix: "db", reason: "Relational data → Harakumo edge SQLite." },
  { type: "bucket", re: /\b(storage|bucket|files?|uploads?|images?|avatars?|assets|media|blobs?|s3)\b/, suffix: "files", reason: "File uploads → private storage bucket with signed links." },
  { type: "vectors", re: /\b(vectors?|embeddings?|semantic|rag|similarity|search by meaning|knowledge base)\b/, suffix: "search", reason: "Search by meaning → vector collection (768-dim bge-base)." },
  { type: "memory", re: /\b(memory|memories|chat history|conversation|remember|chatbot|assistant)\b/, suffix: "memory", reason: "Per-user AI context → memory store." },
  { type: "function", re: /\b(function|endpoint|webhook|api|serverless|health ?check|cron)\b/, suffix: "api", reason: "Small HTTP handler → edge function from a vetted template." },
];

function appSlug(prompt: string): string {
  const named = prompt.match(/\b(?:called|named)\s+["'`]?([a-z][a-z0-9-]{1,24})/i);
  const owned = prompt.match(/\b(?:my|our|the|a|an)\s+([a-z][a-z0-9-]{1,24})\s+(?:app|application|project|service|site|bot|platform|store)\b/i);
  const forX = prompt.match(/\bfor\s+(?:my\s+|our\s+|the\s+)?([a-z][a-z0-9-]{1,24})(?:[.,!?]|$|\s)/i);
  const raw = (named?.[1] ?? owned?.[1] ?? forX?.[1] ?? "app").toLowerCase();
  const slug = raw.replace(/\b(app|application|project|my|the|api|database|db)\b/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24);
  return /^[a-z]/.test(slug) && slug.length >= 2 ? slug : "app";
}

function planWithRules(prompt: string, why: string): PlanBody {
  const text = prompt.toLowerCase();
  const slug = appSlug(prompt);
  const notes: string[] = [];
  const raw = RULES.filter((r) => r.re.test(text)).map((r) => ({
    type: r.type,
    name: `${slug}-${r.suffix}`.replace(/^(.{0,40}).*$/, "$1").replace(/-+$/, ""),
    config: {},
    reason: r.reason,
  }));
  if (/\b(postgres|mysql|redis|mongo)/.test(text)) notes.push("Postgres, MySQL, Redis and MongoDB are not available on Harakumo yet; planned edge SQLite instead.");
  if (/\b(delete|drop|destroy|remove|tear ?down)\b/.test(text)) notes.push("Launchpad never plans destructive operations. Delete resources from the Harakumo dashboard.");
  const { actions, dropped } = toActions(raw);
  if (!actions.length) notes.push("No supported resource type was recognised. Try: database, storage/uploads, vector search, AI memory, or an API endpoint.");
  const summary = actions.length
    ? `Provision ${actions.map((a) => `${RESOURCE_META[a.request.type].short.toLowerCase()} "${a.request.name}"`).join(", ")} in this Harakumo project.`
    : "Nothing to provision for this request.";
  return { summary, planner: "rules", plannerDetail: `Deterministic keyword planner (${why}).`, actions, notes: [...notes, ...dropped] };
}

export async function createPlan(prompt: string): Promise<Plan> {
  const ai = await planWithAi(prompt);
  const result = typeof ai === "string" ? planWithRules(prompt, ai) : ai;
  return { id: newId("plan"), createdAt: new Date().toISOString(), prompt, status: "proposed", ...result };
}
