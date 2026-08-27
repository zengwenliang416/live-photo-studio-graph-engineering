# iOS Live Photo Importer

## 1. Purpose and user-visible outcome

Add an iOS SwiftUI app that accepts a Live Photo Studio export ZIP, validates
the package, writes the source MOV content identifier into the replacement JPEG,
and saves the JPEG plus unchanged MOV to Photos as one Live Photo.

## 2. Progress checklist with timestamps

- [x] 2026-08-27: Confirmed the repository has no existing iOS target.
- [x] 2026-08-27: Confirmed the source MOV contains Apple's QuickTime content
  identifier and Live Photo metadata.
- [x] 2026-08-27: Confirmed Xcode 26.3, Swift 6.2.4, XcodeGen and iOS 26.3
  simulator runtimes are installed.
- [x] 2026-08-27: Scaffolded the iOS application and test target with XcodeGen.
- [x] 2026-08-27: Implemented bounded ZIP validation and manifest hash
  verification.
- [x] 2026-08-27: Implemented content identifier extraction and JPEG metadata
  preparation.
- [x] 2026-08-27: Implemented PhotoKit add-only authorization and paired
  resource creation.
- [x] 2026-08-27: Implemented file picker and external ZIP open handling.
- [x] 2026-08-27: Built the app and test targets for arm64 and x86_64 iOS
  Simulator architectures.
- [x] 2026-08-27: Validated the import core against a temporary corrected copy
  of the current production export package.
- [x] 2026-08-27: Documented device installation and import steps.
- [ ] Complete signed physical-iPhone validation and confirm long-press
  playback in Photos.

## 3. Surprises and discoveries

- The production MOV already contains
  `com.apple.quicktime.content.identifier`, so the importer must preserve the
  MOV bytes and adapt only the replacement JPEG metadata.
- The Web export package intentionally contains no PhotoKit-saved asset. iOS
  must create the asset from `.photo` and `.pairedVideo` resources.
- The existing downloaded package had valid media and hashes but its ZIP-local
  manifest lacked `entries`. The Worker serialized the manifest before adding
  the package contract fields.
- A ZIP-local manifest cannot contain the hash of its containing ZIP without
  creating a self-reference. `packageSha256` therefore remains database-only.
- Simulator XCTest execution repeatedly stalled in Xcode/TestManager before
  test methods materialized. The same core target runs as a macOS SwiftPM test
  suite, which completed normally.

## 4. Decision log

- Use a standalone `apps/ios-importer` app so PhotoKit and signing concerns do
  not leak into the Web/API/Worker deployment.
- Target iOS 17 to use modern SwiftUI observation and async APIs.
- Register the app as a ZIP document handler in addition to offering a native
  file importer. This covers Files and system share/open workflows without a
  separate extension target.
- Use ZIPFoundation for bounded ZIP extraction instead of implementing ZIP
  parsing or invoking a process unavailable in the iOS sandbox.
- Preserve `motion.mov` byte-for-byte. Only the JPEG receives the matching
  MakerApple asset identifier.
- Use the same package manifest bytes inside the ZIP and as the separately
  stored manifest object. Add `packageSha256` only to the database manifest.
- Keep generated Xcode project files in the repository so the importer can be
  opened directly; `project.yml` remains the reproducible source.

## 5. Outcomes and retrospective

The importer implementation, package-contract repair and automated core
validation are complete. SwiftPM executed seven tests with no failures when the
real-package path was provided, including verification that the prepared MOV
hash still matched the package manifest. The Xcode app and XCTest targets also
completed `build-for-testing` for both Simulator architectures.

The remaining acceptance step is intentionally device-only: sign and install
the app on a physical iPhone, import a newly rendered package, then verify that
Photos displays one Live Photo and long-press playback uses the unchanged
motion.

## 6. Repository context and orientation

The Web export is built in `apps/worker-media` as `cover.jpg`, `motion.mov` and
`manifest.json` inside `package.zip`. The new app lives in
`apps/ios-importer`, consumes that contract, and does not call the API.

## 7. Architecture invariants

- Never transcode, trim, crop or otherwise rewrite the source MOV.
- Never claim success until PhotoKit completes the change request.
- Validate package hashes before creating a Photos asset.
- Keep imported files in a per-operation temporary directory and remove them
  after completion.
- Request Photo Library add-only access.
- Do not log image bytes, metadata dictionaries, location metadata or package
  contents.

## 8. Milestones and implementation narrative

Milestone 1 creates a buildable SwiftUI/XcodeGen project. Milestone 2 implements
package validation and Live Photo metadata preparation with unit tests.
Milestone 3 adds PhotoKit persistence and the import UI. Milestone 4 builds and
tests on Simulator, then validates the parser against the current export ZIP.

## 9. Concrete commands

From `apps/ios-importer`:

    xcodegen generate
    xcodebuild -project LivePhotoImporter.xcodeproj -scheme LivePhotoImporter \
      -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
      CODE_SIGNING_ALLOWED=NO build-for-testing
    LIVE_PHOTO_PACKAGE_PATH=/absolute/path/to/package.zip swift test

## 10. Validation and acceptance criteria

- The project builds without signing on an installed iOS Simulator runtime.
- Unit tests reject missing entries, hash mismatches and oversized packages.
- Unit tests prove the prepared MOV bytes are unchanged.
- A corrected temporary copy of the current production package parses and its
  prepared MOV hash still matches the package manifest.
- A signed physical-device build requests add-only Photos access and creates one
  asset from `.photo` plus `.pairedVideo`.

## 11. Idempotence, recovery and rollback

Each import uses a new temporary directory. Failed validation creates no Photos
asset. A PhotoKit failure retains the prepared package, shows the error and
offers a direct save retry. Rollback is removing `apps/ios-importer` and its
documentation; no server schema changes are required.

## 12. Interfaces and dependencies

- `ZIPFoundation` for ZIP archive inspection and extraction.
- `CryptoKit` for SHA-256.
- `AVFoundation` for QuickTime content identifier reads.
- `ImageIO` and `UniformTypeIdentifiers` for JPEG metadata output.
- `Photos` for `PHAssetCreationRequest`.

## 13. Security, privacy and cost controls

Imports are local-only. The app performs no network requests and stores no
credentials. It rejects unbounded archives, unexpected resource names,
symbolic links and hash mismatches. Photo access is add-only.

## 14. Artifacts and operational notes

The generated Xcode project is reproducible from `project.yml`. Real Photos
library acceptance requires an Apple-signed build on an iPhone; Simulator
validation cannot replace device verification.
