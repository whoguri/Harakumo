import { NextRequest } from "next/server";
import { getConfig } from "@/lib/config";
import { fail, ok, readJson } from "@/lib/http";
import { AppError } from "@/lib/harakumo";
import { getStore } from "@/lib/store";
import { sessionRequest, type SessionInfo } from "@/lib/schemas";
import { assertSameOrigin, canExecuteReal, checkOperatorToken, isOperator, OPERATOR_COOKIE, rateLimit } from "@/lib/security";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";

/** GET /api/session — what this visitor may do. */
export async function GET(req: NextRequest) {
  try {
    const cfg = getConfig();
    const store = await getStore();
    const body: SessionInfo = {
      mode: cfg.mode,
      demoReason: cfg.demoReason,
      projectId: cfg.projectId,
      operator: isOperator(req),
      operatorConfigured: !!cfg.operatorToken,
      canExecute: canExecuteReal(req),
      store: store.kind,
      storeDetail: store.detail,
      aiPlanner: cfg.mode === "live" && cfg.aiPlanner,
    };
    return ok(body);
  } catch (err) {
    return fail(err, "GET /api/session");
  }
}

/** POST /api/session { token } — unlock real provisioning with LAUNCHPAD_OPERATOR_TOKEN. */
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    rateLimit(req, "session", 5, 60_000);
    const { token } = await readJson(req, sessionRequest);
    const value = checkOperatorToken(token);
    if (!value) {
      log.warn("operator_login_failed");
      throw new AppError("invalid_token", 401, "That operator token is not valid.");
    }
    const res = ok({ operator: true });
    res.cookies.set(OPERATOR_COOKIE, value, {
      httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 8,
    });
    return res;
  } catch (err) {
    return fail(err, "POST /api/session");
  }
}

/** DELETE /api/session — sign the operator out. */
export async function DELETE(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const res = ok({ operator: false });
    res.cookies.delete(OPERATOR_COOKIE);
    return res;
  } catch (err) {
    return fail(err, "DELETE /api/session");
  }
}
