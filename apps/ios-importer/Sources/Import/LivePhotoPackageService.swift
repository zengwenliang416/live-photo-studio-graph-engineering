import AVFoundation
import CryptoKit
import Foundation
import ImageIO
import UniformTypeIdentifiers
import ZIPFoundation

struct LivePhotoPackageService: Sendable {
  private static let requiredEntries = Set([
    "cover.jpg",
    "motion.mov",
    "manifest.json",
  ])
  private static let maximumPackageBytes: Int64 = 50 * 1024 * 1024
  private static let maximumCoverBytes: UInt32 = 25 * 1024 * 1024
  private static let maximumMotionBytes: UInt32 = 25 * 1024 * 1024
  private static let maximumManifestBytes: UInt32 = 64 * 1024

  func preparePackage(at packageURL: URL) async throws -> PreparedLivePhoto {
    let values = try packageURL.resourceValues(forKeys: [.fileSizeKey])
    guard let packageBytes = values.fileSize.map(Int64.init),
          packageBytes <= Self.maximumPackageBytes
    else {
      throw LivePhotoImportError.packageTooLarge
    }

    let workspaceURL = FileManager.default.temporaryDirectory
      .appendingPathComponent("live-photo-import-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(
      at: workspaceURL,
      withIntermediateDirectories: true
    )

    do {
      let extracted = try extractPackage(packageURL, to: workspaceURL)
      let manifest = try decodeManifest(at: extracted.manifestURL)
      try validateManifest(manifest)
      try validateHashes(
        manifest: manifest,
        coverURL: extracted.coverURL,
        motionURL: extracted.motionURL
      )
      let assetIdentifier = try await readAssetIdentifier(from: extracted.motionURL)
      let pairedCoverURL = workspaceURL.appendingPathComponent("paired-cover.jpg")
      try writeAssetIdentifier(
        assetIdentifier,
        sourceURL: extracted.coverURL,
        destinationURL: pairedCoverURL
      )
      guard try readCoverAssetIdentifier(from: pairedCoverURL) == assetIdentifier else {
        throw LivePhotoImportError.coverMetadataWriteFailed
      }
      return PreparedLivePhoto(
        workspaceURL: workspaceURL,
        coverURL: pairedCoverURL,
        motionURL: extracted.motionURL,
        manifest: manifest,
        assetIdentifier: assetIdentifier
      )
    } catch {
      try? FileManager.default.removeItem(at: workspaceURL)
      throw error
    }
  }

  func removePreparedPackage(_ package: PreparedLivePhoto?) {
    guard let package else { return }
    try? FileManager.default.removeItem(at: package.workspaceURL)
  }

  private func extractPackage(
    _ packageURL: URL,
    to workspaceURL: URL
  ) throws -> (coverURL: URL, motionURL: URL, manifestURL: URL) {
    let archive: Archive
    do {
      archive = try Archive(url: packageURL, accessMode: .read)
    } catch {
      throw LivePhotoImportError.packageUnreadable
    }

    let entries = Array(archive)
    guard entries.count == Self.requiredEntries.count,
          Set(entries.map(\.path)) == Self.requiredEntries,
          entries.allSatisfy({ $0.type == .file })
    else {
      throw LivePhotoImportError.packageEntriesInvalid
    }

    for entry in entries {
      let maximumBytes: UInt32
      switch entry.path {
      case "cover.jpg":
        maximumBytes = Self.maximumCoverBytes
      case "motion.mov":
        maximumBytes = Self.maximumMotionBytes
      case "manifest.json":
        maximumBytes = Self.maximumManifestBytes
      default:
        throw LivePhotoImportError.packageEntriesInvalid
      }
      guard entry.uncompressedSize <= maximumBytes else {
        throw LivePhotoImportError.entryTooLarge(entry.path)
      }
      _ = try archive.extract(
        entry,
        to: workspaceURL.appendingPathComponent(entry.path)
      )
    }

    return (
      workspaceURL.appendingPathComponent("cover.jpg"),
      workspaceURL.appendingPathComponent("motion.mov"),
      workspaceURL.appendingPathComponent("manifest.json")
    )
  }

