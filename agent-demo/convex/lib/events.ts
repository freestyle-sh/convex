import { z } from "zod";

export const eventSchema = z.object({
  eventId: z.string(),
  timestamp: z.number(),
  level: z.string(),
  functionPath: z.string(),
  message: z.string(),
  source: z.string(),
});
export type LogEvent = z.infer<typeof eventSchema>;
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown) =>
  typeof value === "string" ? value : (JSON.stringify(value) ?? "");

// Defense in depth for common accidental credentials; logs must still be treated as sensitive data.
export function redact(value: string, limit = 4000): string {
  return value
    .replace(/\b(?:Bearer|Convex)\s+[^\s"',}]+/gi, "[credential redacted]")
    .replace(/\b(?:sk|fs)_[A-Za-z0-9_-]{16,}\b/g, "[credential redacted]")
    .replace(/\b(sk-[A-Za-z0-9_-]{16,})\b/g, "[credential redacted]")
    .replace(
      /((?:password|secret|api[_-]?key|token)\s*["']?\s*[:=]\s*["']?)[^\s"',}]+/gi,
      "$1[redacted]",
    )
    .slice(0, limit);
}
export async function digest(value: string) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export async function verifySignature(
  body: string,
  signature: string | null,
  secret: string,
) {
  if (!signature || !/^sha256=[a-f0-9]{64}$/.test(signature)) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const bytes = Uint8Array.from(signature.slice(7).match(/../g)!, (h) =>
    parseInt(h, 16),
  );
  return crypto.subtle.verify(
    "HMAC",
    key,
    bytes,
    new TextEncoder().encode(body),
  );
}
export async function normalizeEvent(
  raw: unknown,
  source: "poll" | "webhook",
): Promise<LogEvent> {
  const e = record(raw),
    fn = record(e.function);
  const timestamp = Number(e.timestamp);
  if (!Number.isFinite(timestamp) || timestamp < 0)
    throw new Error("Invalid event timestamp.");
  // CLI stream timestamps are seconds; log-stream webhook timestamps are milliseconds.
  const at = source === "poll" ? timestamp * 1000 : timestamp;
  const message =
    source === "poll"
      ? text(e.error ?? e.logLines ?? "Function completed")
      : text(e.message ?? e.error_message ?? e.error ?? e);
  const level =
    e.error ||
    e.error_message ||
    e.status === "error" ||
    e.status === "failure" ||
    e.success === false
      ? "error"
      : text(e.log_level ?? e.level ?? "info").toLowerCase();
  return {
    eventId: await digest(JSON.stringify(raw)),
    timestamp: at,
    level,
    functionPath: text(fn.path ?? e.identifier ?? e.topic ?? "unknown").slice(
      0,
      200,
    ),
    message: redact(message),
    source,
  };
}
export async function boundedBody(
  request: Request,
  maxBytes = 262_144,
): Promise<string> {
  if (Number(request.headers.get("content-length")) > maxBytes)
    throw new Error("Body too large.");
  if (!request.body) throw new Error("Missing body.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxBytes) throw new Error("Body too large.");
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
