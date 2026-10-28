import { NextRequest } from "next/server";
import { fail, ok, readJson } from "@/lib/http";
import { listResources, provision } from "@/lib/resources";
import { provisionRequest } from "@/lib/schemas";
import { assertSameOrigin, canExecuteReal, rateLimit } from "@/lib/security";

export const dynamic = "force-dynamic";

/** GET /api/resources — every resource in the Launchpad's Harakumo project (sanitized). */
export async function GET(req: NextRequest) {
  try {
    rateLimit(req, "list", 60, 60_000);
    return ok(await listResources());
  } catch (err) {
    return fail(err, "GET /api/resources");
  }
}

/**
 * POST /api/resources { type, name, config } — provision one resource.
 * Operators get a real Harakumo call; everyone else gets a labelled simulation.
 */
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    rateLimit(req, "provision", 6, 60_000);
    const body = await readJson(req, provisionRequest);
    const result = await provision(body, { real: canExecuteReal(req) });
    const status = result.error ? (result.error.code === "rate_limited" ? 429 : 502) : result.operation.execution === "real" ? 201 : 200;
    return ok(result, { status });
  } catch (err) {
    return fail(err, "POST /api/resources");
  }
}
