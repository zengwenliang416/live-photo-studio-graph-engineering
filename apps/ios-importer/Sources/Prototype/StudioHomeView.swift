import SwiftUI

struct StudioHomeView: View {
  var body: some View {
    ZStack {
      PrototypePageBackground()

      ScrollView {
        VStack(alignment: .leading, spacing: 26) {
          header
          heroCard
          promiseStrip
          recentSection
        }
        .padding(.horizontal, 20)
        .padding(.top, 12)
        .padding(.bottom, 36)
      }
    }
    .toolbar(.hidden, for: .navigationBar)
  }

  private var header: some View {
    HStack(alignment: .center) {
      VStack(alignment: .leading, spacing: 3) {
        SectionEyebrow(text: "MOTION COVER")
        Text("救回这一刻")
          .font(.system(size: 32, weight: .black, design: .rounded))
          .tracking(-1)
          .foregroundStyle(PrototypeTheme.ink)
      }
      Spacer()
      Button {} label: {
        Image(systemName: "sparkles")
          .font(.system(size: 17, weight: .bold))
          .foregroundStyle(PrototypeTheme.vermilion)
          .frame(width: 44, height: 44)
          .background(.white.opacity(0.78), in: Circle())
      }
      .accessibilityLabel("查看剩余点数")
    }
  }

  private var heroCard: some View {
    ZStack(alignment: .bottomLeading) {
      LivePhotoScene(variant: .original)

      VStack(alignment: .leading, spacing: 10) {
        Text("动态很好，\n只是封面没拍好。")
          .font(.system(size: 28, weight: .black, design: .rounded))
          .tracking(-0.8)
          .foregroundStyle(.white)

        Text("AI 只修封面，声音和动作保持原样。")
          .font(.system(.subheadline, design: .rounded, weight: .semibold))
          .foregroundStyle(.white.opacity(0.78))

        NavigationLink {
          RepairStudioView()
        } label: {
          Label("选择一张实况照片", systemImage: "photo.on.rectangle.angled")
            .font(.system(.headline, design: .rounded, weight: .bold))
            .foregroundStyle(PrototypeTheme.ink)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 15)
            .background(.white, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .padding(.top, 4)
      }
      .padding(22)
    }
    .shadow(color: PrototypeTheme.ink.opacity(0.18), radius: 28, y: 14)
  }

  private var promiseStrip: some View {
    HStack(spacing: 0) {
      promise("不改动态", icon: "waveform")
      Divider().frame(height: 34)
      promise("保留声音", icon: "speaker.wave.2.fill")
      Divider().frame(height: 34)
      promise("一键保存", icon: "checkmark.circle.fill")
    }
    .padding(.vertical, 16)
    .background(.white.opacity(0.72), in: RoundedRectangle(cornerRadius: 22))
  }

  private func promise(_ title: String, icon: String) -> some View {
    VStack(spacing: 7) {
      Image(systemName: icon)
        .font(.system(size: 16, weight: .bold))
        .foregroundStyle(PrototypeTheme.vermilion)
      Text(title)
        .font(.system(.caption, design: .rounded, weight: .semibold))
        .foregroundStyle(PrototypeTheme.ink)
    }
    .frame(maxWidth: .infinity)
  }

  private var recentSection: some View {
    VStack(alignment: .leading, spacing: 14) {
      HStack {
        SectionEyebrow(text: "最近作品")
        Spacer()
        Text("查看全部")
          .font(.system(.caption, design: .rounded, weight: .semibold))
          .foregroundStyle(.secondary)
      }

      HStack(spacing: 12) {
        recentCard(title: "海边落日", variant: .glow)
        recentCard(title: "街角胶片", variant: .film)
      }
    }
  }

  private func recentCard(title: String, variant: LivePhotoScene.Variant) -> some View {
    VStack(alignment: .leading, spacing: 9) {
      LivePhotoScene(variant: variant, showsLiveBadge: false)
      Text(title)
        .font(.system(.subheadline, design: .rounded, weight: .bold))
      Text("动态原片 · 已保存")
        .font(.system(.caption2, design: .rounded))
        .foregroundStyle(.secondary)
    }
    .frame(maxWidth: .infinity)
  }
}

#Preview {
  NavigationStack {
    StudioHomeView()
  }
}
