// swift-tools-version: 6.0

import PackageDescription

let package = Package(
  name: "LivePhotoImporterCore",
  platforms: [
    .macOS(.v14),
  ],
  dependencies: [
    .package(
      url: "https://github.com/weichsel/ZIPFoundation.git",
      exact: "0.9.20"
    ),
  ],
  targets: [
    .target(
      name: "LivePhotoImporterCore",
      dependencies: ["ZIPFoundation"],
      path: "Sources/Import",
      exclude: [
        "ImportModel.swift",
        "ImportView.swift",
        "PhotoLibraryService.swift",
      ]
    ),
    .testTarget(
      name: "LivePhotoImporterCoreTests",
      dependencies: [
        "LivePhotoImporterCore",
        "ZIPFoundation",
      ],
      path: "Tests"
    ),
  ]
)
