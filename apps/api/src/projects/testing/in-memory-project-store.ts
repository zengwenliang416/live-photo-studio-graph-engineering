import {
  IdempotencyConflictError,
  type ProjectAssetRow,
  type ProjectLivePhotoPairRow,
  type ProjectRow,
  type ProjectStorePort,
  type ProjectTx,
  type StoredIdempotentResponse,
} from "../ports.js";

function idempotencyRecordKey(
  scope: string,
  idempotencyKey: string,
  userId: string,
): string {
  return `${userId}::${scope}::${idempotencyKey}`;
}

/**
 * Mirrors the SQL semantics the application service relies on:
 * unique idempotency records and (created_at, id) tuple pagination.
 */
export class InMemoryProjectStore implements ProjectStorePort {
  readonly projects = new Map<string, ProjectRow>();
  readonly assets = new Map<string, ProjectAssetRow[]>();
  readonly livePhotoPairs = new Map<string, ProjectLivePhotoPairRow[]>();
  readonly idempotency = new Map<string, StoredIdempotentResponse>();

  seedProject(row: ProjectRow): void {
    this.projects.set(row.id, row);
  }

  seedAsset(projectId: string, row: ProjectAssetRow): void {
    const list = this.assets.get(projectId) ?? [];
    list.push(row);
    this.assets.set(projectId, list);
  }

  seedLivePhotoPair(projectId: string, row: ProjectLivePhotoPairRow): void {
    const list = this.livePhotoPairs.get(projectId) ?? [];
    list.push(row);
    this.livePhotoPairs.set(projectId, list);
  }

  async transact<T>(work: (tx: ProjectTx) => Promise<T>): Promise<T> {
    return work(this.buildTx());
  }

  private buildTx(): ProjectTx {
    const state = this;
    return {
      async insertProject(input): Promise<ProjectRow> {
        const row: ProjectRow = {
          id: input.id,
          userId: input.userId,
          title: input.title,
          coverAssetId: null,
          createdAt: new Date().toISOString(),
        };
        state.projects.set(row.id, row);
        return row;
      },
      async findProjectById(projectId) {
        return state.projects.get(projectId) ?? null;
      },
      async listProjectsByUser({ userId, limit, cursor }) {
        return [...state.projects.values()]
          .filter((row) => row.userId === userId)
          .filter(
            (row) =>
              cursor === null ||
              row.createdAt < cursor.createdAt ||
              (row.createdAt === cursor.createdAt && row.id < cursor.id),
          )
          .sort(
            (left, right) =>
              right.createdAt.localeCompare(left.createdAt) ||
              right.id.localeCompare(left.id),
          )
          .slice(0, limit);
      },
      async listAssetsByProject(projectId) {
        return [...(state.assets.get(projectId) ?? [])].sort((left, right) =>
          left.createdAt.localeCompare(right.createdAt),
        );
      },
      async listLivePhotoPairsByProject(projectId) {
        return [...(state.livePhotoPairs.get(projectId) ?? [])].sort(
          (left, right) =>
            left.createdAt.localeCompare(right.createdAt) ||
            left.id.localeCompare(right.id),
        );
      },
      async findIdempotentResponse(scope, key, userId) {
        return (
          state.idempotency.get(idempotencyRecordKey(scope, key, userId)) ??
          null
        );
      },
      async recordIdempotentResponse(input): Promise<void> {
        const recordKey = idempotencyRecordKey(
          input.scope,
          input.idempotencyKey,
          input.userId,
        );
        if (state.idempotency.has(recordKey)) {
          throw new IdempotencyConflictError();
        }
        state.idempotency.set(recordKey, {
          requestHash: input.requestHash,
          responseStatus: input.responseStatus,
          responseBody: input.responseBody,
        });
      },
    };
  }
}
