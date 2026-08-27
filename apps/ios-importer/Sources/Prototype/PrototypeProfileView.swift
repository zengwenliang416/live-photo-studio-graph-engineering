import SwiftUI

struct PrototypeProfileView: View {
  var body: some View {
    ZStack {
      PrototypePageBackground()

      ScrollView {
        VStack(alignment: .leading, spacing: 22) {
          VStack(alignment: .leading, spacing: 5) {
            SectionEyebrow(text: "ACCOUNT")
            Text("我的")
              .font(.system(size: 34, weight: .black, design: .rounded))
          }

          creditCard

          VStack(spacing: 0) {
            settingRow("生成偏好", icon: "slider.horizontal.3")
            Divider().padding(.leading, 54)
            settingRow("隐私与照片权限", icon: "hand.raised.fill")
            Divider().padding(.leading, 54)
            settingRow("导出质量", icon: "4k.tv.fill")
          }
          .background(.white.opacity(0.76), in: RoundedRectangle(cornerRadius: 24))

          VStack(alignment: .leading, spacing: 12) {
            SectionEyebrow(text: "高级工具")

            NavigationLink {
              ImportView()
                .navigationTitle("ZIP 导入器")
                .navigationBarTitleDisplayMode(.inline)
            } label: {
              HStack(spacing: 14) {
                Image(systemName: "shippingbox.fill")
                  .font(.system(size: 18, weight: .bold))
                  .foregroundStyle(PrototypeTheme.vermilion)
                  .frame(width: 42, height: 42)
                  .background(
                    PrototypeTheme.vermilion.opacity(0.10),
                    in: RoundedRectangle(cornerRadius: 13)
                  )
                VStack(alignment: .leading, spacing: 3) {
                  Text("网页资源包导入")
                    .font(.system(.headline, design: .rounded, weight: .bold))
                  Text("从 package.zip 写入系统 Live Photo")
                    .font(.system(.caption, design: .rounded))
                    .foregroundStyle(.secondary)
                }
                Spacer()
                Image(systemName: "chevron.right")
                  .font(.caption.weight(.bold))
                  .foregroundStyle(.secondary)
              }
              .padding(16)
              .background(.white.opacity(0.76), in: RoundedRectangle(cornerRadius: 22))
            }
            .buttonStyle(.plain)
          }

          Text("原型模式 · 不会上传照片或产生生图费用")
            .font(.system(.caption2, design: .rounded, weight: .semibold))
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity)
            .padding(.top, 8)
        }
        .padding(20)
        .padding(.bottom, 30)
      }
    }
    .toolbar(.hidden, for: .navigationBar)
  }

  private var creditCard: some View {
    VStack(alignment: .leading, spacing: 18) {
      HStack {
        VStack(alignment: .leading, spacing: 5) {
          Text("FREE PREVIEW")
            .font(.system(.caption2, design: .monospaced, weight: .bold))
            .tracking(1.6)
            .foregroundStyle(.white.opacity(0.58))
          Text("8 次封面修复")
            .font(.system(.title2, design: .rounded, weight: .black))
            .foregroundStyle(.white)
        }
        Spacer()
        Image(systemName: "sparkles")
          .font(.system(size: 28, weight: .bold))
          .foregroundStyle(PrototypeTheme.vermilion)
      }

      ProgressView(value: 0.4)
        .tint(PrototypeTheme.vermilion)

      Text("先验证效果，再决定是否升级。")
        .font(.system(.caption, design: .rounded, weight: .semibold))
        .foregroundStyle(.white.opacity(0.68))
    }
    .padding(20)
    .background(PrototypeTheme.ink, in: RoundedRectangle(cornerRadius: 26))
  }

  private func settingRow(_ title: String, icon: String) -> some View {
    HStack(spacing: 14) {
      Image(systemName: icon)
        .foregroundStyle(PrototypeTheme.vermilion)
        .frame(width: 30)
      Text(title)
        .font(.system(.body, design: .rounded, weight: .semibold))
      Spacer()
      Image(systemName: "chevron.right")
        .font(.caption.weight(.bold))
        .foregroundStyle(.secondary)
    }
    .padding(.horizontal, 16)
    .padding(.vertical, 15)
  }
}

#Preview {
  NavigationStack {
    PrototypeProfileView()
  }
}
