import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { requireAuth } from "@/lib/server/auth-helpers";

function secureCompare(left: string, right: string): boolean {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

function hasValidAdminBearer(request: Request): boolean {
  const token = process.env.ADMIN_API_TOKEN;
  if (!token) return false;

  const authorization = request.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  if (!authorization.startsWith(prefix)) return false;

  return secureCompare(authorization.slice(prefix.length), token);
}

export async function requireAdminAccess(request: Request): Promise<{ ok: true; actor: "session" | "bearer"; userId?: number } | { ok: false; status: 401 | 403 }> {
  if (hasValidAdminBearer(request)) {
    return { ok: true, actor: "bearer" };
  }

  const auth = await requireAuth().catch(() => null);
  if (!auth) return { ok: false, status: 401 };
  if (auth.user.role !== "ADMIN") return { ok: false, status: 403 };

  return { ok: true, actor: "session", userId: auth.user.id };
}

export function requireAdminBearerAccess(request: Request): { ok: true } | { ok: false; status: 401 | 403 } {
  if (!process.env.ADMIN_API_TOKEN) {
    return { ok: false, status: 403 };
  }
  return hasValidAdminBearer(request) ? { ok: true } : { ok: false, status: 401 };
}
