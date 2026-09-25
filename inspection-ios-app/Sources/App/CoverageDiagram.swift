import EvidenceCore
import SwiftUI

/// Which ways round the car have been photographed from, as a ring, turned
/// so the photographer is always at the bottom.
///
/// Green where the camera has faced, faint where it has not. Turning the ring
/// with the photographer is what makes it readable at a glance: a gap on the
/// right of the ring is a gap to your right, so "往你右边走" and the picture
/// say the same thing without anybody translating between them.
///
/// ⚠️ Faint rather than red. This replaced a car painted red, amber and
/// green, and red read as *wrong* — which was fair while the app was
/// enforcing coverage, and is not now that it only guides. An unphotographed
/// direction is a suggestion, and it is drawn like one.
///
/// ⚠️ And a ring rather than a car. The gyroscope knows which way the camera
/// pointed, not where the car is or which end is its front, so a car drawn
/// in the middle would be claiming something the app cannot see.
struct HeadingRing: View {
    let coverage: HeadingCoverage
    /// Where the camera points now. Nil turns the ring to its reference
    /// frame rather than to the photographer.
    let heading: Double?

    private static let covered = Color(red: 0.24, green: 0.75, blue: 0.42)

    var body: some View {
        ZStack {
            Circle().fill(Color.black.opacity(0.45))
            Canvas { context, size in
                let centre = CGPoint(x: size.width / 2, y: size.height / 2)
                let outer = min(size.width, size.height) / 2 - 1
                let inner = outer * 0.64
                let width = HeadingCoverage.sectorWidth

                for sector in 0..<HeadingCoverage.sectorCount {
                    let middle = HeadingCoverage.centre(ofSector: sector)
                    let start = screenAngle(of: middle - width / 2 + 0.6)
                    let end = screenAngle(of: middle + width / 2 - 0.6)
                    var wedge = Path()
                    wedge.addArc(center: centre, radius: outer, startAngle: start, endAngle: end, clockwise: true)
                    wedge.addArc(center: centre, radius: inner, startAngle: end, endAngle: start, clockwise: false)
                    wedge.closeSubpath()
                    context.fill(
                        wedge,
                        with: .color(coverage.isCovered(sector: sector) ? Self.covered : .white.opacity(0.16))
                    )
                }

                // You are here: the bottom of the ring, always.
                let marker = CGRect(x: centre.x - 3, y: centre.y + outer - 7, width: 6, height: 6)
                context.fill(Path(ellipseIn: marker), with: .color(.white))
            }
            Text("\(Int(coverage.fraction * 100))%")
                .font(.system(size: 12, weight: .semibold).monospacedDigit())
                .foregroundStyle(.white)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("绕车角度")
        .accessibilityValue("\(Int(coverage.fraction * 100))%")
    }

    /// Where a heading lands on screen, with the photographer at the bottom.
    ///
    /// A direction that is a walk to the right — counter-clockwise of where
    /// the camera points, see `HeadingCoverage.gapBearing` — is drawn to the
    /// right of the marker. Screen angles run clockwise from 3 o'clock because
    /// the y axis points down, so the bottom is +90° and the right is 0°.
    private func screenAngle(of direction: Double) -> SwiftUI.Angle {
        let bearing = CameraHeading.difference(from: heading ?? 0, to: direction)
        return .degrees(90 - bearing)
    }
}
