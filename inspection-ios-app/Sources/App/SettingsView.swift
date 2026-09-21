import SwiftUI

/// Everything that is not taking a photograph, behind one gear.
///
/// Deliberately out of the way: a staff member who never opens this should
/// still be able to do the whole job.
struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss
    let coverage: CoverageTracker
    let lastStillSize: String?

    var body: some View {
        List {
            // Says something in every state, including the healthy one. A
            // screen that only speaks up when there is trouble cannot be
            // used to confirm there is none -- silence would be
            // indistinguishable from a check that was never wired up.
            Section {
                LabeledContent("状态", value: coverage.status)
                LabeledContent("画面格式", value: coverage.videoFormatSummary)
                LabeledContent("上一张照片", value: lastStillSize ?? "还没拍")
            } header: {
                Text("相机")
            } footer: {
                Text("照片和车形图都出自同一个 ARKit 会话 —— 它们抢不起来，因为只有一个。"
                     + "「画面格式」决定了照片的分辨率：写着「支持高分辨率取帧」时照片比画面大，"
                     + "没写就是画面多大照片多大。这里持续写「停了」才需要管，"
                     + "那时照片照拍不误，只是完整度要靠张数判断。")
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
