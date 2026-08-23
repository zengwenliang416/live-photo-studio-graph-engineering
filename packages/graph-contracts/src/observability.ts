import { z } from "zod";

export const workflowExecutionMetadataSchema = z
  .object({
    traceId: z.string().uuid().optional(),
    nodeName: z.string().min(1).max(120).optional(),
    nodeVersion: z.number().int().positive().optional(),
    externalJobId: z.string().uuid().optional(),
    providerRequestId: z.string().min(1).max(200).optional(),
  })
  .strict();

export type WorkflowExecutionMetadata = z.infer<
  typeof workflowExecutionMetadataSchema
>;

const SENSITIVE_KEY = /authorization|credential|api[-_]?key|secret|password|token|signed[-_]?url|prompt|base64|provider[-_]?response|exif|gps/i;
const SENSITIVE_STRING = [
  /-----BEGIN [^-]+ PRIVATE KEY-----/u,
  /(?:x-amz-signature|x-amz-credential|signature|access_token)=/iu,
  /^[A-Za-z0-9+/]{96,}={0,2}$/u,
];

function isSensitiveString(value: string): boolean {
  return SENSITIVE_STRING.some((pattern) => pattern.test(value));
}

/**
 * Redacts values before structured logging or operator projection. The
 * function deliberately returns plain JSON-compatible data and never exposes
 * binary buffers, signed URLs, prompts or provider response bodies.
 */
export function redactSensitive(value: unknown, key?: string): unknown {
  if (key && SENSITIVE_KEY.test(key)) return "[REDACTED]";
  if (typeof value === "string") {
    return isSensitiveString(value) ? "[REDACTED]" : value;
  }
  if (value instanceof Uint8Array) return "[REDACTED_BINARY]";
  if (Array.isArray(value)) {
    return value.map((entry) => redactSensitive(entry));
  }
  if (value !== null && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
      output[entryKey] = redactSensitive(entryValue, entryKey);
    }
    return output;
  }
  return value;
}

export function safeLogEvent(
  event: string,
  fields: Record<string, unknown> = {},
): Record<string, unknown> {
  return redactSensitive({ event, ...fields }) as Record<string, unknown>;
}
