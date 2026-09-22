import EvidenceCore
import SwiftUI

/// The car from above, painted as it gets photographed.
///
/// Small on purpose — it lives in the corner of a viewfinder and has to be
/// readable in the half second between two photographs. It answers one
/// question, "which way do I still have to go", and hands the detail to
/// `CoverageSheet` when somebody taps it.
///
/// Drawn as a car rather than as a ring of wedges because a ring has no
/// front: a photographer has to map an abstract dial onto the vehicle in
/// front of them before it means anything, and they are holding a phone in
/// one hand in a car park.
struct CoverageDiagram: View {
    let coverage: SurfaceCoverage
    /// False before the car has been located. Everything reads as empty
    /// then, and painting it all red would be a lie about the photographs
    /// already taken.
    let isLive: Bool

    var body: some View {
        GeometryReader { geometry in
            let size = geometry.size
            ZStack {
                CarSilhouette()
                    .fill(Color.black.opacity(0.45))
                sectorRing(in: size)
                    .opacity(isLive ? 1 : 0.25)
                CarSilhouette()
                    .fill(roofTint)
                    .padding(size.width * 0.26)
                CarSilhouette()
                    .stroke(Color.white.opacity(0.85), lineWidth: 1.4)
            }
        }
        .accessibilityLabel("车辆覆盖")
        .accessibilityValue("\(Int(coverage.fraction * 100))%")
    }

    /// The roof gets the middle of the car, which is where a roof is.
    private var roofTint: Color {
        isLive
            ? CoverageColour.swiftUI(coverage.roofFraction).opacity(0.85)
            : Color.white.opacity(0.10)
    }

    /// One wedge per sector, hugging the body.
    ///
    /// Each is drawn with a gradient into its neighbours' colours so the
    /// paint runs around the car instead of stepping, which is what makes a
    /// half-covered flank look half-covered.
    private func sectorRing(in size: CGSize) -> some View {
        Canvas { context, canvas in
            let centre = CGPoint(x: canvas.width / 2, y: canvas.height / 2)
            let outer = CGSize(width: canvas.width * 0.5, height: canvas.height * 0.5)
            let inner = CGSize(width: canvas.width * 0.30, height: canvas.height * 0.34)
            let count = SurfaceCoverage.sectorCount
            let step = 2 * Double.pi / Double(count)

            for sector in 0..<count {
                // ⚠️ Sector 0 points along the car's own +X, which on a
                // bird's-eye view with the nose up is straight up the screen.
                // Screen y grows downwards, hence the negated sine.
                let start = Double(sector) * step - .pi / 2
                let end = start + step
                var path = Path()
                path.move(to: point(centre, outer, start))
                path.addLine(to: point(centre, outer, end))
                path.addLine(to: point(centre, inner, end))
                path.addLine(to: point(centre, inner, start))
                path.closeSubpath()

                let here = coverage.confidence(ofSector: sector)
                let next = coverage.confidence(ofSector: (sector + 1) % count)
                context.fill(
                    path,
                    with: .linearGradient(
                        Gradient(colors: [
                            CoverageColour.swiftUI(here),
                            CoverageColour.swiftUI((here + next) / 2),
                        ]),
                        startPoint: point(centre, outer, start),
                        endPoint: point(centre, outer, end)
                    )
                )
            }
        }
    }

    private func point(_ centre: CGPoint, _ radii: CGSize, _ angle: Double) -> CGPoint {
        CGPoint(
            x: centre.x + radii.width * cos(angle),
            y: centre.y + radii.height * sin(angle)
        )
    }
}

/// A car seen from above, nose up. The same figure as the app's icon, for
/// the same reason: it is the one shape that says "this is your car and this
/// is its front" without a caption.
struct CarSilhouette: Shape {
    func path(in rect: CGRect) -> Path {
        let w = rect.width, h = rect.height
        let nose = rect.minY, tail = rect.maxY
        let left = rect.minX, right = rect.maxX
        var path = Path()
        path.move(to: CGPoint(x: left + w * 0.18, y: nose))
        path.addLine(to: CGPoint(x: right - w * 0.18, y: nose))
        path.addQuadCurve(
            to: CGPoint(x: right, y: nose + h * 0.21),
            control: CGPoint(x: right, y: nose + h * 0.02)
        )
        path.addLine(to: CGPoint(x: right, y: tail - h * 0.26))
        path.addQuadCurve(
            to: CGPoint(x: right - w * 0.11, y: tail),
            control: CGPoint(x: right, y: tail - h * 0.02)
        )
        path.addLine(to: CGPoint(x: left + w * 0.11, y: tail))
        path.addQuadCurve(
            to: CGPoint(x: left, y: tail - h * 0.26),
            control: CGPoint(x: left, y: tail - h * 0.02)
        )
        path.addLine(to: CGPoint(x: left, y: nose + h * 0.21))
        path.addQuadCurve(
            to: CGPoint(x: left + w * 0.18, y: nose),
            control: CGPoint(x: left, y: nose + h * 0.02)
        )
        path.closeSubpath()
        return path
    }
}

/// The big version, for when the corner is not enough.
struct CoverageSheet: View {
    let coverage: SurfaceCoverage
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                CarModelView(coverage: coverage)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)

                legend
                    .padding(.horizontal, 20)
                    .padding(.bottom, 8)
            }
            .navigationTitle("还差哪里")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("继续拍") { dismiss() } }
            }
        }
    }

    private var legend: some View {
        VStack(spacing: 10) {
            HStack(spacing: 16) {
                key(0, "还没拍到")
                key(0.5, "只拍到一个角度")
                key(1, "拍够了")
            }
            HStack(spacing: 14) {
                Text("车身 \(Int(coverage.fraction * 100))%")
                Text("车顶 \(Int(coverage.roofFraction * 100))%")
            }
            .font(.footnote.monospacedDigit())
            .foregroundStyle(.secondary)

            Text("拖动转车身，捏合放大。灰的是引擎盖和后备箱盖 —— 那两块目前不计分，"
                 + "不是你漏拍了。")
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
    }

    private func key(_ confidence: Double, _ label: String) -> some View {
        HStack(spacing: 6) {
            Circle()
                .fill(CoverageColour.swiftUI(confidence))
                .frame(width: 11, height: 11)
            Text(label).font(.caption)
        }
    }
}
