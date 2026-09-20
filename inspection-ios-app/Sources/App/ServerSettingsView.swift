import SwiftUI

/// Where this phone sends its archive.
///
/// A settings screen rather than a build-time constant: the fleet points at
/// its own server, a staging build points elsewhere, and a Turo host who buys
/// this app points at whatever they run. Hard-wiring one address would make
/// the first thing a new customer does be editing source.
struct ServerSettingsView: View {
    @Environment(ServerSettings.self) private var settings

    var body: some View {
        @Bindable var settings = settings
        Form {
            Section {
                TextField("https://tatocar.co", text: $settings.baseURL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
            } header: {
                Text("服务器地址")
            } footer: {
                Text("照片除了存相册交给 Turo，还会传一份到这里。手机丢了、删了，这一份还在。")
            }

            Section {
                TextField("工号", text: $settings.staffCode)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
            } header: {
                Text("工号")
            } footer: {
                Text("和排班用的是同一个工号。")
            }

            Section {
                HStack {
                    Text("登录状态")
                    Spacer()
                    Text(settings.isSignedIn ? "已登录" : "未登录")
                        .foregroundStyle(settings.isSignedIn ? .green : .secondary)
                }
                if settings.isSignedIn {
                    Button("退出登录", role: .destructive) { settings.token = nil }
                }
            } footer: {
                Text("第一次上传时会自动用工号登录，不用手动操作。")
            }
        }
        .navigationTitle("上传设置")
        .navigationBarTitleDisplayMode(.inline)
    }
}
