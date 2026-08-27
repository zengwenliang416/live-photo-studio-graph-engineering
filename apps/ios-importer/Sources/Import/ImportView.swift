import SwiftUI
import UniformTypeIdentifiers

struct ImportView: View {
  @State private var model = ImportModel()
  @State private var isPickingPackage = false

  var body: some View {
    ZStack {
      LinearGradient(
        colors: [
          Color(red: 0.96, green: 0.93, blue: 0.84),
          Color(red: 0.90, green: 0.93, blue: 0.88),
        ],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
      )
      .ignoresSafeArea()

      ScrollView {
        VStack(alignment: .leading, spacing: 22) {
          header
          importCard
          processSteps
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 28)
      }
    }
    .tint(Color(red: 0.96, green: 0.31, blue: 0.18))
    .fileImporter(
      isPresented: $isPickingPackage,
      allowedContentTypes: [.zip],
      allowsMultipleSelection: false
    ) { result in
      if case .success(let urls) = result, let url = urls.first {
        model.importPackage(from: url)
      }
    }
    .onOpenURL { url in
      model.importPackage(from: url)
    }
  }

  private var header: some View {
    VStack(alignment: .leading, spacing: 10) {
      Text("LIVE PHOTO / IMPORT")
        .font(.system(.caption, design: .monospaced, weight: .bold))
        .tracking(2.2)
        .foregroundStyle(.secondary)

      Text("只换封面，\n动态原样进入相册。")
        .font(.system(size: 38, weight: .black, design: .rounded))
        .tracking(-1.4)
        .foregroundStyle(Color(red: 0.07, green: 0.10, blue: 0.12))

      Text("选择网页导出的 package.zip。导入器校验封面和 MOV，再通过 PhotoKit 保存成一张真正的 Live Photo。")
        .font(.system(.body, design: .rounded, weight: .medium))
        .foregroundStyle(.secondary)
        .lineSpacing(4)
    }
  }

  private var importCard: some View {
    VStack(alignment: .leading, spacing: 18) {
      HStack(alignment: .top) {
        Image(systemName: phaseIcon)
          .font(.system(size: 24, weight: .bold))
          .foregroundStyle(phaseColor)
          .frame(width: 46, height: 46)
          .background(phaseColor.opacity(0.12), in: RoundedRectangle(cornerRadius: 14))

        VStack(alignment: .leading, spacing: 4) {
          Text(phaseTitle)
            .font(.system(.title3, design: .rounded, weight: .bold))
          Text(phaseDetail)
            .font(.system(.subheadline, design: .rounded))
            .foregroundStyle(.secondary)
        }
      }

      if let package = model.package {
        Divider()
        packageSummary(package)
      }

      actionButtons
    }
    .padding(20)
    .background(.white.opacity(0.88), in: RoundedRectangle(cornerRadius: 26))
    .overlay {
      RoundedRectangle(cornerRadius: 26)
        .stroke(.black.opacity(0.08), lineWidth: 1)
    }
    .shadow(color: .black.opacity(0.08), radius: 24, y: 12)
  }

  private func packageSummary(_ package: PreparedLivePhoto) -> some View {
    VStack(spacing: 10) {
      metricRow("VIDEO", "\(package.dimensionsText) · \(package.manifest.videoCodec.uppercased())")
      metricRow("DURATION", package.durationText)
      metricRow("MOTION", "原始 MOV 逐字节保留")
      metricRow("PAIR ID", String(package.assetIdentifier.prefix(18)) + "…")
    }
  }

  private func metricRow(_ label: String, _ value: String) -> some View {
    HStack {
      Text(label)
        .font(.system(.caption2, design: .monospaced, weight: .bold))
        .tracking(1)
        .foregroundStyle(.secondary)
      Spacer()
      Text(value)
        .font(.system(.subheadline, design: .rounded, weight: .semibold))
        .multilineTextAlignment(.trailing)
    }
  }

