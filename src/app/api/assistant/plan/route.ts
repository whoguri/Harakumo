import { NextRequest } from "next/server";
import { fail, ok, readJson } from "@/lib/http";
import { createPlan } from "@/lib/planner";
import { planRequest } from "@/lib/schemas";
import { getStore } from "@/lib/store";
import { assertSameOrigin, rateLimit } from "@/lib/security";

export const dynamic = "force-dynamic";

/** POST /api/assistant/plan { prompt } — propose a plan. Never provisions anything. */
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    rateLimit(req, "plan", 8, 60_000);
    const { prompt } = await readJson(req, planRequest);
    const plan = await createPlan(prompt);
    await (await getStore()).savePlan(plan);
    return ok({ plan });
  } catch (err) {
    return fail(err, "POST /api/assistant/plan");
  }
}
