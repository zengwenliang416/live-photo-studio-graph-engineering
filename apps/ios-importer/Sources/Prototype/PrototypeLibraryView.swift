import SwiftUI

struct PrototypeLibraryView: View {
  var body: some View {
    ZStack {
      PrototypePageBackground()

      ScrollView {
        VStack(alignment: .leading, spacing: 22) {
          VStack(alignment: .leading, spacing: 5) {
            SectionEyebrow(text: "MY LIVE PHOTOS")
            Text("作品")
              .font(.system(size: 34, weight: .black, design: .rounded))
          }

          HStack(spacing: 10) {
            stat("12", label: "已救封面")
            stat("100%", label: "原动态保留")
            stat("8", label: "本月剩余")
          }

          LazyVGrid(
            columns: [
              GridItem(.flexible(), spacing: 12),
              GridItem(.flexible(), spacing: 12),
            ],
            spacing: 18
          ) {
            work("海边落日", variant: .glow, date: "今天")
            work("城市散步", variant: .natural, date: "昨天")
            work("旧街胶片", variant: .film, date: "8 月 24 日")
            work("夏日公园", variant: .clean, date: "8 月 19 日")
          }
        }
        .padding(20)
        .padding(.bottom, 28)
      }
    }
    .toolbar(.hidden, for: .navigationBar)
  }

  private func stat(_ value: String, label: String) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      Text(value)
        .font(.system(.title2, design: .rounded, weight: .black))
      Text(label)
        .font(.system(.caption2, design: .rounded, weight: .semibold))
        .foregroundStyle(.secondary)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(14)
    .background(.white.opacity(0.72), in: RoundedRectangle(cornerRadius: 18))
  }

  private func work(
    _ title: String,
    variant: LivePhotoScene.Variant,
    date: String
  ) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      LivePhotoScene(variant: variant)
      Text(title)
        .font(.system(.subheadline, design: .rounded, weight: .bold))
      Text(date)
        .font(.system(.caption2, design: .rounded))
        .foregroundStyle(.secondary)
    }
  }
}

#Preview {
  PrototypeLibraryView()
}
