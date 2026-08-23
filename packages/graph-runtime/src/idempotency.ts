import { createHash } from "node:crypto";

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stableValue(child)]);
    return Object.fromEntries(entries);
  }
  return value;
}

export function buildNodeEffectKey(input: {
  workflowRunId: string;
  nodeName: string;
  nodeVersion: number;
  revision: number;
  businessInput?: unknown;
}): string {
  const payload = JSON.stringify(
    stableValue({
      workflowRunId: input.workflowRunId,
      nodeName: input.nodeName,
      nodeVersion: input.nodeVersion,
      revision: input.revision,
      businessInput: input.businessInput ?? null,
    }),
  );
  return createHash("sha256").update(payload).digest("hex");
}

export function buildDeterministicUuid(value: string): string {
  const bytes = createHash("sha256").update(value).digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}
