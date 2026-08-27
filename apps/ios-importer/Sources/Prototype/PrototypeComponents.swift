import SwiftUI

struct PrototypePageBackground: View {
  var body: some View {
    LinearGradient(
      colors: [PrototypeTheme.cream, PrototypeTheme.mist],
      startPoint: .topLeading,
      endPoint: .bottomTrailing
    )
    .ignoresSafeArea()
  }
}

struct PrototypePrimaryButton: View {
  let title: String
  let systemImage: String
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      Label(title, systemImage: systemImage)
        .font(.system(.headline, design: .rounded, weight: .bold))
        .frame(maxWidth: .infinity)
        .padding(.vertical, 16)
    }
    .buttonStyle(PrototypePrimaryButtonStyle())
  }
}

struct PrototypePrimaryButtonStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .foregroundStyle(.white)
      .background(
        configuration.isPressed
          ? PrototypeTheme.vermilion.opacity(0.78)
          : PrototypeTheme.vermilion,
        in: RoundedRectangle(cornerRadius: 19, style: .continuous)
      )
      .scaleEffect(configuration.isPressed ? 0.98 : 1)
      .animation(.spring(response: 0.22, dampingFraction: 0.86), value: configuration.isPressed)
  }
}

struct LivePhotoScene: View {
  enum Variant: Sendable {
    case original
    case natural
    case glow
    case film
    case clean

    var background: [Color] {
      switch self {
      case .original:
        [
          Color(red: 0.34, green: 0.43, blue: 0.42),
          Color(red: 0.53, green: 0.49, blue: 0.39),
        ]
      case .natural:
        [
          Color(red: 0.50, green: 0.66, blue: 0.66),
          Color(red: 0.82, green: 0.68, blue: 0.46),
        ]
      case .glow:
        [
          Color(red: 0.72, green: 0.45, blue: 0.39),
          Color(red: 0.98, green: 0.70, blue: 0.34),
        ]
      case .film:
        [
          Color(red: 0.35, green: 0.49, blue: 0.42),
          Color(red: 0.72, green: 0.63, blue: 0.45),
        ]
      case .clean:
        [
          Color(red: 0.52, green: 0.72, blue: 0.78),
          Color(red: 0.80, green: 0.82, blue: 0.65),
        ]
      }
    }

    var isOriginal: Bool { self == .original }
  }

  let variant: Variant
  var showsLiveBadge = true

  var body: some View {
    GeometryReader { proxy in
      let size = proxy.size
      ZStack {
        LinearGradient(
          colors: variant.background,
          startPoint: .topLeading,
          endPoint: .bottomTrailing
        )

        Circle()
          .fill(.white.opacity(variant == .glow ? 0.55 : 0.30))
          .frame(width: size.width * 0.42)
          .blur(radius: 3)
          .offset(x: size.width * 0.28, y: -size.height * 0.28)

        RoundedRectangle(cornerRadius: size.width * 0.16)
          .fill(Color.black.opacity(0.13))
          .frame(width: size.width * 0.95, height: size.height * 0.36)
          .rotationEffect(.degrees(-8))
          .offset(x: -size.width * 0.20, y: size.height * 0.37)

        portrait(in: size)

        if variant.isOriginal {
          RoundedRectangle(cornerRadius: 8)
            .fill(Color.black.opacity(0.16))
            .frame(width: size.width * 0.20, height: size.height * 0.50)
            .blur(radius: 2)
            .offset(x: size.width * 0.39)
        }

        LinearGradient(
          colors: [.clear, .black.opacity(0.34)],
          startPoint: .center,
          endPoint: .bottom
        )

        if showsLiveBadge {
          VStack {
            HStack {
              Label("LIVE", systemImage: "livephoto")
                .font(.system(.caption2, design: .rounded, weight: .bold))
                .padding(.horizontal, 10)
                .padding(.vertical, 7)
                .background(.ultraThinMaterial, in: Capsule())
              Spacer()
            }
            Spacer()
          }
          .padding(14)
        }
      }
      .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
    }
    .aspectRatio(0.78, contentMode: .fit)
    .accessibilityLabel(variant.isOriginal ? "待修复的实况照片封面" : "AI 修复后的实况照片封面")
  }

  @ViewBuilder
  private func portrait(in size: CGSize) -> some View {
    let skin = Color(red: 0.86, green: 0.67, blue: 0.53)
    ZStack {
      Capsule()
        .fill(Color(red: 0.78, green: 0.18, blue: 0.13))
        .frame(width: size.width * 0.42, height: size.height * 0.47)
        .offset(y: size.height * 0.28)

      Circle()
        .fill(Color(red: 0.15, green: 0.11, blue: 0.09))
        .frame(width: size.width * 0.40)
        .offset(y: -size.height * 0.08)

      Circle()
        .fill(skin)
        .frame(width: size.width * 0.31)
        .offset(y: -size.height * 0.05)
        .overlay {
          HStack(spacing: size.width * 0.08) {
            eye
            eye
          }
          .offset(y: -size.height * 0.05)
        }

      Capsule()
        .fill(Color.white.opacity(0.92))
        .frame(width: size.width * 0.07, height: 3)
        .offset(y: size.height * 0.01)
    }
    .offset(y: size.height * 0.02)
  }

  @ViewBuilder
  private var eye: some View {
    if variant.isOriginal {
      Capsule()
        .fill(PrototypeTheme.ink.opacity(0.8))
        .frame(width: 14, height: 2)
    } else {
      Circle()
        .fill(PrototypeTheme.ink.opacity(0.86))
        .frame(width: 5, height: 5)
    }
  }
}

struct SectionEyebrow: View {
  let text: String

  var body: some View {
    Text(text.uppercased())
      .font(.system(.caption2, design: .monospaced, weight: .bold))
      .tracking(1.8)
      .foregroundStyle(.secondary)
  }
}
