type LogLevel = "info" | "warn" | "error";

type SafeLogFields = {
  event: string;
  level?: LogLevel;
  area?: string;
  requestId?: string | null;
  reason?: string | null;
  orderId?: number | null;
  stripeEventId?: string | null;
  itemType?: string | null;
  itemId?: number | null;
  status?: string | null;
  durationMs?: number | null;
  count?: number | null;
  checkoutReused?: boolean | null;
};

const SECRET_PATTERNS = [
  /sk_(live|test)_[A-Za-z0-9_]+/g,
  /pk_(live|test)_[A-Za-z0-9_]+/g,
  /whsec_[A-Za-z0-9_]+/g,
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
];

export function requestIdFromHeaders(headers: Headers): string | null {
  return headers.get("x-vercel-id") ?? headers.get("x-request-id") ?? null;
}

export function sanitizeLogText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  let text = value instanceof Error ? value.message : String(value);
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, "[redacted]");
  }
  return text.length > 240 ? `${text.slice(0, 237)}...` : text;
}

export function safeErrorReason(error: unknown, fallback = "operation failed"): string {
  return sanitizeLogText(error) ?? fallback;
}

export function logEvent(fields: SafeLogFields): void {
  const level = fields.level ?? "info";
  const payload: Record<string, string | number | boolean> = {
    level,
    event: fields.event,
    timestamp: new Date().toISOString(),
  };

  const assignText = (key: string, value: string | null | undefined) => {
    const sanitized = sanitizeLogText(value);
    if (sanitized) payload[key] = sanitized;
  };
  const assignNumber = (key: string, value: number | null | undefined) => {
    if (typeof value === "number" && Number.isFinite(value)) payload[key] = value;
  };
  const assignBoolean = (key: string, value: boolean | null | undefined) => {
    if (typeof value === "boolean") payload[key] = value;
  };

  assignText("area", fields.area);
  assignText("requestId", fields.requestId);
  assignText("reason", fields.reason);
  assignText("stripeEventId", fields.stripeEventId);
  assignText("itemType", fields.itemType);
  assignText("status", fields.status);
  assignNumber("orderId", fields.orderId);
  assignNumber("itemId", fields.itemId);
  assignNumber("durationMs", fields.durationMs);
  assignNumber("count", fields.count);
  assignBoolean("checkoutReused", fields.checkoutReused);

  const line = JSON.stringify(payload);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}
