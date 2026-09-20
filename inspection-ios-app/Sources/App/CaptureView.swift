import AVFoundation
import EvidenceCore
import SwiftUI

/// The app.
///
/// Not *a screen in* the app — the app. It opens straight into the camera
/// with a session already running, and everything else is either an overlay on
/// this or a sheet that appears once the work is done. Nobody is asked
/// anything before they can take a photograph.
///
/// It is laid out like the iPhone's own camera, which is not decoration.
/// Every member of staff already knows where the shutter is, that the pill
/// under the frame switches lenses, that a tap focuses, and that the little
/// square in the corner is the last shot. Borrowing that layout means the
/// only thing left to learn is the diagram — and the diagram is the app.
struct CaptureView: View {
    @State private var model = CaptureSessionModel()
    @State private var showingFinish = false
    @State private var showingSettings = false
    @State private var focusPoint: CGPoint?
    @State private var focusGeneration = 0
    @State private var noticeGeneration = 0
    @State private var shutterBlink = false

    /// The viewfinder's shape, and the file's. `.photo` gives 4:3, so a frame
    /// of the same ratio means what is on the screen is what is in the file —
    /// no hidden margin, nothing cropped away that somebody thought they had
    /// photographed.
    private let frameAspect: CGFloat = 3.0 / 4.0

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            VStack(spacing: 0) {
                topBar
                viewfinder
                lensRow
                Spacer(minLength: 0)
                shutterRow
            }
        }
        .preferredColorScheme(.dark)
        .task { await model.begin() }
        .onDisappear { Task { await model.end() } }
        .onChange(of: model.outcome) { _, outcome in respond(to: outcome) }
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

    // MARK: - Top: flash, tally, settings

    private var topBar: some View {
        HStack {
            Button {
                model.flashMode = model.flashMode == .off ? .on : .off
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
            } label: {
                Image(systemName: model.flashMode == .off ? "bolt.slash.fill" : "bolt.fill")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(model.flashMode == .off ? .white : .black)
                    .frame(width: 32, height: 32)
                    .background(Circle().fill(model.flashMode == .off ? Color.white.opacity(0.14) : Color.yellow))
            }

            Spacer()

            HStack(spacing: 6) {
                Text("\(model.progress.totalShots) 张")
                if model.coverage.canMeasure && model.coverage.hasFrame {
                    Text("·")
                    Text("\(Int(model.progress.coverage * 100))%")
                }
            }
            .font(.system(size: 13, weight: .medium).monospacedDigit())
            .foregroundStyle(.white.opacity(0.85))

            Spacer()

            Button { showingSettings = true } label: {
                Image(systemName: "gearshape")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(.white.opacity(0.8))
                    .frame(width: 32, height: 32)
            }
        }
        .padding(.horizontal, 18)
        .frame(height: 46)
    }

    // MARK: - The frame itself

    private var viewfinder: some View {
        CameraPreview(
            session: model.camera.session,
            onFocusTap: { device, view in focus(devicePoint: device, viewPoint: view) }
        )
            .aspectRatio(frameAspect, contentMode: .fit)
            .frame(maxWidth: .infinity)
            .clipped()
            .overlay(alignment: .topLeading) { diagram }
            .overlay(alignment: .bottom) { hud }
            .overlay { focusSquare }
            .overlay { Color.black.opacity(shutterBlink ? 1 : 0).allowsHitTesting(false) }
    }

    @ViewBuilder private var diagram: some View {
        if model.coverage.canMeasure {
            CoverageDiagram(coverage: model.coverage.coverage, isLive: model.coverage.hasFrame)
                .frame(width: 52, height: 82)
                .padding(12)
                .allowsHitTesting(false)
        }
    }

    /// One line of instruction, whatever warnings are worth interrupting for,
    /// and — when the gate has just turned a photograph down — the reason.
    @ViewBuilder private var hud: some View {
        VStack(spacing: 8) {
            if !model.location.isReady {
                Chip(icon: "location.slash.fill", text: "定位未就绪 —— 没有位置的照片 Turo 判无效")
            }
            if !model.steadiness.isSteady {
                Chip(icon: "hand.raised.fill", text: "手机在晃，稳一下再拍")
            }

            if hasNotice {
                notice
            } else {
                Text(model.progress.instruction)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .background(Capsule().fill(.black.opacity(0.45)))
            }
        }
        .padding(.horizontal, 14)
        .padding(.bottom, 14)
        .animation(.easeOut(duration: 0.2), value: model.outcome)
    }

    @ViewBuilder private var focusSquare: some View {
        if let focusPoint {
            FocusSquare()
                .position(focusPoint)
                .id(focusGeneration)
                .allowsHitTesting(false)
        }
    }

    // MARK: - Lenses

    /// The iPhone's zoom pill, with the two lenses this app actually uses.
    ///
    /// There is no pinch-to-zoom and no 2×: digital zoom is a crop of the
    /// same sensor, so it throws away the pixels a claim assessor would use
    /// to see the scratch while telling the coverage maths a narrower story.
    /// Two real lenses, nothing in between.
    @ViewBuilder private var lensRow: some View {
        if model.lenses.count > 1 {
            HStack(spacing: 4) {
                ForEach(model.lenses) { lens in
                    let selected = lens == model.lens
                    Button {
                        UIImpactFeedbackGenerator(style: .light).impactOccurred()
                        Task { await model.select(lens: lens) }
                    } label: {
                        Text(lens.label(selected: selected))
                            .font(.system(size: selected ? 14 : 12, weight: .semibold))
                            .foregroundStyle(selected ? Color.yellow : .white)
                            .frame(width: selected ? 40 : 34, height: selected ? 40 : 34)
                            .background(Circle().fill(.black.opacity(selected ? 0.5 : 0)))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(4)
            .background(Capsule().fill(.white.opacity(0.12)))
            .animation(.easeOut(duration: 0.15), value: model.lens)
            .padding(.top, 14)
        }
    }

    // MARK: - Bottom: last shot, shutter, and the way out

    private var shutterRow: some View {
        HStack {
            thumbnail
                .frame(width: 60, alignment: .leading)

            Spacer()

            Button(action: fire) {
                ZStack {
                    Circle()
                        .stroke(canShoot ? Color.white : Self.shutterDark, lineWidth: 3.5)
                        .frame(width: 74, height: 74)
                    Circle()
                        .fill(canShoot ? Color.white : Self.shutterDark)
                        .frame(width: 62, height: 62)
                        .scaleEffect(model.isCapturing ? 0.86 : 1)
                        .opacity(model.isCapturing ? 0.6 : 1)
                }
            }
            .buttonStyle(.plain)
            .disabled(!canShoot)
            .animation(.easeOut(duration: 0.12), value: canShoot)
            .animation(.easeOut(duration: 0.12), value: model.isCapturing)

            Spacer()

            // Appears only once the floors are met. Before that there is
            // nothing to press, which is the least ambiguous way to say
            // "keep going".
            Group {
                if model.progress.canFinish {
                    Button("完成") { showingFinish = true }
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(.black)
                        .padding(.horizontal, 15)
                        .padding(.vertical, 9)
                        .background(Capsule().fill(.white))
                }
            }
            .frame(width: 60, alignment: .trailing)
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 22)
        .animation(.easeOut(duration: 0.25), value: model.progress.canFinish)
    }

    /// Grey, and not pressable, while the phone is moving enough to blur.
    ///
    /// Stopping the shot here costs nothing; stopping it afterwards costs a
    /// retake, and a retake costs photographs. What makes this safe to do at
    /// all is how quickly it lets go again — see `SteadinessGate`, which is
    /// built to be reluctant to close and eager to open, and has a test
    /// holding it to a 200ms recovery. A shutter that hesitates is worse
    /// than one that occasionally passes a soft frame to the quality gate.
    private var canShoot: Bool { model.steadiness.isSteady && !model.isCapturing }

    /// Grey rather than a dimmed white: dimming reads as "the screen is
    /// asleep", grey reads as "this button is off".
    private static let shutterDark = Color(white: 0.4)

    private var thumbnail: some View {
        Group {
            if let image = model.lastThumbnail {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                Color.white.opacity(0.07)
            }
        }
        .frame(width: 48, height: 48)
        .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 7, style: .continuous)
                .stroke(.white.opacity(0.45), lineWidth: 0.7)
        )
    }

    // MARK: - What just happened

    /// True only for the outcomes worth taking the instruction line away
    /// for. An accepted photograph is dismissed the instant it arrives, so
    /// it never reaches here.
    private var hasNotice: Bool {
        switch model.outcome {
        case .rejected, .failed: return true
        case .accepted, .none: return false
        }
    }

    /// Only shown when something went wrong.
    ///
    /// A photograph the gate liked gets no announcement at all: the shutter
    /// blinks, the thumbnail changes, and the next one can be taken
    /// immediately. Anything that has to be dismissed after every shot costs
    /// photographs, and more photographs is the entire point.
    @ViewBuilder private var notice: some View {
        switch model.outcome {
        case .rejected(let record):
            NoticeBar(
                icon: "exclamationmark.triangle.fill",
                tint: .orange,
                text: describe(record.quality.issues),
                onOverride: overrideAction
            )
        case .failed(let message):
            NoticeBar(icon: "xmark.octagon.fill", tint: .red, text: message)
        case .accepted, .none:
            EmptyView()
        }
    }

    /// Offered only once the camera has been given a fair chance and has
    /// said the same thing three times running.
    ///
    /// ⚠️ Kept as its own property rather than written inline as
    /// `model.mayOverride ? ("仍然使用", { ... }) : nil`. That shape -- a
    /// ternary producing an optional tuple with a closure in it -- segfaults
    /// the Swift 6.3 type checker rather than failing to compile.
    @MainActor
    private var overrideAction: (() -> Void)? {
        guard model.mayOverride else { return nil }
        return { Task { await model.acceptAnyway() } }
    }

    // MARK: - Actions

    private func fire() {
        guard canShoot else { return }
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        shutterBlink = true
        Task {
            try? await Task.sleep(for: .milliseconds(55))
            withAnimation(.easeOut(duration: 0.16)) { shutterBlink = false }
        }
        Task { await model.capture() }
    }

    private func focus(devicePoint: CGPoint, viewPoint: CGPoint) {
        model.camera.focus(at: devicePoint)
        focusGeneration += 1
        let generation = focusGeneration
        withAnimation(.easeOut(duration: 0.12)) { focusPoint = viewPoint }
        Task {
            try? await Task.sleep(for: .seconds(1.3))
            guard focusGeneration == generation else { return }
            withAnimation(.easeIn(duration: 0.3)) { focusPoint = nil }
        }
    }

    private func respond(to outcome: CaptureSessionModel.Outcome?) {
        guard let outcome else { return }
        switch outcome {
        case .accepted:
            UIImpactFeedbackGenerator(style: .rigid).impactOccurred()
            model.dismissOutcome()
        case .rejected, .failed:
            UINotificationFeedbackGenerator().notificationOccurred(.warning)
            noticeGeneration += 1
            let generation = noticeGeneration
            Task {
                try? await Task.sleep(for: .seconds(5))
                guard noticeGeneration == generation else { return }
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
        return names.isEmpty ? "这张需要重拍" : names.joined(separator: "、") + " —— 这张不算"
    }
}

/// The iPhone's focus reticle: lands slightly large, settles, fades.
private struct FocusSquare: View {
    @State private var scale: CGFloat = 1.4
    @State private var opacity: Double = 0.4

    var body: some View {
        RoundedRectangle(cornerRadius: 4)
            .stroke(Color.yellow, lineWidth: 1.2)
            .frame(width: 74, height: 74)
            .scaleEffect(scale)
            .opacity(opacity)
            .shadow(color: .black.opacity(0.4), radius: 2)
            .onAppear {
                withAnimation(.spring(response: 0.32, dampingFraction: 0.72)) { scale = 1 }
                withAnimation(.easeOut(duration: 0.15)) { opacity = 1 }
            }
    }
}

private struct Chip: View {
    let icon: String
    let text: String

    var body: some View {
        Label(text, systemImage: icon)
            .font(.system(size: 12, weight: .semibold))
            .padding(.horizontal, 11)
            .padding(.vertical, 6)
            .background(Capsule().fill(Color.yellow.opacity(0.94)))
            .foregroundStyle(.black)
    }
}

/// What the gate made of a shot it turned down.
private struct NoticeBar: View {
    let icon: String
    let tint: Color
    let text: String
    var onOverride: (() -> Void)?

    var body: some View {
        HStack(spacing: 9) {
            Image(systemName: icon)
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(tint)
            Text(text)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(.white)
                .fixedSize(horizontal: false, vertical: true)
            if let onOverride {
                Button("仍然使用", action: onOverride)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.black)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(Capsule().fill(.white))
            }
        }
        .padding(.horizontal, 13)
        .padding(.vertical, 9)
        .background(Capsule().fill(.black.opacity(0.7)))
        .transition(.opacity.combined(with: .move(edge: .bottom)))
    }
}
