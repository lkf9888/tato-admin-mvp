import EvidenceCore
import SwiftUI

/// Where a session starts: which car, which end of the trip, and the list of
/// what is about to be asked for.
struct ShotPlanView: View {
    @State private var vehicleLabel = ""
    @State private var staffLabel = ""
    @State private var kind: SessionKind = .checkout

    private var canStart: Bool {
        !vehicleLabel.trimmingCharacters(in: .whitespaces).isEmpty
            && !staffLabel.trimmingCharacters(in: .whitespaces).isEmpty
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("这趟拍什么车") {
                    TextField("车牌", text: $vehicleLabel)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                    TextField("拍照人", text: $staffLabel)
                    Picker("类型", selection: $kind) {
                        Text("交车").tag(SessionKind.checkout)
                        Text("还车").tag(SessionKind.checkin)
                    }
                    .pickerStyle(.segmented)
                }

                Section {
                    NavigationLink {
                        CaptureView(
                            vehicleLabel: vehicleLabel.trimmingCharacters(in: .whitespaces),
                            staffLabel: staffLabel.trimmingCharacters(in: .whitespaces),
                            kind: kind
                        )
                        .navigationBarBackButtonHidden()
                    } label: {
                        Label("开始拍照（\(ShotPlan.standard.count) 张）", systemImage: "camera.fill")
                    }
                    .disabled(!canStart)
                } footer: {
                    Text("Turo 要求外观至少 15 张、内饰至少 8 张，"
                         + "并且会把没有日期、时间或位置元数据的照片直接判为无效。")
                }

                Section {
                    NavigationLink {
                        PathCheckView()
                    } label: {
                        Label("路径自检", systemImage: "checkmark.seal")
                    }
                    NavigationLink {
                        ServerSettingsView()
                    } label: {
                        Label("上传设置", systemImage: "externaldrive.badge.icloud")
                    }
                } footer: {
                    Text("交单前先用这个验一遍：从相册选一张，当场告诉你位置信息还在不在、"
                         + "是不是还是相机原件。换了手机或者升级了系统，重新验一次。")
                }

                ForEach(ShotGroup.allCases, id: \.self) { group in
                    Section(group == .exterior ? "外观 \(ShotPlan.exterior.count) 张" : "内饰 \(ShotPlan.interior.count) 张") {
                        ForEach(group == .exterior ? ShotPlan.exterior : ShotPlan.interior) { slot in
                            SlotRow(slot: slot)
                        }
                    }
                }
            }
            .navigationTitle("车况存证")
        }
    }
}

private struct SlotRow: View {
    let slot: ShotSlot

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(slot.titleZH)
                Spacer()
                if slot.handsFree {
                    Image(systemName: "waveform")
                        .foregroundStyle(.secondary)
                        .accessibilityLabel("语音引导")
                }
                if slot.requiresLegibleText {
                    Image(systemName: "textformat.123")
                        .foregroundStyle(.secondary)
                        .accessibilityLabel("数字必须清楚")
                }
            }
            Text(slot.guidanceZH)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 2)
    }
}