  @ViewBuilder
  private var actionButtons: some View {
    switch model.phase {
    case .idle:
      Button {
        isPickingPackage = true
      } label: {
        actionLabel("选择 package.zip", systemImage: "tray.and.arrow.down.fill")
      }
      .buttonStyle(PrimaryActionButtonStyle())

    case .failed:
      if model.package != nil {
        Button {
          model.saveToPhotos()
        } label: {
          actionLabel("重试保存到照片图库", systemImage: "livephoto")
        }
        .buttonStyle(PrimaryActionButtonStyle())

        Button("重新选择资源包") {
          isPickingPackage = true
        }
        .font(.system(.subheadline, design: .rounded, weight: .semibold))
        .frame(maxWidth: .infinity)
      } else {
        Button {
          isPickingPackage = true
        } label: {
          actionLabel("重新选择 package.zip", systemImage: "tray.and.arrow.down.fill")
        }
        .buttonStyle(PrimaryActionButtonStyle())
      }

    case .preparing:
      ProgressView("正在校验资源和配对标识…")
        .frame(maxWidth: .infinity)

    case .ready:
      Button {
        model.saveToPhotos()
      } label: {
        actionLabel("保存到照片图库", systemImage: "livephoto")
      }
      .buttonStyle(PrimaryActionButtonStyle())

      Button("重新选择资源包") {
        isPickingPackage = true
      }
      .font(.system(.subheadline, design: .rounded, weight: .semibold))
      .frame(maxWidth: .infinity)

    case .saving:
      ProgressView("正在创建 Live Photo…")
        .frame(maxWidth: .infinity)

    case .saved:
      Button {
        model.reset()
      } label: {
        actionLabel("继续导入", systemImage: "plus")
      }
      .buttonStyle(PrimaryActionButtonStyle())
    }
  }

  private func actionLabel(_ title: String, systemImage: String) -> some View {
    Label(title, systemImage: systemImage)
      .font(.system(.headline, design: .rounded, weight: .bold))
      .frame(maxWidth: .infinity)
      .padding(.vertical, 4)
  }

  private var processSteps: some View {
    VStack(alignment: .leading, spacing: 14) {
      Text("IMPORT CONTRACT")
        .font(.system(.caption, design: .monospaced, weight: .bold))
        .tracking(2)
        .foregroundStyle(.secondary)

      step("01", "验证 ZIP", "只接受 cover.jpg、motion.mov、manifest.json")
      step("02", "绑定封面", "读取 MOV 配对 ID，仅写入新 JPEG")
      step("03", "写入相册", "PhotoKit 同时提交 photo 与 pairedVideo")
    }
    .padding(20)
    .background(Color(red: 0.07, green: 0.10, blue: 0.12), in: RoundedRectangle(cornerRadius: 26))
    .foregroundStyle(.white)
  }

  private func step(_ number: String, _ title: String, _ detail: String) -> some View {
    HStack(alignment: .top, spacing: 14) {
      Text(number)
        .font(.system(.caption, design: .monospaced, weight: .black))
        .foregroundStyle(Color(red: 0.96, green: 0.31, blue: 0.18))
        .frame(width: 28)
      VStack(alignment: .leading, spacing: 3) {
        Text(title)
          .font(.system(.headline, design: .rounded, weight: .bold))
        Text(detail)
          .font(.system(.caption, design: .rounded))
          .foregroundStyle(.white.opacity(0.62))
      }
    }
  }

  private var phaseIcon: String {
    switch model.phase {
    case .idle: "shippingbox.fill"
    case .preparing, .saving: "arrow.triangle.2.circlepath"
    case .ready: "checkmark.seal.fill"
    case .saved: "livephoto"
    case .failed: "exclamationmark.triangle.fill"
    }
  }

  private var phaseColor: Color {
    switch model.phase {
    case .failed: .red
    case .saved, .ready: Color(red: 0.10, green: 0.55, blue: 0.32)
    default: Color(red: 0.96, green: 0.31, blue: 0.18)
    }
  }

  private var phaseTitle: String {
    switch model.phase {
    case .idle: "等待资源包"
    case .preparing: "正在准备"
    case .ready: "可以写入相册"
    case .saving: "正在保存"
    case .saved: "已保存为 Live Photo"
    case .failed: "导入失败"
    }
  }

  private var phaseDetail: String {
    switch model.phase {
    case .idle:
      "从“文件”选择，或在系统分享菜单中用本 App 打开 ZIP。"
    case .preparing:
      "正在检查清单、SHA-256 和 Apple 配对标识。"
    case .ready:
      "MOV 保持原样，只给新封面补齐配对元数据。"
    case .saving:
      "请不要退出 App，PhotoKit 正在创建照片资产。"
    case .saved:
      "现在可以打开“照片”查看并长按播放。"
    case .failed(let message):
      message
    }
  }
}

private struct PrimaryActionButtonStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .padding(.vertical, 14)
      .padding(.horizontal, 18)
      .foregroundStyle(.white)
      .background(
        configuration.isPressed
          ? Color(red: 0.75, green: 0.20, blue: 0.12)
          : Color(red: 0.96, green: 0.31, blue: 0.18),
        in: RoundedRectangle(cornerRadius: 17)
      )
      .scaleEffect(configuration.isPressed ? 0.985 : 1)
  }
}

#Preview {
  ImportView()
}
