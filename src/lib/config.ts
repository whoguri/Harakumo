import "server-only";

/**
 * Runtime configuration, read once per request from process.env.
 *
 * Harakumo injects HARAKUMO_PROJECT_ID into every deployed app, so on the
 * platform only HARAKUMO_API_KEY (and optionally LAUNCHPAD_OPERATOR_TOKEN)
 * has to be set by hand.
 */
export type AppMode = "live" | "demo";

export interface AppConfig {
  mode: AppMode;
  apiKey: string | null;
  projectId: number | null;
  baseUrl: string | undefined;
  operatorToken: string | null;
  metadataDatabaseId: number | null;
  metadataDatabaseName: string;
  aiPlanner: boolean;
  aiModel: string;
  /** Why the app is in demo mode, for the UI banner. */
  demoReason: string | null;
}

function intOrNull(v: string | undefined): number | null {
  if (!v) return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function getConfig(): AppConfig {
  const apiKey = process.env.HARAKUMO_API_KEY?.trim() || null;
  const projectId = intOrNull(process.env.HARAKUMO_PROJECT_ID);
  const operatorToken = process.env.LAUNCHPAD_OPERATOR_TOKEN?.trim() || null;

  let demoReason: string | null = null;
  if (process.env.LAUNCHPAD_FORCE_DEMO === "1") demoReason = "Demo mode forced by LAUNCHPAD_FORCE_DEMO.";
  else if (!apiKey) demoReason = "HARAKUMO_API_KEY is not configured on the server.";
  else if (!apiKey.startsWith("hk_")) demoReason = "HARAKUMO_API_KEY does not look like a Harakumo key.";
  else if (!projectId) demoReason = "HARAKUMO_PROJECT_ID is not configured on the server.";

  return {
    mode: demoReason ? "demo" : "live",
    apiKey,
    projectId,
    baseUrl: process.env.HARAKUMO_URL || undefined,
    operatorToken: operatorToken && operatorToken.length >= 16 ? operatorToken : null,
    metadataDatabaseId: intOrNull(process.env.LAUNCHPAD_DATABASE_ID),
    metadataDatabaseName: process.env.LAUNCHPAD_DATABASE_NAME || "launchpad-meta",
    aiPlanner: process.env.LAUNCHPAD_AI_PLANNER !== "off",
    aiModel: process.env.LAUNCHPAD_AI_MODEL || "harakumo-1",
    demoReason,
  };
}
