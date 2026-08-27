import AVFoundation
import CoreGraphics
import CryptoKit
import ImageIO
import UniformTypeIdentifiers
import XCTest
import ZIPFoundation
#if SWIFT_PACKAGE
@testable import LivePhotoImporterCore
#else
@testable import LivePhotoImporter
#endif

final class LivePhotoPackageServiceTests: XCTestCase {
  private let service = LivePhotoPackageService()

  func testRejectsArchiveWithUnexpectedEntries() async throws {
    let directory = try makeTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: directory) }
    let packageURL = directory.appendingPathComponent("package.zip")
    try makeArchive(
      at: packageURL,
      entries: ["unexpected.txt": Data("bad".utf8)]
    )

    do {
      _ = try await service.preparePackage(at: packageURL)
      XCTFail("Expected the archive to be rejected.")
    } catch let error as LivePhotoImportError {
      XCTAssertEqual(error, .packageEntriesInvalid)
    }
  }

  func testRejectsInvalidManifestBeforeReadingMedia() async throws {
    let directory = try makeTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: directory) }
    let packageURL = directory.appendingPathComponent("package.zip")
    try makeArchive(
      at: packageURL,
      entries: [
        "cover.jpg": Data([0xFF, 0xD8, 0xFF, 0xD9]),
        "motion.mov": Data("not-a-movie".utf8),
        "manifest.json": Data("{}".utf8),
      ]
    )

    do {
      _ = try await service.preparePackage(at: packageURL)
      XCTFail("Expected the manifest to be rejected.")
    } catch let error as LivePhotoImportError {
      XCTAssertEqual(error, .manifestInvalid)
    }
  }

  func testRejectsManifestWithDuplicateEntries() async throws {
    let directory = try makeTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: directory) }
    let packageURL = directory.appendingPathComponent("package.zip")
    let manifest = LivePhotoExportManifest(
      schemaVersion: "1",
      recipeVersion: "cover-replacement.v3",
      entries: [
        "cover.jpg",
        "motion.mov",
        "manifest.json",
        "manifest.json",
      ],
      durationMs: 100,
      coverWidth: 64,
      coverHeight: 48,
      motionWidth: 16,
      motionHeight: 16,
      frameRate: 10,
      videoCodec: "h264",
      coverSha256: String(repeating: "0", count: 64),
      motionSha256: String(repeating: "0", count: 64),
      motionPassthrough: true,
      motionSourceAssetId: UUID().uuidString
    )
    try makeArchive(
      at: packageURL,
      entries: [
        "cover.jpg": Data([0xFF, 0xD8, 0xFF, 0xD9]),
        "motion.mov": Data("not-a-movie".utf8),
        "manifest.json": try JSONEncoder().encode(manifest),
      ]
    )

    do {
      _ = try await service.preparePackage(at: packageURL)
      XCTFail("Expected duplicate manifest entries to be rejected.")
    } catch let error as LivePhotoImportError {
      XCTAssertEqual(error, .unsupportedRecipe)
    }
  }

  func testRejectsPackageOverSizeLimit() async throws {
    let directory = try makeTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: directory) }
    let packageURL = directory.appendingPathComponent("package.zip")
    FileManager.default.createFile(atPath: packageURL.path, contents: nil)
    let handle = try FileHandle(forWritingTo: packageURL)
    try handle.truncate(atOffset: 50 * 1024 * 1024 + 1)
    try handle.close()

    do {
      _ = try await service.preparePackage(at: packageURL)
      XCTFail("Expected the oversized package to be rejected.")
    } catch let error as LivePhotoImportError {
      XCTAssertEqual(error, .packageTooLarge)
    }
  }

  func testWritesAssetIdentifierIntoReplacementJPEG() throws {
    let directory = try makeTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: directory) }
    let sourceURL = directory.appendingPathComponent("source.jpg")
    let outputURL = directory.appendingPathComponent("paired.jpg")
    let identifier = "137CB0B6-7236-497E-A19B-D3EC1BC0B155"

    try makeJPEG().write(to: sourceURL)

    try service.writeAssetIdentifier(
      identifier,
      sourceURL: sourceURL,
      destinationURL: outputURL
    )

    XCTAssertEqual(
      try service.readCoverAssetIdentifier(from: outputURL),
      identifier
    )
  }

  func testPreparesPackageWithoutChangingMotionBytes() async throws {
    let directory = try makeTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: directory) }
    let packageURL = directory.appendingPathComponent("package.zip")
    let motionURL = directory.appendingPathComponent("fixture.mov")
    let identifier = "137CB0B6-7236-497E-A19B-D3EC1BC0B155"
    let cover = try makeJPEG()
    let motion = try await makeMotionMovie(
      at: motionURL,
      assetIdentifier: identifier
    )
    let manifest = LivePhotoExportManifest(
      schemaVersion: "1",
      recipeVersion: "cover-replacement.v3",
      entries: ["cover.jpg", "motion.mov", "manifest.json"],
      durationMs: 100,
      coverWidth: 64,
      coverHeight: 48,
      motionWidth: 16,
      motionHeight: 16,
      frameRate: 10,
      videoCodec: "h264",
      coverSha256: sha256Hex(cover),
      motionSha256: sha256Hex(motion),
      motionPassthrough: true,
      motionSourceAssetId: UUID().uuidString
    )
    try makeArchive(
      at: packageURL,
      entries: [
        "cover.jpg": cover,
        "motion.mov": motion,
        "manifest.json": try JSONEncoder().encode(manifest),
      ]
    )

    let prepared = try await service.preparePackage(at: packageURL)
    defer { service.removePreparedPackage(prepared) }

    XCTAssertEqual(try Data(contentsOf: prepared.motionURL), motion)
    XCTAssertEqual(prepared.assetIdentifier, identifier)
    XCTAssertEqual(
      try service.readCoverAssetIdentifier(from: prepared.coverURL),
      identifier
    )
  }

  func testExternalPackageWhenProvided() async throws {
    guard
      let path = ProcessInfo.processInfo.environment["LIVE_PHOTO_PACKAGE_PATH"],
      !path.isEmpty
    else {
      throw XCTSkip("Set LIVE_PHOTO_PACKAGE_PATH to validate a real export.")
    }
    let prepared = try await service.preparePackage(
      at: URL(fileURLWithPath: path)
    )
    defer { service.removePreparedPackage(prepared) }

    XCTAssertEqual(
      sha256Hex(try Data(contentsOf: prepared.motionURL)),
      prepared.manifest.motionSha256
    )
    XCTAssertEqual(
      try service.readCoverAssetIdentifier(from: prepared.coverURL),
      prepared.assetIdentifier
    )
  }

  private func makeTemporaryDirectory() throws -> URL {
    let url = FileManager.default.temporaryDirectory
      .appendingPathComponent("live-photo-importer-test-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
  }

  private func makeArchive(
    at url: URL,
    entries: [String: Data]
  ) throws {
    let archive = try Archive(url: url, accessMode: .create)
    for (name, data) in entries {
      try archive.addEntry(
        with: name,
        type: .file,
        uncompressedSize: Int64(data.count),
        compressionMethod: .none,
        provider: { position, size in
          let lowerBound = Int(position)
          let upperBound = min(lowerBound + size, data.count)
          return data.subdata(in: lowerBound..<upperBound)
        }
      )
    }
  }

  private func makeJPEG() throws -> Data {
    let width = 64
    let height = 48
    let pixels = Data(repeating: 0x7F, count: width * height * 4)
    let provider = try XCTUnwrap(CGDataProvider(data: pixels as CFData))
    let image = try XCTUnwrap(
      CGImage(
        width: width,
        height: height,
        bitsPerComponent: 8,
        bitsPerPixel: 32,
        bytesPerRow: width * 4,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGBitmapInfo(
          rawValue: CGImageAlphaInfo.premultipliedLast.rawValue
        ),
        provider: provider,
        decode: nil,
        shouldInterpolate: false,
        intent: .defaultIntent
      )
    )
    let output = NSMutableData()
    let destination = try XCTUnwrap(
      CGImageDestinationCreateWithData(
        output,
        UTType.jpeg.identifier as CFString,
        1,
        nil
      )
    )
    CGImageDestinationAddImage(destination, image, nil)
    XCTAssertTrue(CGImageDestinationFinalize(destination))
    return output as Data
  }

  private func makeMotionMovie(
    at url: URL,
    assetIdentifier: String
  ) async throws -> Data {
    let writer = try AVAssetWriter(outputURL: url, fileType: .mov)
    let metadata = AVMutableMetadataItem()
    metadata.identifier = .quickTimeMetadataContentIdentifier
    metadata.value = assetIdentifier as NSString
    writer.metadata = [metadata]

    let input = AVAssetWriterInput(
      mediaType: .video,
      outputSettings: [
        AVVideoCodecKey: AVVideoCodecType.h264,
        AVVideoWidthKey: 16,
        AVVideoHeightKey: 16,
      ]
    )
    let adaptor = AVAssetWriterInputPixelBufferAdaptor(
      assetWriterInput: input,
      sourcePixelBufferAttributes: [
        kCVPixelBufferPixelFormatTypeKey as String:
          Int(kCVPixelFormatType_32BGRA),
        kCVPixelBufferWidthKey as String: 16,
        kCVPixelBufferHeightKey as String: 16,
      ]
    )
    XCTAssertTrue(writer.canAdd(input))
    writer.add(input)
    XCTAssertTrue(writer.startWriting())
    writer.startSession(atSourceTime: .zero)

    let pool = try XCTUnwrap(adaptor.pixelBufferPool)
    var optionalBuffer: CVPixelBuffer?
    XCTAssertEqual(
      CVPixelBufferPoolCreatePixelBuffer(nil, pool, &optionalBuffer),
      kCVReturnSuccess
    )
    let buffer = try XCTUnwrap(optionalBuffer)
    CVPixelBufferLockBaseAddress(buffer, [])
    if let address = CVPixelBufferGetBaseAddress(buffer) {
      memset(address, 0x7F, CVPixelBufferGetDataSize(buffer))
    }
    CVPixelBufferUnlockBaseAddress(buffer, [])
    XCTAssertTrue(adaptor.append(buffer, withPresentationTime: .zero))
    input.markAsFinished()
    await writer.finishWriting()
    XCTAssertEqual(writer.status, .completed)
    return try Data(contentsOf: url)
  }

  private func sha256Hex(_ data: Data) -> String {
    SHA256.hash(data: data)
      .map { String(format: "%02x", $0) }
      .joined()
  }
}
