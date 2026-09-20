import EvidenceCore
import SwiftUI

/// Tells the photographer where to stand, in the frame they are standing in.
struct CoverageStrip: View {
    @Bindable var model: CaptureSessionModel

    var body: some View {
        VStack(spacing: 10) {
            if !model.coverage.isTracking && model.coverage.isCalibrated {
                Chip(colour: .orange, icon: "arrow.triangle.2.circlepath",
                     text: "位置跟丢了，慢慢转一圈让手机重新认位置")
            } else if model.needsCalibration {
                calibration
            } else if let guidance = model.coverage.guidance {
                directions(guidance)
            }

            if let error = model.coverage.calibrationError {
                Chip(colour: .orange, icon: "exclamationmark.triangle", text: error)
            }
        }
        .padding(.horizontal, 16)
    }

    @ViewBuilder private var calibration: some View {
        switch model.coverage.capability {
        case .sceneReconstruction:
            VStack(spacing: 8) {
                Text("举着手机沿车走半圈，让它先认出这台车")
                    .font(.footnote)
                    .foregroundStyle(.white)
                Button("识别车辆") { model.calibrateFromMesh() }
                    .buttonStyle(.borderedProminent)
            }
            .padding(12)
            .background(.black.opacity(0.55), in: RoundedRectangle(cornerRadius: 14))

        case .visualInertial:
            // No depth sensor: the car gets marked by walking its length once.
            VStack(spacing: 8) {
                Text(model.pendingNose == nil
                     ? "这台手机没有深度传感器。站到车头正前方，贴近保险杠，点一下。"
                     : "现在走到车尾，同样贴近保险杠，点一下。")
                    .font(.footnote)
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.center)
                Button(model.pendingNose == nil ? "我在车头" : "我在车尾") {
                    if model.pendingNose == nil { model.markNose() } else { model.markTail() }
                }
                .buttonStyle(.borderedProminent)
            }
            .padding(12)
            .background(.black.opacity(0.55), in: RoundedRectangle(cornerRadius: 14))
        }
    }

    @ViewBuilder private func directions(_ guidance: CoverageGuidance) -> some View {
        if guidance.currentSlot?.id == model.currentSlot.id {
            Chip(colour: .green, icon: "checkmark.circle.fill", text: "位置对了")
        } else if let target = guidance.nextSlot {
            HStack(spacing: 10) {
                if let bearing = model.coverage.bearingToNextStation, abs(bearing) > 12 {
                    Image(systemName: bearing > 0 ? "arrow.right" : "arrow.left")
                        .font(.title2.bold())
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text("去「\(target.titleZH)」").font(.subheadline.bold())
                    if let hint = stepHint(guidance) {
                        Text(hint).font(.caption)
                    }
                }
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(.black.opacity(0.55), in: Capsule())
        }
    }

    /// Distance and height only. Which way to turn is the arrow's job, and
    /// saying it twice in two different frames of reference is how people end
    /// up walking the wrong way.
    private func stepHint(_ guidance: CoverageGuidance) -> String? {
        var parts: [String] = []
        if let distance = guidance.distanceChange, abs(distance) > 0.6 {
            parts.append(distance > 0 ? "退后 \(String(format: "%.1f", distance)) 米" : "靠近 \(String(format: "%.1f", -distance)) 米")
        }
        if let height = guidance.heightChange, abs(height) > 0.35 {
            parts.append(height > 0 ? "举高一点" : "蹲下来")
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}

private struct Chip: View {
    let colour: Color
    let icon: String
    let text: String

    var body: some View {
        Label(text, systemImage: icon)
            .font(.footnote.weight(.medium))
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(colour.opacity(0.92), in: Capsule())
            .foregroundStyle(colour == .green ? .white : .black)
            .multilineTextAlignment(.leading)
    }
}
