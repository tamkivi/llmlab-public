import "server-only";
import { isIP } from "node:net";
import { getAdapter, initDb } from "@/lib/db";

const MAX_IP_HEADER_LENGTH = 200;
const TRUSTED_SINGLE_IP_HEADERS = [
  "x-vercel-forwarded-for",
  "x-real-ip",
  "cf-connecting-ip",
  "true-client-ip",
  "fly-client-ip",
  "x-client-ip",
] as const;

/**
 * Normalizes one already-selected IP candidate. This intentionally rejects
 * forwarded chains; callers that understand their proxy boundary should pick
 * the candidate first and then pass it here.
 */
export function sanitizeIpAddress(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  if (raw.length > MAX_IP_HEADER_LENGTH) return undefined;
  let value = raw.trim();
  if (!value || value.includes(",")) return undefined;
  if (value.startsWith("[") && value.endsWith("]")) {
    value = value.slice(1, -1);
  }
  if (value.toLowerCase().startsWith("::ffff:")) {
    const mapped = value.slice("::ffff:".length);
    return isIP(mapped) === 4 ? mapped : undefined;
  }
  const family = isIP(value);
  if (family === 4) return value;
  if (family === 6) return value.toLowerCase();
  return undefined;
}

function isHostedDeployment(env: NodeJS.ProcessEnv): boolean {
  return env.VERCEL === "1" || Boolean(env.VERCEL_ENV);
}

function isNonProduction(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV !== "production";
}

function firstForwardedForCandidate(raw: string | null): string | undefined {
  if (!raw || raw.length > MAX_IP_HEADER_LENGTH) return undefined;
  const first = raw.split(",")[0]?.trim();
  return sanitizeIpAddress(first);
}

/**
 * Derives the client IP used for throttling/audit fields.
 *
 * Trust boundary: Vercel terminates the public connection before these route
 * handlers. In hosted deployments we prefer single platform-provided IP
 * headers and only then the first X-Forwarded-For hop. Outside that boundary,
 * production does not trust client-supplied forwarding chains; callers should
 * fall back to a shared bucket so protections remain active.
 */
export function clientIpFromHeaders(headers: Headers, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (isHostedDeployment(env) || isNonProduction(env)) {
    for (const header of TRUSTED_SINGLE_IP_HEADERS) {
      const value = headers.get(header);
      const normalized = sanitizeIpAddress(value);
      if (normalized) return normalized;
    }
  }

  const forwardedFor = headers.get("x-forwarded-for");
  if (isHostedDeployment(env)) {
    return firstForwardedForCandidate(forwardedFor);
  }

  if (isNonProduction(env) && forwardedFor && !forwardedFor.includes(",")) {
    return sanitizeIpAddress(forwardedFor);
  }

  return undefined;
}

export function clientRateLimitKey(request: Request, scope: string, env: NodeJS.ProcessEnv = process.env): string {
  const cleanScope = scope.trim() || "request";
  return `${cleanScope}:ip:${clientIpFromHeaders(request.headers, env) ?? "unknown"}`;
}

function resolveAppOrigin(): string | null {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  const vercelUrl = process.env.VERCEL_URL
    ? process.env.VERCEL_URL.startsWith("http")
      ? process.env.VERCEL_URL
      : `https://${process.env.VERCEL_URL}`
    : null;
  const expected = appUrl ?? vercelUrl;
  if (!expected) return null;

  try {
    return new URL(expected).origin;
  } catch {
    return null;
  }
}

export function requestOriginIsAllowed(request: Request): boolean {
  const originHeader = request.headers.get("origin");
  if (!originHeader) return true;

  const expectedOrigin = resolveAppOrigin();
  if (!expectedOrigin) return true;

  try {
    return new URL(originHeader).origin === expectedOrigin;
  } catch {
    return false;
  }
}

const rateLimitStore = new Map<string, { count: number; resetAt: number }>();
let lastSweep = Date.now();
let lastDbSweep = 0;

function sweepExpired() {
  const now = Date.now();
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, entry] of rateLimitStore) {
    if (now > entry.resetAt) rateLimitStore.delete(key);
  }
}

function checkMemoryRateLimit(key: string, limit: number, windowMs: number): boolean {
  sweepExpired();
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  if (!entry || now > entry.resetAt) {
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (entry.count >= limit) {
    return false;
  }

  entry.count++;
  return true;
}

export async function checkRateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
  const cleanKey = key.trim();
  if (!cleanKey || limit <= 0 || windowMs <= 0) return false;

  try {
    await initDb();
    const db = getAdapter();
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const resetAtIso = new Date(now + windowMs).toISOString();

    if (now - lastDbSweep > 60_000) {
      lastDbSweep = now;
      await db.execute("DELETE FROM rate_limits WHERE reset_at <= ?", [nowIso]).catch(() => 0);
    }

    await db.execute(
      `INSERT INTO rate_limits (rate_key, request_count, reset_at, updated_at)
       VALUES (?, 1, ?, ?)
       ON CONFLICT(rate_key) DO UPDATE SET
         request_count = CASE WHEN rate_limits.reset_at <= ? THEN 1 ELSE rate_limits.request_count + 1 END,
         reset_at = CASE WHEN rate_limits.reset_at <= ? THEN excluded.reset_at ELSE rate_limits.reset_at END,
         updated_at = excluded.updated_at`,
      [cleanKey, resetAtIso, nowIso, nowIso, nowIso],
    );

    const row = await db.queryOne<{ request_count: number; reset_at: string }>(
      "SELECT request_count, reset_at FROM rate_limits WHERE rate_key = ? LIMIT 1",
      [cleanKey],
    );
    return Boolean(row && row.reset_at > nowIso && row.request_count <= limit);
  } catch {
    if (process.env.NODE_ENV === "production") return false;
    return checkMemoryRateLimit(cleanKey, limit, windowMs);
  }
}

export async function readJsonBodyWithLimit<T>(
  request: Request,
  maxBytes: number,
): Promise<{ ok: true; data: T } | { ok: false; status: number; message: string }> {
  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const parsedLength = Number.parseInt(contentLength, 10);
    if (Number.isFinite(parsedLength) && parsedLength > maxBytes) {
      return { ok: false, status: 413, message: "Request body is too large." };
    }
  }

  if (!request.body) {
    return { ok: false, status: 400, message: "Invalid JSON request body." };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, status: 413, message: "Request body is too large." };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  try {
    const raw = new TextDecoder().decode(Buffer.concat(chunks));
    return { ok: true, data: JSON.parse(raw) as T };
  } catch {
    return { ok: false, status: 400, message: "Invalid JSON request body." };
  }
}
