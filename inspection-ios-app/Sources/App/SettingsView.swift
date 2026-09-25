import SwiftUI

/// Everything that is not taking a photograph, behind one gear.
///
/// Deliberately out of the way: a staff member who never opens this should
/// still be able to do the whole job.
struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss
    let model: CaptureSessionModel

    var body: some View {
        List {
            // Says something in every state, including the healthy one. A
            // screen that only speaks up when there is trouble cannot be
            // used to confirm there is none -- silence would be
            // indistinguishable from a check that was never wired up.
            Section {
                LabeledContent("镜头", value: model.lens == .ultraWide ? "0.5×" : "1×")
                LabeledContent("上一张照片", value: model.lastStillSize ?? "还没拍")
                if model.offersHighResolution {
                    Toggle("4800 万像素", isOn: Binding(
                        get: { model.resolution == .high },
                        set: { high in Task { await model.setResolution(high ? .high : .standard) } }
                    ))
                }
                LabeledContent("相册", value: model.library.summary)
            } header: {
                Text("相机")
            } footer: {
                Text("默认 1200 万像素，已经足够看清划痕。4800 万像素的文件大约是它的四倍，"
                     + "每张处理更慢，暗处噪点更多 —— 光线好、需要放大细节时再开。"
                     + "只影响主摄；0.5× 在大多数手机上本来就是 1200 万。")
            }

            Section {
                LabeledContent("方向传感器", value: headingStatus)
                LabeledContent("绕车角度", value: "\(Int(model.headings.fraction * 100))%")
            } header: {
                Text("绕车")
            } footer: {
                Text("靠陀螺仪记录每张照片是朝哪个方向拍的，只用来提示「往哪边走还没拍」，"
                     + "不会拦下任何一张照片，也不会拦着你交单。"
                     + "它看不见车本身，所以原地转一圈也会被当成绕了一圈 —— 这是有意的取舍。")
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

    private var headingStatus: String {
        guard model.steadiness.canTellHeading else { return "这台手机没有" }
        guard let heading = model.steadiness.heading else { return "还没读到" }
        return "正常 · 朝 \(Int(heading.rounded()))°"
    }
}
