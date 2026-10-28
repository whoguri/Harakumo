import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok } from "@/lib/http";
import { getResource } from "@/lib/resources";
import { RESOURCE_TYPES } from "@/lib/schemas";
import { rateLimit } from "@/lib/security";

export const dynamic = "force-dynamic";

const params = z.object({ type: z.enum(RESOURCE_TYPES), id: z.coerce.number().int().positive() });

/** GET /api/resources/:type/:id — fresh status and details for one resource. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ type: string; id: string }> }) {
  try {
    rateLimit(req, "detail", 60, 60_000);
    const { type, id } = params.parse(await ctx.params);
    return ok({ resource: await getResource(type, id) });
  } catch (err) {
    return fail(err, "GET /api/resources/:type/:id");
  }
}
