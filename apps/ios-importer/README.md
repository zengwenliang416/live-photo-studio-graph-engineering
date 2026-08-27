# Motion Cover iOS Prototype

SwiftUI product prototype plus the low-level Live Photo Studio package importer.

## Prototype flow

The default app entry is a local, zero-cost product prototype:

1. Select a sample Live Photo.
2. Review AI cover diagnostics.
3. Choose a low-transition repair treatment.
4. Simulate generating three candidate covers.
5. Drag the comparison split and select a candidate.
6. Preview the final save state.

The prototype does not upload media, call the generation API or write mock
results to Photos. The existing real ZIP + PhotoKit importer remains available
under `我的 → 高级工具 → 网页资源包导入`.

## What it does

1. Opens `package.zip` from Files or the system share/open flow.
2. Accepts only `cover.jpg`, `motion.mov` and `manifest.json`.
3. Verifies the manifest recipe and SHA-256 values.
4. Reads the existing QuickTime Live Photo content identifier from the MOV.
5. Writes the same identifier to the replacement JPEG MakerApple metadata.
6. Uses PhotoKit to create one asset from `.photo` and `.pairedVideo`.

The MOV is never transcoded or rewritten.

## Generate and build

```bash
cd apps/ios-importer
xcodegen generate
xcodebuild \
  -project LivePhotoImporter.xcodeproj \
  -scheme LivePhotoImporter \
  -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO \
  build-for-testing
```

## Test the import core

The package parser, hash checks, QuickTime identifier read and JPEG metadata
write are also exposed as a macOS SwiftPM test target so they do not depend on
Simulator test-host availability:

```bash
cd apps/ios-importer
swift test
```

To validate a real Web export package without committing user media:

```bash
LIVE_PHOTO_PACKAGE_PATH=/absolute/path/to/package.zip swift test
```

## Install on an iPhone

1. Open `LivePhotoImporter.xcodeproj` in Xcode.
2. Select your Apple Development team for the `LivePhotoImporter` target.
3. Connect an iPhone running iOS 17 or newer and run the app.
4. Download the Web export ZIP to Files.
5. Open the importer and select the ZIP, or share/open the ZIP with
   `Live Photo Importer`.
6. Tap `保存到照片图库` and approve add-only Photos access.

The ZIP is still a transport package. It becomes a Live Photo only after this
app successfully commits the paired resources through PhotoKit.
