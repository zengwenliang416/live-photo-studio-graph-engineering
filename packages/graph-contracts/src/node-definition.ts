import { z } from "zod";

export const graphNodeKindSchema = z.enum([
  "PURE",
  "DATABASE",
  "LLM",
  "EXTERNAL_JOB",
  "ROUTER",
  "AGGREGATOR",
  "HUMAN_GATE",
  "COMPENSATION",
]);

export type GraphNodeKind = z.infer<typeof graphNodeKindSchema>;

export const graphNodeDefinitionSchema = z.object({
  name: z.string().min(1),
  version: z.number().int().positive(),
  kind: graphNodeKindSchema,
  reads: z.array(z.string()).readonly(),
  writes: z.array(z.string()).readonly(),
  sideEffect: z.boolean(),
  idempotent: z.boolean(),
  timeoutMs: z.number().int().positive().optional(),
  maxAttempts: z.number().int().positive().optional(),
  compensationNode: z.string().min(1).optional(),
});

export type GraphNodeDefinition = z.infer<typeof graphNodeDefinitionSchema>;

export function defineGraphNode<const T extends GraphNodeDefinition>(
  definition: T,
): T {
  graphNodeDefinitionSchema.parse(definition);
  if (definition.sideEffect && !definition.idempotent) {
    throw new Error(
      `Graph node ${definition.name} has side effects but is not declared idempotent.`,
    );
  }
  return definition;
}
