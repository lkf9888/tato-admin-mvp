import SwiftUI

/// Everything that is not taking a photograph, behind one gear.
///
/// Deliberately out of the way: a staff member who never opens this should
/// still be able to do the whole job.
struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        List {
            Section {
                NavigationLink { ServerSettingsView() } label: {
                    Label("上传设置", systemImage: "externaldrive.badge.icloud")
                }
                NavigationLink { PathCheckView() } label: {
                    Label("路径自检", systemImage: "checkmark.seal")
                }
            } footer: {
                Text("交单前可以用「路径自检」验一遍：从相册选一张，当场告诉你位置信息还在不在、"
                     + "是不是还是相机原件。换了手机或者升级了系统，重新验一次。")
            }
        }
        .navigationTitle("设置")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) { Button("完成") { dismiss() } }
        }
    }
}
