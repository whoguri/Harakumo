import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok } from "@/lib/http";
import { getStore } from "@/lib/store";
import { rateLimit } from "@/lib/security";

export const dynamic = "force-dynamic";

/** GET /api/operations?limit=25 — the provisioning activity log, newest first. */
export async function GET(req: NextRequest) {
  try {
    rateLimit(req, "ops", 60, 60_000);
    const limit = z.coerce.number().int().min(1).max(100).catch(25).parse(req.nextUrl.searchParams.get("limit") ?? 25);
    const store = await getStore();
    return ok({ store: store.kind, operations: await store.listOperations(limit) });
  } catch (err) {
    return fail(err, "GET /api/operations");
  }
}
