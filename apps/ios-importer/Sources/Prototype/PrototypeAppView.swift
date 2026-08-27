import SwiftUI

struct PrototypeAppView: View {
  @State private var selectedTab: PrototypeTab = .studio

  var body: some View {
    TabView(selection: $selectedTab) {
      NavigationStack {
        StudioHomeView()
      }
      .tabItem {
        Label("救片", systemImage: "livephoto")
      }
      .tag(PrototypeTab.studio)

      NavigationStack {
        PrototypeLibraryView()
      }
      .tabItem {
        Label("作品", systemImage: "square.stack.3d.up.fill")
      }
      .tag(PrototypeTab.library)

      NavigationStack {
        PrototypeProfileView()
      }
      .tabItem {
        Label("我的", systemImage: "person.crop.circle")
      }
      .tag(PrototypeTab.profile)
    }
    .tint(PrototypeTheme.vermilion)
    .preferredColorScheme(.light)
  }
}

#Preview {
  PrototypeAppView()
}
