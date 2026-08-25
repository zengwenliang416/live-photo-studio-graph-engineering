import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ApplicationProblemError } from "../../http/problem-details.js";
import { hashRequest } from "./canonical-json.js";
import {
  IdempotencyConflictError,
  encodeProjectCursor,
  type ProjectCursor,
  type ProjectStorePort,
  type ProjectTx,
} from "../ports.js";

export interface CreateProjectBody {
  readonly title: string;
}

export interface UseCaseResult {
  readonly status: number;
  readonly body: unknown;
}

const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 50;

const cursorPayloadSchema = z.object({
  createdAt: z.string().min(1),
  id: z.string().uuid(),
});

function conflict(code: string, title: string): ApplicationProblemError {
  return new ApplicationProblemError(409, code, title);
}

function decodeProjectCursor(raw: string): ProjectCursor {
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw new ApplicationProblemError(
      422,
      "VALIDATION_FAILED",
      "Request validation failed.",
      "cursor is not a valid pagination cursor.",
    );
  }
  const parsed = cursorPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ApplicationProblemError(
      422,
      "VALIDATION_FAILED",
      "Request validation failed.",
      "cursor is not a valid pagination cursor.",
    );
  }
  return parsed.data;
}

/**
 * Application layer for the projects command/query boundary. Writes and their
 * idempotency records commit in the same transaction; reads stay scoped to
 * the authenticated user and never leak cross-user existence.
 */
export class ProjectService {
  constructor(private readonly store: ProjectStorePort) {}

  async createProject(params: {
    userId: string;
    idempotencyKey: string;
    body: CreateProjectBody;
  }): Promise<UseCaseResult> {
    return this.executeIdempotently({
      scope: "POST:/v1/projects",
      idempotencyKey: params.idempotencyKey,
      userId: params.userId,
      requestHash: hashRequest(params.body),
      work: async (tx) => {
        const project = await tx.insertProject({
          id: randomUUID(),
          userId: params.userId,
          title: params.body.title,
        });
        return {
          status: 201,
          body: {
            data: {
              projectId: project.id,
              title: project.title,
              createdAt: project.createdAt,
            },
          },
        };
      },
    });
  }

  async listProjects(params: {
    userId: string;
    limit?: number | undefined;
    cursor?: string | undefined;
  }): Promise<UseCaseResult> {
    // Over-large limits are clamped to the hard cap instead of rejected, so a
    // curious client degrades gracefully while the server keeps the ceiling.
    const limit = Math.min(params.limit ?? DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT);
    const cursor =
      params.cursor === undefined ? null : decodeProjectCursor(params.cursor);
    const rows = await this.store.transact((tx) =>
      tx.listProjectsByUser({ userId: params.userId, limit: limit + 1, cursor }),
    );
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : [...rows];
    const last = items[items.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeProjectCursor({ createdAt: last.createdAt, id: last.id })
        : null;
    return {
      status: 200,
      body: {
        data: {
          items: items.map((row) => ({
            projectId: row.id,
            title: row.title,
            createdAt: row.createdAt,
            coverAssetId: row.coverAssetId,
          })),
          nextCursor,
        },
      },
    };
  }

  async getProject(params: {
    projectId: string;
    userId: string;
  }): Promise<UseCaseResult> {
    const { project, assets } = await this.store.transact(async (tx) => {
      const project = await tx.findProjectById(params.projectId);
      // Existence is not leaked: a foreign project answers 404 just like a
      // missing one.
      if (!project || project.userId !== params.userId) {
        throw new ApplicationProblemError(
          404,
          "PROJECT_NOT_FOUND",
          "Resource not found.",
          `Project ${params.projectId} was not found.`,
        );
      }
      const assets = await tx.listAssetsByProject(project.id);
      return { project, assets };
    });
    return {
      status: 200,
      body: {
        data: {
          projectId: project.id,
          title: project.title,
          createdAt: project.createdAt,
          coverAssetId: project.coverAssetId,
          assets: assets.map((asset) => ({
            assetId: asset.id,
            contentType: asset.contentType,
            bytes: asset.bytes,
            status: asset.status,
            createdAt: asset.createdAt,
          })),
        },
      },
    };
  }

  private async executeIdempotently(params: {
    scope: string;
    idempotencyKey: string;
    userId: string;
    requestHash: string;
    work: (tx: ProjectTx) => Promise<UseCaseResult>;
  }): Promise<UseCaseResult> {
    const attempt = (): Promise<UseCaseResult> =>
      this.store.transact(async (tx) => {
        const existing = await tx.findIdempotentResponse(
          params.scope,
          params.idempotencyKey,
          params.userId,
        );
        if (existing) {
          if (existing.requestHash !== params.requestHash) {
            throw conflict(
              "IDEMPOTENCY_KEY_REUSED",
              "The Idempotency-Key was reused with a different request.",
            );
          }
          return {
            status: existing.responseStatus,
            body: existing.responseBody,
          };
        }
        const result = await params.work(tx);
        await tx.recordIdempotentResponse({
          scope: params.scope,
          idempotencyKey: params.idempotencyKey,
          userId: params.userId,
          requestHash: params.requestHash,
          responseStatus: result.status,
          responseBody: result.body,
        });
        return result;
      });
    // A concurrent identical request may win the unique insert; retry once so
    // the loser serves the stored first response instead of a 500.
    try {
      return await attempt();
    } catch (error) {
      if (error instanceof IdempotencyConflictError) {
        return await attempt();
      }
      throw error;
    }
  }
}
