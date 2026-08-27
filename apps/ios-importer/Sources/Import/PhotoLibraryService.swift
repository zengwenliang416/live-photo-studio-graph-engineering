import Photos

struct PhotoLibraryService: Sendable {
  func save(_ package: PreparedLivePhoto) async throws {
    let status = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
    guard status == .authorized || status == .limited else {
      throw LivePhotoImportError.photoAccessDenied
    }

    let resourceTypes = [
      NSNumber(value: PHAssetResourceType.photo.rawValue),
      NSNumber(value: PHAssetResourceType.pairedVideo.rawValue),
    ]
    guard PHAssetCreationRequest.supportsAssetResourceTypes(resourceTypes) else {
      throw LivePhotoImportError.livePhotoResourcesUnsupported
    }

    do {
      try await PHPhotoLibrary.shared().performChanges {
        let request = PHAssetCreationRequest.forAsset()
        let photoOptions = PHAssetResourceCreationOptions()
        photoOptions.shouldMoveFile = false
        request.addResource(
          with: .photo,
          fileURL: package.coverURL,
          options: photoOptions
        )

        let videoOptions = PHAssetResourceCreationOptions()
        videoOptions.shouldMoveFile = false
        request.addResource(
          with: .pairedVideo,
          fileURL: package.motionURL,
          options: videoOptions
        )
      }
    } catch {
      throw LivePhotoImportError.photoLibraryWriteFailed
    }
  }
}
