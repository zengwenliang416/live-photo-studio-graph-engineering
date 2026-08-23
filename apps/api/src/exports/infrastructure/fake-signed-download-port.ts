import type {
  SignedDownload,
  SignedDownloadPort,
  SignedDownloadRequest,
} from "../ports.js";
import { SignedDownloadUnavailableError } from "../ports.js";

/**
 * The current media worker records object keys but does not wire an object
 * storage signer. Fail closed until a real short-lived signing adapter is
 * supplied; never turn the persisted object key into a public URL.
 */

export class FakeSignedDownloadPort implements SignedDownloadPort {
  async createSignedDownload(
    _input: SignedDownloadRequest,
  ): Promise<SignedDownload> {
    throw new SignedDownloadUnavailableError();
  }
}
