import SwiftUI

struct RepairStudioView: View {
  @Environment(\.dismiss) private var dismiss
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var model = RepairPrototypeModel()

  var body: some View {
    ZStack {
      PrototypePageBackground()

      ScrollView {
        VStack(spacing: 20) {
          progressHeader
          content
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 32)
      }
    }
    .navigationBarBackButtonHidden(true)
    .toolbar(.hidden, for: .tabBar)
    .toolbar {
      ToolbarItem(placement: .topBarLeading) {
        if model.phase != .generating {
          Button {
            dismiss()
          } label: {
            Image(systemName: "chevron.left")
              .fontWeight(.bold)
          }
          .accessibilityLabel("返回")
        }
      }
    }
    .sensoryFeedback(.success, trigger: model.phase == .saved)
  }

  private var progressHeader: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack {
        SectionEyebrow(text: stepLabel)
        Spacer()
        Text(stepCount)
          .font(.system(.caption2, design: .monospaced, weight: .bold))
          .foregroundStyle(.secondary)
      }
      GeometryReader { proxy in
        ZStack(alignment: .leading) {
          Capsule().fill(.black.opacity(0.08))
          Capsule()
            .fill(PrototypeTheme.vermilion)
            .frame(width: proxy.size.width * progress)
        }
      }
      .frame(height: 5)
      .animation(
        reduceMotion ? .linear(duration: 0.15) : .spring(response: 0.4, dampingFraction: 0.9),
        value: progress
      )
    }
  }

  @ViewBuilder
  private var content: some View {
    switch model.phase {
    case .diagnosed:
      DiagnosisView(model: model)
        .transition(.opacity.combined(with: .move(edge: .trailing)))
    case .configuring:
      StylePickerView(model: model)
        .transition(.opacity.combined(with: .move(edge: .trailing)))
    case .generating:
      GeneratingView()
        .transition(.opacity)
    case .results:
      CandidateReviewView(model: model)
        .transition(.opacity.combined(with: .scale(scale: 0.98)))
    case .saved:
      SavedResultView(model: model)
        .transition(.opacity.combined(with: .scale(scale: 0.96)))
    }
  }

  private var progress: CGFloat {
    switch model.phase {
    case .diagnosed: 0.22
    case .configuring: 0.46
    case .generating: 0.68
    case .results: 0.88
    case .saved: 1
    }
  }

  private var stepLabel: String {
    switch model.phase {
    case .diagnosed: "AI 诊断"
    case .configuring: "修复方案"
    case .generating: "正在救片"
    case .results: "选择封面"
    case .saved: "保存完成"
    }
  }

  private var stepCount: String {
    switch model.phase {
    case .diagnosed: "01 / 05"
    case .configuring: "02 / 05"
    case .generating: "03 / 05"
    case .results: "04 / 05"
    case .saved: "05 / 05"
    }
  }
}

private struct DiagnosisView: View {
  let model: RepairPrototypeModel

  var body: some View {
    VStack(alignment: .leading, spacing: 18) {
      LivePhotoScene(variant: .original)
        .frame(maxHeight: 430)

      VStack(alignment: .leading, spacing: 14) {
        Text("这张封面可以救")
          .font(.system(.title2, design: .rounded, weight: .black))
          .foregroundStyle(PrototypeTheme.ink)

        Text("动态内容完整，AI 检测到 3 个只影响封面的画面问题。")
          .font(.system(.body, design: .rounded))
          .foregroundStyle(.secondary)

        FlowLayout(spacing: 8) {
          ForEach(model.detectedIssues, id: \.self) { issue in
            Label(issue, systemImage: "exclamationmark.circle.fill")
              .font(.system(.subheadline, design: .rounded, weight: .semibold))
              .foregroundStyle(PrototypeTheme.ink)
              .padding(.horizontal, 12)
              .padding(.vertical, 9)
              .background(PrototypeTheme.vermilion.opacity(0.10), in: Capsule())
          }
        }
      }
      .padding(20)
      .background(.white.opacity(0.82), in: RoundedRectangle(cornerRadius: 24))

      PrototypePrimaryButton(
        title: "选择修复方案",
        systemImage: "wand.and.stars",
        action: model.continueToStyles
      )
    }
  }
}

private struct StylePickerView: View {
  let model: RepairPrototypeModel

