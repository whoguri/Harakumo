import { NextRequest } from "next/server";
import { fail, ok, readJson } from "@/lib/http";
import { AppError } from "@/lib/harakumo";
import { provision, type ProvisionResult } from "@/lib/resources";
import { executeRequest } from "@/lib/schemas";
import { getStore } from "@/lib/store";
import { assertSameOrigin, canExecuteReal, rateLimit } from "@/lib/security";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";

/**
 * POST /api/assistant/execute { planId, approve: true }
 * Runs a stored, previously proposed plan exactly as it was shown (the client
 * cannot change actions after approval). Stops at the first failure.
 */
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    rateLimit(req, "execute", 4, 60_000);
    const { planId } = await readJson(req, executeRequest);
    const store = await getStore();
    const plan = await store.getPlan(planId);
    if (!plan) throw new AppError("plan_not_found", 404, "That plan was not found or has expired. Ask the assistant again.");
    if (plan.status !== "proposed") throw new AppError("plan_already_executed", 409, `This plan is already ${plan.status}.`);
    if (!plan.actions.length) throw new AppError("empty_plan", 400, "This plan has no actions to run.");

    const real = canExecuteReal(req);
    plan.status = "executing";
    await store.savePlan(plan);
    log.info("plan_execute_started", { planId, real, actions: plan.actions.length });

    const results: (ProvisionResult & { actionId: string })[] = [];
    let skipped = 0;
    for (const action of plan.actions) {
      if (results.some((r) => r.error)) { skipped++; continue; }
      results.push({ actionId: action.id, ...(await provision(action.request, { real, planId })) });
    }
    const failed = results.filter((r) => r.error).length;
    plan.status = failed === 0 ? "executed" : failed === results.length && results.length === 1 ? "failed" : "partial";
    await store.savePlan(plan);
    log.info("plan_execute_finished", { planId, status: plan.status, failed, skipped });
    return ok({ plan, execution: real ? "real" : "simulated", results, skipped });
  } catch (err) {
    return fail(err, "POST /api/assistant/execute");
  }
}
