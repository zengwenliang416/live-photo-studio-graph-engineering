import Foundation
import Observation

@MainActor
@Observable
final class ImportModel {
  enum Phase: Equatable {
    case idle
    case preparing
    case ready
    case saving
    case saved
    case failed(String)
  }

  private(set) var phase: Phase = .idle
  private(set) var package: PreparedLivePhoto?
  private let packageService: LivePhotoPackageService
  private let photoLibraryService: PhotoLibraryService

  init(
    packageService: LivePhotoPackageService = LivePhotoPackageService(),
    photoLibraryService: PhotoLibraryService = PhotoLibraryService()
  ) {
    self.packageService = packageService
    self.photoLibraryService = photoLibraryService
  }

  func importPackage(from url: URL) {
    guard phase != .preparing, phase != .saving else { return }
    packageService.removePreparedPackage(package)
    package = nil
    phase = .preparing
    let hasSecurityScope = url.startAccessingSecurityScopedResource()

    Task {
      defer {
        if hasSecurityScope {
          url.stopAccessingSecurityScopedResource()
        }
      }
      do {
        let prepared = try await packageService.preparePackage(at: url)
        package = prepared
        phase = .ready
      } catch {
        phase = .failed(Self.message(for: error))
      }
    }
  }

  func saveToPhotos() {
    guard let package else { return }
    switch phase {
    case .ready, .failed:
      break
    default:
      return
    }
    phase = .saving
    Task {
      do {
        try await photoLibraryService.save(package)
        phase = .saved
      } catch {
        phase = .failed(Self.message(for: error))
      }
    }
  }

  func reset() {
    packageService.removePreparedPackage(package)
    package = nil
    phase = .idle
  }

  private static func message(for error: Error) -> String {
    if let localized = error as? LocalizedError,
       let description = localized.errorDescription
    {
      return description
    }
    return "导入失败，请检查资源包后重试。"
  }
}
