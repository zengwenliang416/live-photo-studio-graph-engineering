import { safeLogEvent } from "@live-photo-studio/graph-contracts";
import { decryptSecret, encryptSecret } from "@live-photo-studio/graph-runtime";
import type { StylePresetMetadata } from "@live-photo-studio/contracts";
import {
  STYLE_PRESETS,
  compilePrompt,
  findStylePreset,
  type StylePreset,
} from "@live-photo-studio/prompt-kit";
import { ApplicationProblemError } from "../../http/problem-details.js";
import { hashRequest } from "../../projects/application/canonical-json.js";
import {
  IdempotencyConflictError,
  type SettingsStorePort,
  type SettingsTx,
  type UserImageProviderRow,
} from "../ports.js";

export interface UpsertImageProviderBody {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly enabled: boolean;
}

export interface UseCaseResult {
  readonly status: number;
  readonly body: unknown;
}

function conflict(code: string, title: string): ApplicationProblemError {
  return new ApplicationProblemError(409, code, title);
}

function validateReferenceImageCount(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > 6) {
    throw new ApplicationProblemError(
      422,
      "VALIDATION_FAILED",
      "Request validation failed.",
      "referenceImageCount: must be an integer between 1 and 6.",
    );
  }
}

function toStylePresetMetadata(preset: StylePreset): StylePresetMetadata {
  return {
    key: preset.key,
    name: preset.name,
    description: preset.description,
    version: preset.version,
    category: preset.category,
    recommendedFor: preset.recommendedFor,
    recommendedMotion: preset.recommendedMotion,
    colorPalette: preset.colorPalette,
    previewStyle: preset.previewStyle,
    source: preset.source ?? null,
  };
}

/**
 * Application layer for per-user image provider settings. Plaintext API keys
 * are encrypted before they reach the store, are never returned by any
 * response and never appear in logs; reads expose only a masked preview.
 */
export class SettingsService {
  constructor(
    private readonly store: SettingsStorePort,
    private readonly encryptionKeyHex: string | undefined,
  ) {}

  async putImageProvider(params: {
    userId: string;
    idempotencyKey: string;
    body: UpsertImageProviderBody;
  }): Promise<UseCaseResult> {
    if (this.encryptionKeyHex === undefined) {
      throw new ApplicationProblemError(
        503,
        "SETTINGS_ENCRYPTION_NOT_CONFIGURED",
        "Image provider settings are unavailable.",
        "SETTINGS_ENCRYPTION_KEY is not configured.",
      );
    }
    const keyHex = this.encryptionKeyHex;
    return this.executeIdempotently({
      scope: "PUT:/v1/settings/image-provider",
      idempotencyKey: params.idempotencyKey,
      userId: params.userId,
      requestHash: hashRequest(params.body),
      work: async (tx) => {
        const row = await tx.upsertImageProvider({
          userId: params.userId,
          baseUrl: params.body.baseUrl,
          apiKeyCiphertext: encryptSecret(params.body.apiKey, keyHex),
          model: params.body.model,
          enabled: params.body.enabled,
        });
        return {
          status: 200,
          body: {
            data: {
              baseUrl: row.baseUrl,
              model: row.model,
              enabled: row.enabled,
              updatedAt: row.updatedAt,
            },
          },
        };
      },
    });
  }

  async getImageProvider(params: { userId: string }): Promise<UseCaseResult> {
    const row = await this.store.transact((tx) =>
      tx.findImageProviderByUser(params.userId),
    );
    if (!row) {
      return { status: 200, body: { data: { configured: false } } };
    }
    return {
      status: 200,
      body: {
        data: {
          configured: true,
          baseUrl: row.baseUrl,
          model: row.model,
          enabled: row.enabled,
          updatedAt: row.updatedAt,
          keyPreview: this.maskKey(row, params.userId),
        },
      },
    };
  }

  async deleteImageProvider(params: {
    userId: string;
    idempotencyKey: string;
  }): Promise<UseCaseResult> {
    return this.executeIdempotently({
      scope: "DELETE:/v1/settings/image-provider",
      idempotencyKey: params.idempotencyKey,
      userId: params.userId,
      requestHash: hashRequest({ action: "delete-image-provider" }),
      work: async (tx) => {
        await tx.deleteImageProviderByUser(params.userId);
        return { status: 200, body: { data: { configured: false } } };
      },
    });
  }

  listStylePresets(): UseCaseResult {
    return {
      status: 200,
      body: {
        data: {
          items: STYLE_PRESETS.map(toStylePresetMetadata),
        },
      },
    };
  }

  getStylePresetPrompt(params: {
    key: string;
    referenceImageCount: number;
  }): UseCaseResult {
    validateReferenceImageCount(params.referenceImageCount);
    const preset = findStylePreset(params.key);
    if (!preset) {
      throw new ApplicationProblemError(
        404,
        "STYLE_PRESET_NOT_FOUND",
        "Style preset not found.",
      );
    }

    const compiled = compilePrompt({
      preset,
      referenceImageCount: params.referenceImageCount,
    });
    return {
      status: 200,
      body: {
        data: {
          preset: toStylePresetMetadata(preset),
          prompt: compiled.prompt,
          promptVersion: compiled.promptVersion,
          promptHash: compiled.promptHash,
          referenceImageCount: params.referenceImageCount,
        },
      },
    };
  }

  /**
   * Decrypts only to build the last-4 preview. Any failure (missing or wrong
   * key, tampered ciphertext) degrades to a null preview plus a redacted warn
   * log; the ciphertext itself is never logged.
   */
  private maskKey(row: UserImageProviderRow, userId: string): string | null {
    try {
      const plaintext = decryptSecret(
        row.apiKeyCiphertext,
        this.encryptionKeyHex ?? "",
      );
      return `••••${plaintext.slice(-4)}`;
    } catch {
      console.warn(
        JSON.stringify(
          safeLogEvent("settings.key_preview_unavailable", { userId }),
        ),
      );
      return null;
    }
  }

  private async executeIdempotently(params: {
    scope: string;
    idempotencyKey: string;
    userId: string;
    requestHash: string;
    work: (tx: SettingsTx) => Promise<UseCaseResult>;
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