  var body: some View {
    VStack(alignment: .leading, spacing: 18) {
      VStack(alignment: .leading, spacing: 7) {
        Text("你想怎么救？")
          .font(.system(size: 31, weight: .black, design: .rounded))
          .tracking(-0.8)
        Text("推荐先用低跳变方案，长按播放时更自然。")
          .font(.system(.body, design: .rounded))
          .foregroundStyle(.secondary)
      }

      ForEach(RepairPreset.allCases) { preset in
        Button {
          withAnimation(.spring(response: 0.28, dampingFraction: 0.9)) {
            model.selectedPreset = preset
          }
        } label: {
          HStack(spacing: 14) {
            LivePhotoScene(variant: variant(for: preset), showsLiveBadge: false)
              .frame(width: 82, height: 104)

            VStack(alignment: .leading, spacing: 5) {
              Text(preset.title)
                .font(.system(.headline, design: .rounded, weight: .bold))
              Text(preset.subtitle)
                .font(.system(.caption, design: .rounded))
                .foregroundStyle(.secondary)
            }

            Spacer()

            Image(systemName: model.selectedPreset == preset ? "checkmark.circle.fill" : "circle")
              .font(.system(size: 22, weight: .semibold))
              .foregroundStyle(
                model.selectedPreset == preset ? preset.accent : Color.secondary.opacity(0.45)
              )
          }
          .padding(12)
          .background(
            model.selectedPreset == preset
              ? preset.accent.opacity(0.10)
              : Color.white.opacity(0.74),
            in: RoundedRectangle(cornerRadius: 22, style: .continuous)
          )
          .overlay {
            RoundedRectangle(cornerRadius: 22, style: .continuous)
              .stroke(
                model.selectedPreset == preset
                  ? preset.accent.opacity(0.55)
                  : Color.black.opacity(0.05),
                lineWidth: 1
              )
          }
        }
        .buttonStyle(.plain)
      }

      PrototypePrimaryButton(
        title: "生成 3 张修复封面",
        systemImage: "sparkles",
        action: model.generate
      )
    }
  }

  private func variant(for preset: RepairPreset) -> LivePhotoScene.Variant {
    switch preset {
    case .natural: .natural
    case .glow: .glow
    case .film: .film
    case .clean: .clean
    }
  }
}

private struct GeneratingView: View {
  @State private var rotation = 0.0

  var body: some View {
    VStack(spacing: 24) {
      Spacer(minLength: 90)

      ZStack {
        Circle()
          .stroke(PrototypeTheme.vermilion.opacity(0.14), lineWidth: 16)
          .frame(width: 132, height: 132)
        Circle()
          .trim(from: 0.08, to: 0.72)
          .stroke(
            PrototypeTheme.vermilion,
            style: StrokeStyle(lineWidth: 16, lineCap: .round)
          )
          .frame(width: 132, height: 132)
          .rotationEffect(.degrees(rotation))
        Image(systemName: "livephoto")
          .font(.system(size: 38, weight: .bold))
          .foregroundStyle(PrototypeTheme.vermilion)
      }
      .onAppear {
        withAnimation(.linear(duration: 1).repeatForever(autoreverses: false)) {
          rotation = 360
        }
      }

      VStack(spacing: 8) {
        Text("正在重拍封面")
          .font(.system(size: 28, weight: .black, design: .rounded))
        Text("身份、构图和动态边界保持不变")
          .font(.system(.body, design: .rounded))
          .foregroundStyle(.secondary)
      }

      VStack(spacing: 10) {
        generationStep("分析人物身份", completed: true)
        generationStep("修复表情与光线", completed: true)
        generationStep("检查动态衔接", completed: false)
      }
      .padding(20)
      .background(.white.opacity(0.76), in: RoundedRectangle(cornerRadius: 24))

      Spacer(minLength: 70)
    }
  }

  private func generationStep(_ title: String, completed: Bool) -> some View {
    HStack {
      Image(systemName: completed ? "checkmark.circle.fill" : "ellipsis.circle.fill")
        .foregroundStyle(completed ? PrototypeTheme.leaf : PrototypeTheme.vermilion)
      Text(title)
        .font(.system(.subheadline, design: .rounded, weight: .semibold))
      Spacer()
    }
  }
}

private struct CandidateReviewView: View {
  let model: RepairPrototypeModel

  private let variants: [LivePhotoScene.Variant] = [.natural, .glow, .clean]

  var body: some View {
    VStack(alignment: .leading, spacing: 18) {
      VStack(alignment: .leading, spacing: 6) {
        Text("选一张新封面")
          .font(.system(size: 31, weight: .black, design: .rounded))
          .tracking(-0.8)
        Text("拖动中线比较原封面，动态视频没有改变。")
          .font(.system(.body, design: .rounded))
          .foregroundStyle(.secondary)
      }

      ComparePhotoView(
        candidate: variants[model.selectedCandidate],
        position: Binding(
          get: { model.comparePosition },
          set: { model.comparePosition = $0 }
        )
      )

      HStack(spacing: 10) {
        ForEach(variants.indices, id: \.self) { index in
          Button {
            withAnimation(.spring(response: 0.3, dampingFraction: 0.88)) {
              model.selectedCandidate = index
            }
          } label: {
            LivePhotoScene(variant: variants[index], showsLiveBadge: false)
              .frame(maxWidth: .infinity)
              .overlay {
                RoundedRectangle(cornerRadius: 28, style: .continuous)
                  .stroke(
                    index == model.selectedCandidate
                      ? PrototypeTheme.vermilion
                      : .clear,
                    lineWidth: 3
                  )
              }
          }
          .buttonStyle(.plain)
          .accessibilityLabel("候选封面 \(index + 1)")
        }
      }
      .frame(height: 126)

      HStack {
        Label("低跳变", systemImage: "checkmark.shield.fill")
          .foregroundStyle(PrototypeTheme.leaf)
        Spacer()
        Text("预计消耗 1 点")
          .foregroundStyle(.secondary)
      }
      .font(.system(.caption, design: .rounded, weight: .semibold))

      PrototypePrimaryButton(
        title: "保存为新的 Live Photo",
        systemImage: "square.and.arrow.down.fill",
        action: model.save
      )

      Button("重新生成") {
        model.generate()
      }
      .font(.system(.subheadline, design: .rounded, weight: .semibold))
      .foregroundStyle(PrototypeTheme.ink)
      .frame(maxWidth: .infinity)
    }
  }
}

