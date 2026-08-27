import Foundation

struct LivePhotoExportManifest: Codable, Equatable, Sendable {
  let schemaVersion: String
  let recipeVersion: String
  let entries: [String]
  let durationMs: Int
  let coverWidth: Int
  let coverHeight: Int
  let motionWidth: Int
  let motionHeight: Int
  let frameRate: Double
  let videoCodec: String
  let coverSha256: String
  let motionSha256: String
  let motionPassthrough: Bool
  let motionSourceAssetId: String
}

struct PreparedLivePhoto: Sendable {
  let workspaceURL: URL
  let coverURL: URL
  let motionURL: URL
  let manifest: LivePhotoExportManifest
  let assetIdentifier: String

  var durationText: String {
    String(format: "%.1f 秒", Double(manifest.durationMs) / 1000)
  }

  var dimensionsText: String {
    "\(manifest.motionWidth) × \(manifest.motionHeight)"
  }
}

enum LivePhotoImportError: LocalizedError, Equatable {
  case packageTooLarge
  case packageUnreadable
  case packageEntriesInvalid
  case entryTooLarge(String)
  case manifestInvalid
  case unsupportedRecipe
  case coverHashMismatch
  case motionHashMismatch
  case motionWasNotPreserved
  case motionIdentifierMissing
  case coverMetadataWriteFailed
  case photoAccessDenied
  case livePhotoResourcesUnsupported
  case photoLibraryWriteFailed

  var errorDescription: String? {
    switch self {
    case .packageTooLarge:
      "资源包超过 50 MiB 上限。"
    case .packageUnreadable:
      "无法读取这个 ZIP 资源包。"
    case .packageEntriesInvalid:
      "资源包必须且只能包含 cover.jpg、motion.mov 和 manifest.json。"
    case .entryTooLarge(let name):
      "\(name) 超过允许大小。"
    case .manifestInvalid:
      "manifest.json 格式无效。"
    case .unsupportedRecipe:
      "资源包不是只替换封面的 cover-replacement.v3 版本。"
    case .coverHashMismatch:
      "封面文件校验失败。"
    case .motionHashMismatch:
      "动态视频文件校验失败。"
    case .motionWasNotPreserved:
      "资源包没有声明原始 MOV 透传，已拒绝导入。"
    case .motionIdentifierMissing:
      "原始 MOV 缺少 Apple Live Photo 配对标识。"
    case .coverMetadataWriteFailed:
      "无法把 Live Photo 配对标识写入新封面。"
    case .photoAccessDenied:
      "没有获得向照片图库添加内容的权限。"
    case .livePhotoResourcesUnsupported:
      "当前设备不支持以照片和配对视频创建 Live Photo。"
    case .photoLibraryWriteFailed:
      "照片图库没有接受这组 Live Photo 资源。"
    }
  }
}
