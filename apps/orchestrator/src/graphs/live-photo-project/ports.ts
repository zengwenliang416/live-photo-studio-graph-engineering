export interface ProjectSnapshot {
  readonly projectId: string;
  readonly userId: string;
  readonly sourceAssetIds: readonly string[];
  readonly coverAssetId: string;
}

export interface ProjectReadPort {
  getProjectSnapshot(projectId: string, userId: string): Promise<ProjectSnapshot>;
}

export interface ExternalJobReference {
  readonly jobId: string;
}

export interface WorkflowEffectPort {
  ensureGenerationBatch(input: {
    workflowRunId: string;
    projectId: string;
    traceId?: string | undefined;
    sourceAssetIds: readonly string[];
    coverAssetId: string;
    revision: number;
    effectKey: string;
  }): Promise<ExternalJobReference>;

  ensureRenderJob(input: {
    workflowRunId: string;
    projectId: string;
    traceId?: string | undefined;
    selectedOutputId: string;
    effectKey: string;
  }): Promise<ExternalJobReference>;

  markWorkflowCompleted(input: {
    workflowRunId: string;
    projectId: string;
    traceId?: string | undefined;
    exportId: string;
    effectKey: string;
  }): Promise<void>;

  markWorkflowCancelled(input: {
    workflowRunId: string;
    projectId: string;
    traceId?: string | undefined;
    effectKey: string;
  }): Promise<void>;

  markWorkflowFailed(input: {
    workflowRunId: string;
    projectId: string;
    traceId?: string | undefined;
    errorCode: string;
    effectKey: string;
  }): Promise<void>;
}

export interface LivePhotoProjectGraphDependencies {
  readonly projects: ProjectReadPort;
  readonly effects: WorkflowEffectPort;
  readonly maxRepairAttempts?: number;
  readonly checkpointer?: object;
}
