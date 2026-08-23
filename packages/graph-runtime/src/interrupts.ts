export interface GraphInterruptRecord {
  readonly value: unknown;
}

export function extractInterruptPayloads(result: object): readonly unknown[] {
  const record = result as Record<string, unknown>;
  const raw = record["__interrupt__"];
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.flatMap((entry) => {
    if (entry !== null && typeof entry === "object" && "value" in entry) {
      return [(entry as GraphInterruptRecord).value];
    }
    return [entry];
  });
}
