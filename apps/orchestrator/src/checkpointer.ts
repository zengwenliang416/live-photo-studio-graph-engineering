import { MemorySaver } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

export async function createProductionCheckpointer(input: {
  connectionString: string;
  setup: boolean;
}): Promise<object> {
  const saver = PostgresSaver.fromConnString(input.connectionString);
  if (input.setup) {
    await saver.setup();
  }
  return saver;
}

export function createMemoryCheckpointer(): object {
  return new MemorySaver();
}
