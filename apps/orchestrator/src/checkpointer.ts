import { MemorySaver } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

export interface DurableCheckpointer {
  /** The LangGraph-compatible checkpointer object. */
  readonly saver: object;
  /** Close the underlying PostgreSQL pool explicitly. */
  end(): Promise<void>;
}

export async function createProductionCheckpointer(input: {
  connectionString: string;
  setup: boolean;
}): Promise<DurableCheckpointer> {
  const saver = PostgresSaver.fromConnString(input.connectionString);
  if (input.setup) {
    await saver.setup();
  }
  return {
    saver,
    end: () => saver.end(),
  };
}

export function createMemoryCheckpointer(): object {
  return new MemorySaver();
}
