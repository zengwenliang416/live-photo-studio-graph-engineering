export interface CompiledWorkflowGraph<TInput extends object = object> {
  invoke(
    input: TInput | object,
    config: { configurable: { thread_id: string } },
  ): Promise<object>;
}

export type GraphFactory = () => Promise<CompiledWorkflowGraph> | CompiledWorkflowGraph;

export class GraphRegistry {
  private readonly factories = new Map<string, GraphFactory>();

  register(graphKey: string, graphVersion: string, factory: GraphFactory): void {
    const key = this.toRegistryKey(graphKey, graphVersion);
    if (this.factories.has(key)) {
      throw new Error(`Graph ${key} is already registered.`);
    }
    this.factories.set(key, factory);
  }

  async resolve(
    graphKey: string,
    graphVersion: string,
  ): Promise<CompiledWorkflowGraph> {
    const key = this.toRegistryKey(graphKey, graphVersion);
    const factory = this.factories.get(key);
    if (!factory) {
      throw new Error(`Graph ${key} is not registered.`);
    }
    return factory();
  }

  list(): readonly string[] {
    return [...this.factories.keys()].sort();
  }

  private toRegistryKey(graphKey: string, graphVersion: string): string {
    return `${graphKey}:${graphVersion}`;
  }
}