  private func decodeManifest(at url: URL) throws -> LivePhotoExportManifest {
    do {
      let data = try Data(contentsOf: url, options: [.mappedIfSafe])
      return try JSONDecoder().decode(LivePhotoExportManifest.self, from: data)
    } catch {
      throw LivePhotoImportError.manifestInvalid
    }
  }

  private func validateManifest(_ manifest: LivePhotoExportManifest) throws {
    guard manifest.schemaVersion == "1",
          manifest.recipeVersion == "cover-replacement.v3",
          manifest.entries.count == Self.requiredEntries.count,
          Set(manifest.entries) == Self.requiredEntries
    else {
      throw LivePhotoImportError.unsupportedRecipe
    }
    guard manifest.motionPassthrough else {
      throw LivePhotoImportError.motionWasNotPreserved
    }
  }

  private func validateHashes(
    manifest: LivePhotoExportManifest,
    coverURL: URL,
    motionURL: URL
  ) throws {
    guard try sha256Hex(of: coverURL) == manifest.coverSha256 else {
      throw LivePhotoImportError.coverHashMismatch
    }
    guard try sha256Hex(of: motionURL) == manifest.motionSha256 else {
      throw LivePhotoImportError.motionHashMismatch
    }
  }

  private func sha256Hex(of url: URL) throws -> String {
    let handle = try FileHandle(forReadingFrom: url)
    defer { try? handle.close() }
    var hasher = SHA256()
    while autoreleasepool(invoking: {
      let data = try? handle.read(upToCount: 1024 * 1024)
      guard let data, !data.isEmpty else { return false }
      hasher.update(data: data)
      return true
    }) {}
    return hasher.finalize().map { String(format: "%02x", $0) }.joined()
  }

  func readAssetIdentifier(from motionURL: URL) async throws -> String {
    let asset = AVURLAsset(url: motionURL)
    let formats = try await asset.load(.availableMetadataFormats)
    for format in formats {
      let items = try await asset.loadMetadata(for: format)
      for item in items where item.identifier == .quickTimeMetadataContentIdentifier {
        if let value = try await item.load(.stringValue), !value.isEmpty {
          return value
        }
      }
    }
    throw LivePhotoImportError.motionIdentifierMissing
  }

  func writeAssetIdentifier(
    _ assetIdentifier: String,
    sourceURL: URL,
    destinationURL: URL
  ) throws {
    guard
      let source = CGImageSourceCreateWithURL(sourceURL as CFURL, nil),
      CGImageSourceGetCount(source) == 1,
      let type = CGImageSourceGetType(source),
      UTType(type as String)?.conforms(to: .jpeg) == true,
      let destination = CGImageDestinationCreateWithURL(
        destinationURL as CFURL,
        UTType.jpeg.identifier as CFString,
        1,
        nil
      )
    else {
      throw LivePhotoImportError.coverMetadataWriteFailed
    }

    var properties =
      CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any] ?? [:]
    var makerApple =
      properties[kCGImagePropertyMakerAppleDictionary] as? [String: Any] ?? [:]
    makerApple["17"] = assetIdentifier
    properties[kCGImagePropertyMakerAppleDictionary] = makerApple
    CGImageDestinationAddImageFromSource(destination, source, 0, properties as CFDictionary)
    guard CGImageDestinationFinalize(destination) else {
      throw LivePhotoImportError.coverMetadataWriteFailed
    }
  }

  func readCoverAssetIdentifier(from coverURL: URL) throws -> String? {
    guard
      let source = CGImageSourceCreateWithURL(coverURL as CFURL, nil),
      let properties =
        CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
      let makerApple =
        properties[kCGImagePropertyMakerAppleDictionary] as? [String: Any]
    else {
      throw LivePhotoImportError.coverMetadataWriteFailed
    }
    return makerApple["17"] as? String
  }
}
