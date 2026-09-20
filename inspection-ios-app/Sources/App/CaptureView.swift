import AVFoundation
import EvidenceCore
import SwiftUI

/// The app.
///
/// Not *a screen in* the app — the app. It opens straight into the camera
/// with a session already running, and everything else is either an overlay on
/// this or a sheet that appears once the work is done. Nobody is asked
/// anything before they can take a photograph.
struct CaptureView: View {
    @State private var model = CaptureSessionModel()
    @State private var showingFinish = false
    @State private var showingSettings = false

    var body: some View {
        ZStack {
            CameraPreview(session: model.camera.session)
                .ignoresSafeArea()

            VStack(spacing: 0) {
                topBar
                Spacer()
                warnings
                controls
            }
        }
        .task { await model.begin() }
        .onDisappear { Task { await model.end() } }
        .sheet(item: Binding(get: { model.outcome }, set: { if $0 == nil { model.dismissOutcome() } })) { outcome in
            OutcomeSheet(model: model, outcome: outcome)
                .presentationDetents([.height(260)])
                .interactiveDismissDisabled()
        }
        .sheet(isPresented: $showingFinish) {
            FinishView(model: model)
        }
        .sheet(isPresented: $showingSettings) {
            NavigationStack { SettingsView() }
        }
        .alert(
            "相机打不开",
            isPresented: Binding(get: { model.startupError != nil }, set: { if !$0 { model.clearStartupError() } })
        ) {
            Button("好") {}
        } message: {
            Text(model.startupError ?? "")
        }
    }

    // MARK: - Top: the car, and the one instruction

    private var topBar: some View {
        HStack(alignment: .top, spacing: 14) {
            if model.coverage.canMeasure {
                CoverageDiagram(coverage: model.coverage.coverage, isLive: model.coverage.hasFrame)
                    .frame(width: 58, height: 92)
            }

            VStack(alignment: .leading, spacing: 5) {
                Text(model.progress.instruction)
                    .font(.headline)
                    .foregroundStyle(.white)
                    .fixedSize(horizontal: false, vertical: true)

                HStack(spacing: 10) {
                    Text("已拍 \(model.progress.totalShots) 张")
                    if model.coverage.canMeasure && model.coverage.hasFrame {
                        Text("覆盖 \(Int(model.progress.coverage * 100))%")
                    }
                }
                .font(.caption.monospacedDigit())
                .foregroundStyle(.white.opacity(0.75))
            }

            Spacer(minLength: 0)

            Button { showingSettings = true } label: {
                Image(systemName: "gearshape")
                    .font(.title3)
                    .foregroundStyle(.white.opacity(0.7))
                    .frame(width: 40, height: 40)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(.black.opacity(0.45))
    }

    // MARK: - Things worth saying before the shutter

    @ViewBuilder private var warnings: some View {
        VStack(spacing: 8) {
            if !model.location.isReady {
                Chip(icon: "location.slash", text: "定位未就绪 —— 没有位置信息的照片 Turo 会判无效")
            }
            if !model.steadiness.isSteady {
                Chip(icon: "hand.raised", text: "手机在晃，稳一下再拍")
            }
        }
        .padding(.bottom, 12)
    }

    // MARK: - Bottom: a shutter, and nothing else until it is earned

    private var controls: some View {
        HStack {
            Button {
                model.flashMode = model.flashMode == .off ? .on : .off
            } label: {
                Image(systemName: model.flashMode == .off ? "bolt.slash" : "bolt.fill")
                    .font(.title2)
                    .frame(width: 60, height: 60)
            }

            Spacer()

            Button {
                Task { await model.capture() }
            } label: {
                Circle()
                    .strokeBorder(.white, lineWidth: 4)
                    .frame(width: 78, height: 78)
                    .overlay(Circle().fill(.white).frame(width: 64, height: 64))
                    .opacity(model.isCapturing ? 0.4 : 1)
            }
            .disabled(model.isCapturing)

            Spacer()

            // Appears only once the floors are met. Before that there is
            // nothing to press, which is the least ambiguous way to say
            // "keep going".
            if model.progress.canFinish {
                Button("完成") { showingFinish = true }
                    .font(.headline)
                    .foregroundStyle(.black)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 9)
                    .background(.white, in: Capsule())
                    .frame(width: 60)
            } else {
                Color.clear.frame(width: 60, height: 60)
            }
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 20)
        .padding(.bottom, 20)
        .padding(.top, 8)
        .background(.black.opacity(0.45))
    }
}

private struct Chip: View {
    let icon: String
    let text: String

    var body: some View {
        Label(text, systemImage: icon)
            .font(.footnote.weight(.medium))
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(.yellow.opacity(0.92), in: Capsule())
            .foregroundStyle(.black)
            .padding(.horizontal, 16)
    }
}

/// What the gate made of the shot.
///
/// Passing says nothing and disappears on its own — a photographer who has to
/// dismiss a confirmation after every photograph takes fewer photographs, and
/// more photographs is the whole point.
private struct OutcomeSheet: View {
    @Bindable var model: CaptureSessionModel
    let outcome: CaptureSessionModel.Outcome

    var body: some View {
        VStack(spacing: 16) {
            switch outcome {
            case .accepted:
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 40))
                    .foregroundStyle(.green)
                Text("这张可以").font(.title3.bold())
                Button("继续") { model.dismissOutcome() }
                    .buttonStyle(.borderedProminent)

            case .rejected(let record):
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 40))
                    .foregroundStyle(.orange)
                Text(describe(record.quality.issues))
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
                Text("这张没拍成").font(.title3.bold())
                Text(message).font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.center)
                Button("再来") { model.dismissOutcome() }
                    .buttonStyle(.borderedProminent)
            }
        }
        .padding(24)
        .task {
            // A good photograph needs no acknowledgement.
            if case .accepted = outcome {
                try? await Task.sleep(for: .milliseconds(700))
                model.dismissOutcome()
            }
        }
    }

    private func describe(_ issues: [ImageQualityIssue]) -> String {
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
}
