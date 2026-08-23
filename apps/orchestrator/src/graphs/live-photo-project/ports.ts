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
    sourceAssetIds: readonly string[];
    coverAssetId: string;
    revision: number;
    effectKey: string;
  }): Promise<ExternalJobReference>;

  ensureRenderJob(input: {
    workflowRunId: string;
    projectId: string;
    selectedOutputId: string;
    effectKey: string;
  }): Promise<ExternalJobReference>;

  markWorkflowCompleted(input: {
    workflowRunId: string;
    projectId: string;
    exportId: string;
    effectKey: string;
  }): Promise<void>;

  markWorkflowCancelled(input: {
    workflowRunId: string;
    projectId: string;
    effectKey: string;
  }): Promise<void>;

  markWorkflowFailed(input: {
    workflowRunId: string;
    projectId: string;
    errorCode: string;
    effectKey: string;
  }): Promise<void>;
}

export interface LivePhotoProjectGraphDependencies {
  readonly projects: ProjectReadPort;
  readonly effects: WorkflowEffectPort;
  readonly checkpointer?: object;
}
