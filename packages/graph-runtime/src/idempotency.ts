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
