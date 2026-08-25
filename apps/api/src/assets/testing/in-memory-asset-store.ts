import { ApplicationProblemError } from "../../http/problem-details.js";
import {
  IdempotencyConflictError,
  type AssetRow,
  type AssetStorePort,
  type AssetTx,
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
 * Mirrors the SQL semantics the application service relies on: per-user
 * project ownership, UPLOADING-only status transitions and unique idempotency
 * records.
 */
export class InMemoryAssetStore implements AssetStorePort {
  readonly projectOwners = new Map<string, string>();
  readonly assets = new Map<string, AssetRow>();
  readonly roles = new Map<string, Set<string>>();
  readonly covers = new Map<string, string>();
  readonly idempotency = new Map<string, StoredIdempotentResponse>();

  seedProject(projectId: string, userId: string): void {
    this.projectOwners.set(projectId, userId);
  }

  rolesOf(assetId: string): readonly string[] {
    return [...(this.roles.get(assetId) ?? [])].sort();
  }

  async transact<T>(work: (tx: AssetTx) => Promise<T>): Promise<T> {
    return work(this.buildTx());
  }

  private buildTx(): AssetTx {
    const state = this;
    return {
      async assertProjectOwner(projectId, userId): Promise<void> {
        if (state.projectOwners.get(projectId) !== userId) {
          throw new ApplicationProblemError(
            404,
            "PROJECT_NOT_FOUND",
            "Resource not found.",
            `Project ${projectId} was not found.`,
          );
        }
      },
      async insertAsset(input): Promise<void> {
        const row: AssetRow = {
          id: input.id,
          projectId: input.projectId,
          userId: input.userId,
          objectKey: input.objectKey,
          contentType: input.contentType,
          declaredBytes: input.declaredBytes,
          bytes: null,
          sha256: null,
          status: "UPLOADING",
          createdAt: new Date().toISOString(),
        };
        state.assets.set(row.id, row);
      },
      async findAssetById(assetId) {
        return state.assets.get(assetId) ?? null;
      },
      async markAssetReady(assetId, bytes, sha256): Promise<boolean> {
        const row = state.assets.get(assetId);
        if (!row || row.status !== "UPLOADING") return false;
        state.assets.set(assetId, { ...row, status: "READY", bytes, sha256 });
        const roles = state.roles.get(assetId) ?? new Set<string>();
        roles.add("CONTENT");
        state.roles.set(assetId, roles);
        return true;
      },
      async markAssetRejected(assetId): Promise<void> {
        const row = state.assets.get(assetId);
        if (!row || row.status !== "UPLOADING") return;
        state.assets.set(assetId, { ...row, status: "REJECTED" });
      },
      async setProjectCover(projectId, assetId): Promise<void> {
        state.covers.set(projectId, assetId);
        const roles = state.roles.get(assetId) ?? new Set<string>();
        roles.add("COVER");
        state.roles.set(assetId, roles);
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
