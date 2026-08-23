import { ApplicationProblemError } from "../../http/problem-details.js";
import type {
  ExportPackageStorePort,
  SignedDownloadPort,
} from "../ports.js";
import { SignedDownloadUnavailableError } from "../ports.js";

export interface ExportPackageUseCaseResult {
  readonly status: number;
  readonly body: unknown;
}

const DEFAULT_SIGNED_DOWNLOAD_TTL_SECONDS = 300;
const CLOCK_SKEW_ALLOWANCE_MS = 30_000;

function notFound(code: string, detail: string): ApplicationProblemError {
  return new ApplicationProblemError(404, code, "Resource not found.", detail);
}

function forbidden(detail: string): ApplicationProblemError {
  return new ApplicationProblemError(
    403,
    "PROJECT_ACCESS_DENIED",
    "Project access denied.",
    detail,
  );
}

export class ExportPackageService {
  constructor(
    private readonly store: ExportPackageStorePort,
    private readonly signer: SignedDownloadPort,
    private readonly signedDownloadTtlSeconds = DEFAULT_SIGNED_DOWNLOAD_TTL_SECONDS,
  ) {}

  async getLatestDownload(params: {
    readonly projectId: string;
    readonly userId: string;
  }): Promise<ExportPackageUseCaseResult> {
    const ownerId = await this.store.getProjectOwnerId(params.projectId);
    if (!ownerId) {
      throw notFound(
        "PROJECT_NOT_FOUND",
        `Project ${params.projectId} was not found.`,
      );
    }
    if (ownerId !== params.userId) {
      throw forbidden("The caller does not own this project.");
    }

    const exportPackage = await this.store.findLatest(params.projectId);
    if (!exportPackage) {
      throw notFound(
        "EXPORT_PACKAGE_NOT_FOUND",
        `No export package exists for project ${params.projectId}.`,
      );
    }

    let signedDownload;
    try {
      signedDownload = await this.signer.createSignedDownload({
        exportPackageId: exportPackage.id,
        projectId: exportPackage.projectId,
        objectKey: exportPackage.objectKey,
        expiresInSeconds: this.signedDownloadTtlSeconds,
      });
    } catch (error: unknown) {
      if (error instanceof SignedDownloadUnavailableError) {
        throw new ApplicationProblemError(
          503,
          "SIGNED_DOWNLOAD_UNAVAILABLE",
          "Signed download is not available.",
          "An object storage signing adapter must be configured before downloads can be served.",
        );
      }
      throw error;
    }

    const expiresAtMs = Date.parse(signedDownload.expiresAt);
    const maxExpiresAtMs =
      Date.now() +
      (this.signedDownloadTtlSeconds * 1000 + CLOCK_SKEW_ALLOWANCE_MS);
    if (
      signedDownload.url.trim().length === 0 ||
      !Number.isFinite(expiresAtMs) ||
      expiresAtMs <= Date.now() ||
      expiresAtMs > maxExpiresAtMs
    ) {
      throw new ApplicationProblemError(
        503,
        "SIGNED_DOWNLOAD_INVALID",
        "Signed download is not available.",
        "The signing adapter returned an invalid or long-lived download grant.",
      );
    }

    return {
      status: 200,
      body: {
        data: {
          exportPackageId: exportPackage.id,
          projectId: exportPackage.projectId,
          downloadUrl: signedDownload.url,
          expiresAt: signedDownload.expiresAt,
          sha256: exportPackage.sha256,
          durationMs: exportPackage.durationMs,
          bytes: exportPackage.bytes,
        },
      },
    };
  }
}
