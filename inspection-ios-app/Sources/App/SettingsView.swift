import SwiftUI

/// Everything that is not taking a photograph, behind one gear.
///
/// Deliberately out of the way: a staff member who never opens this should
/// still be able to do the whole job.
struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss
    let coverage: CoverageTracker

    var body: some View {
        List {
            // Says something in every state, including the healthy one. A
            // screen that only speaks up when there is trouble cannot be
            // used to confirm there is none -- silence would be
            // indistinguishable from a check that was never wired up.
            Section {
                LabeledContent("状态", value: coverage.status)
            } header: {
                Text("车形图")
            } footer: {
                Text("车形图靠 ARKit 的空间追踪画出来，而它和拍照用的是同一颗后置摄像头。"
                     + "如果这里写「摄像头被拍照占用」，说明两者在抢，车形图不会填色 —— "
                     + "照片照拍不误，只是完整度要靠张数判断。")
            }

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
