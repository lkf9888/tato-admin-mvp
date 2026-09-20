import AVFoundation
import EvidenceCore
import SwiftUI

struct CaptureView: View {
    let vehicleLabel: String
    let staffLabel: String
    let kind: SessionKind

    @State private var model = CaptureSessionModel()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack {
            CameraPreview(session: model.camera.session)
                .ignoresSafeArea()

            VStack(spacing: 0) {
                header
                CoverageStrip(model: model).padding(.top, 12)
                Spacer()
                warnings
                controls
            }
        }
        .task {
            await model.begin(vehicleLabel: vehicleLabel, staffLabel: staffLabel, kind: kind)
        }
        .onDisappear { Task { await model.end() } }
        // `sheet(item:)` rather than a constant binding, so SwiftUI and the
        // model cannot end up disagreeing about whether the sheet is up.
        .sheet(item: Binding(get: { model.outcome }, set: { if $0 == nil { model.dismissOutcome() } })) { outcome in
            OutcomeSheet(model: model, outcome: outcome)
                .presentationDetents([.height(280)])
                .presentationDragIndicator(.hidden)
                .interactiveDismissDisabled()
        }
        .alert(
            "相机打不开",
            isPresented: Binding(get: { model.startupError != nil }, set: { if !$0 { model.clearStartupError() } })
        ) {
            Button("返回") { dismiss() }
        } message: {
            Text(model.startupError ?? "")
        }
    }

    private var header: some View {
        VStack(spacing: 6) {
            Text(model.currentSlot.titleZH)
                .font(.title2.bold())
            Text(model.currentSlot.guidanceZH)
                .font(.subheadline)
                .multilineTextAlignment(.center)
            Text("\(model.completedCount) / \(model.plan.count)")
                .font(.caption.monospacedDigit())
                .foregroundStyle(.secondary)
        }
        .foregroundStyle(.white)
        .padding()
        .frame(maxWidth: .infinity)
        .background(.black.opacity(0.45))
    }

    /// Both of these are worth saying *before* the shutter, while the person
    /// is still standing in the right place.
    @ViewBuilder private var warnings: some View {
        VStack(spacing: 8) {
            if !model.location.isReady {
                WarningChip(
                    icon: "location.slash",
                    text: "定位未就绪 —— 没有位置信息的照片 Turo 会判无效"
                )
            }
            if !model.steadiness.isSteady {
                WarningChip(icon: "hand.raised", text: "手机在晃，稳一下再拍")
            }
        }
        .padding(.bottom, 12)
    }

    private var controls: some View {
        HStack {
            Button {
                model.flashMode = model.flashMode == .off ? .on : .off
            } label: {
                Image(systemName: model.flashMode == .off ? "bolt.slash" : "bolt.fill")
                    .font(.title2)
                    .frame(width: 56, height: 56)
            }

            Spacer()

            Button {
                Task { await model.capture() }
            } label: {
                Circle()
                    .strokeBorder(.white, lineWidth: 4)
                    .frame(width: 76, height: 76)
                    .overlay(Circle().fill(.white).frame(width: 62, height: 62))
                    .opacity(model.isCapturing ? 0.4 : 1)
            }
            .disabled(model.isCapturing)

            Spacer()

            NavigationLink {
                SummaryView(model: model)
            } label: {
                Text("完成").frame(width: 56, height: 56)
            }
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 24)
        .padding(.bottom, 24)
        .background(.black.opacity(0.45))
    }
}

private struct WarningChip: View {
    let icon: String
    let text: String

    var body: some View {
        Label(text, systemImage: icon)
            .font(.footnote.weight(.medium))
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(.yellow.opacity(0.9), in: Capsule())
            .foregroundStyle(.black)
    }
}

/// What the gate made of the shot, and what to do about it.
private struct OutcomeSheet: View {
    @Bindable var model: CaptureSessionModel
    let outcome: CaptureSessionModel.Outcome

    var body: some View {
        VStack(spacing: 16) {
            switch outcome {
            case .accepted(let record):
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 44))
                    .foregroundStyle(.green)
                Text("这张可以")
                    .font(.title3.bold())
                if !record.evidence.isClaimReady {
                    Text(gapDescription(record.evidence.gaps))
                        .font(.footnote)
                        .foregroundStyle(.orange)
                        .multilineTextAlignment(.center)
                }
                Button("下一张") { model.advance() }
                    .buttonStyle(.borderedProminent)

            case .rejected(let record):
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 44))
                    .foregroundStyle(.orange)
                Text(issueDescription(record.quality.issues))
                    .font(.title3.bold())
                    .multilineTextAlignment(.center)
                HStack {
                    Button("重拍") { model.dismissOutcome() }
                        .buttonStyle(.borderedProminent)
                    if model.mayOverride {
                        Button("仍然使用") { Task { await model.acceptAnyway() } }
                    }
                }

            case .failed(let message):
                Text("拍摄失败")
                    .font(.title3.bold())
                Text(message)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                Button("重试") { model.dismissOutcome() }
                    .buttonStyle(.borderedProminent)

            }
        }
        .padding(24)
    }

    private func issueDescription(_ issues: [ImageQualityIssue]) -> String {
        let names = issues.map { issue -> String in
            switch issue {
            case .blurry: return "糊了"
            case .overexposed: return "过曝"
            case .underexposed: return "太暗"
            case .lowContrast: return "画面太平，像是没对上车"
            }
        }
        return names.isEmpty ? "需要重拍" : names.joined(separator: "、")
    }

    private func gapDescription(_ gaps: [EvidenceGap]) -> String {
        gaps.contains(.noLocation)
            ? "这张没有位置信息。交单前要到室外补拍，否则 Turo 会判无效。"
            : "元数据不完整，交单前请复查。"
    }
}