private struct ComparePhotoView: View {
  let candidate: LivePhotoScene.Variant
  @Binding var position: Double

  var body: some View {
    GeometryReader { proxy in
      let split = proxy.size.width * position

      ZStack(alignment: .leading) {
        LivePhotoScene(variant: candidate)

        LivePhotoScene(variant: .original)
          .mask(alignment: .leading) {
            Rectangle()
              .frame(width: split)
          }

        Rectangle()
          .fill(.white)
          .frame(width: 2)
          .offset(x: split - 1)
          .shadow(color: .black.opacity(0.18), radius: 4)

        Image(systemName: "arrow.left.and.right.circle.fill")
          .font(.system(size: 34, weight: .bold))
          .foregroundStyle(.white)
          .shadow(color: .black.opacity(0.22), radius: 6)
          .offset(x: split - 17)
      }
      .contentShape(Rectangle())
      .gesture(
        DragGesture(minimumDistance: 0)
          .onChanged { value in
            position = min(max(value.location.x / proxy.size.width, 0.08), 0.92)
          }
      )
      .overlay(alignment: .bottomLeading) {
        Text("原封面")
          .font(.system(.caption2, design: .rounded, weight: .bold))
          .padding(.horizontal, 10)
          .padding(.vertical, 7)
          .background(.ultraThinMaterial, in: Capsule())
          .padding(14)
      }
      .overlay(alignment: .bottomTrailing) {
        Text("AI 修复")
          .font(.system(.caption2, design: .rounded, weight: .bold))
          .padding(.horizontal, 10)
          .padding(.vertical, 7)
          .background(.ultraThinMaterial, in: Capsule())
          .padding(14)
      }
    }
    .aspectRatio(0.78, contentMode: .fit)
    .accessibilityLabel("原封面与 AI 修复封面对比")
  }
}

private struct SavedResultView: View {
  let model: RepairPrototypeModel

  var body: some View {
    VStack(spacing: 22) {
      Spacer(minLength: 30)

      ZStack(alignment: .bottomTrailing) {
        LivePhotoScene(variant: .natural)
          .frame(maxHeight: 470)
        Image(systemName: "checkmark")
          .font(.system(size: 25, weight: .black))
          .foregroundStyle(.white)
          .frame(width: 58, height: 58)
          .background(PrototypeTheme.leaf, in: Circle())
          .overlay {
            Circle().stroke(.white, lineWidth: 4)
          }
          .padding(16)
      }

      VStack(spacing: 7) {
        Text("已经救回这一刻")
          .font(.system(size: 29, weight: .black, design: .rounded))
        Text("新封面已与原始动态配对，原 MOV 保持不变。")
          .font(.system(.body, design: .rounded))
          .foregroundStyle(.secondary)
          .multilineTextAlignment(.center)
      }

      PrototypePrimaryButton(
        title: "再救一张",
        systemImage: "plus",
        action: model.startOver
      )

      Button("查看照片图库") {}
        .font(.system(.subheadline, design: .rounded, weight: .semibold))
        .foregroundStyle(PrototypeTheme.ink)
    }
  }
}

private struct FlowLayout: Layout {
  let spacing: CGFloat

  func sizeThatFits(
    proposal: ProposedViewSize,
    subviews: Subviews,
    cache: inout ()
  ) -> CGSize {
    let result = layout(proposal: proposal, subviews: subviews)
    return result.size
  }

  func placeSubviews(
    in bounds: CGRect,
    proposal: ProposedViewSize,
    subviews: Subviews,
    cache: inout ()
  ) {
    let result = layout(proposal: proposal, subviews: subviews)
    for (index, point) in result.points.enumerated() {
      subviews[index].place(
        at: CGPoint(x: bounds.minX + point.x, y: bounds.minY + point.y),
        proposal: .unspecified
      )
    }
  }

  private func layout(
    proposal: ProposedViewSize,
    subviews: Subviews
  ) -> (size: CGSize, points: [CGPoint]) {
    let width = proposal.width ?? 320
    var points: [CGPoint] = []
    var x: CGFloat = 0
    var y: CGFloat = 0
    var lineHeight: CGFloat = 0

    for subview in subviews {
      let size = subview.sizeThatFits(.unspecified)
      if x + size.width > width, x > 0 {
        x = 0
        y += lineHeight + spacing
        lineHeight = 0
      }
      points.append(CGPoint(x: x, y: y))
      x += size.width + spacing
      lineHeight = max(lineHeight, size.height)
    }

    return (
      CGSize(width: width, height: y + lineHeight),
      points
    )
  }
}

#Preview("Diagnosis") {
  NavigationStack {
    RepairStudioView()
  }
}
