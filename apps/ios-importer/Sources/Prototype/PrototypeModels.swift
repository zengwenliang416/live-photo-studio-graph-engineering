import SwiftUI

enum PrototypeTab: Hashable {
  case studio
  case library
  case profile
}

enum RepairPreset: String, CaseIterable, Identifiable, Sendable {
  case natural
  case glow
  case film
  case clean

  var id: String { rawValue }

  var title: String {
    switch self {
    case .natural: "自然救片"
    case .glow: "落日光感"
    case .film: "日系胶片"
    case .clean: "清透人像"
    }
  }

  var subtitle: String {
    switch self {
    case .natural: "只修表情与清晰度"
    case .glow: "暖光但不改变场景"
    case .film: "柔和颗粒与低饱和"
    case .clean: "提亮肤色与背景"
    }
  }

  var accent: Color {
    switch self {
    case .natural: PrototypeTheme.vermilion
    case .glow: Color(red: 0.96, green: 0.60, blue: 0.20)
    case .film: Color(red: 0.34, green: 0.49, blue: 0.42)
    case .clean: Color(red: 0.25, green: 0.53, blue: 0.68)
    }
  }
}

enum RepairPrototypePhase: Equatable {
  case diagnosed
  case configuring
  case generating
  case results
  case saved
}

@MainActor
@Observable
final class RepairPrototypeModel {
  var phase: RepairPrototypePhase = .diagnosed
  var selectedPreset: RepairPreset = .natural
  var selectedCandidate = 0
  var comparePosition = 0.48

  let detectedIssues = ["闭眼", "面部偏暗", "背景干扰"]

  func continueToStyles() {
    withAnimation(.spring(response: 0.38, dampingFraction: 0.92)) {
      phase = .configuring
    }
  }

  func generate() {
    phase = .generating
    Task {
      try? await Task.sleep(for: .seconds(1.45))
      guard !Task.isCancelled else { return }
      withAnimation(.spring(response: 0.42, dampingFraction: 0.9)) {
        phase = .results
      }
    }
  }

  func save() {
    withAnimation(.spring(response: 0.34, dampingFraction: 0.86)) {
      phase = .saved
    }
  }

  func startOver() {
    selectedPreset = .natural
    selectedCandidate = 0
    comparePosition = 0.48
    withAnimation(.spring(response: 0.38, dampingFraction: 0.92)) {
      phase = .diagnosed
    }
  }
}

enum PrototypeTheme {
  static let ink = Color(red: 0.07, green: 0.09, blue: 0.10)
  static let cream = Color(red: 0.97, green: 0.95, blue: 0.89)
  static let mist = Color(red: 0.90, green: 0.93, blue: 0.88)
  static let vermilion = Color(red: 0.94, green: 0.25, blue: 0.14)
  static let leaf = Color(red: 0.16, green: 0.47, blue: 0.32)
}
