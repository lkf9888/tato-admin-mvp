import EvidenceCore
import SwiftUI

/// The car seen from above, with the parts nobody has photographed still red.
///
/// This is the whole instruction set. A checklist has to be read and
/// understood before it helps; a picture of your car with a red patch on the
/// back left needs no explanation and no translation, and it is the same
/// picture whether the photographer has used the app a hundred times or never.
///
/// Drawn small — it sits in the corner of a live camera view, and the moment
/// it demands attention it is competing with the thing it is there to help
/// with.
struct CoverageDiagram: View {
    let coverage: SurfaceCoverage
    /// Nil when the phone cannot measure the car, in which case there is
    /// nothing honest to draw.
    var isLive: Bool = true

    private let ringWidth: CGFloat = 9

    var body: some View {
        GeometryReader { geometry in
            let size = min(geometry.size.width, geometry.size.height)
            let centre = CGPoint(x: geometry.size.width / 2, y: geometry.size.height / 2)
            // A car is about two and a half times longer than it is wide.
            let halfLength = size / 2 - ringWidth
            let halfWidth = halfLength * 0.42

            ZStack {
                // The roof, as the body of the car.
                Ellipse()
                    .fill(roofColour)
                    .frame(width: halfWidth * 2, height: halfLength * 2)

                // The nose, so the diagram has an orientation at a glance.
                Path { path in
                    path.move(to: CGPoint(x: centre.x, y: centre.y - halfLength + 3))
                    path.addLine(to: CGPoint(x: centre.x - 5, y: centre.y - halfLength + 12))
                    path.addLine(to: CGPoint(x: centre.x + 5, y: centre.y - halfLength + 12))
                    path.closeSubpath()
                }
                .fill(.white.opacity(0.85))

                // The flanks, one wedge per sector.
                ForEach(0..<SurfaceCoverage.sectorCount, id: \.self) { sector in
                    let span = 360.0 / Double(SurfaceCoverage.sectorCount)
                    // Sector 0 is the nose, which is up in this drawing.
                    let start = Double(sector) * span - 90 - span / 2
                    Path { path in
                        path.addArc(
                            center: centre,
                            radius: halfLength + ringWidth / 2,
                            startAngle: .degrees(start),
                            endAngle: .degrees(start + span * 0.88),
                            clockwise: false
                        )
                    }
                    .stroke(sideColour(sector), style: StrokeStyle(lineWidth: ringWidth, lineCap: .butt))
                    // Squash the ring into the car's proportions.
                    .scaleEffect(x: halfWidth / halfLength, y: 1, anchor: .center)
                }
            }
            .frame(width: geometry.size.width, height: geometry.size.height)
            .opacity(isLive ? 1 : 0.35)
        }
    }

    /// Averaged over the three side bands, so a sector only goes fully green
    /// once the sill, the panel and the glass have all been photographed —
    /// which is what stops a row of waist-height shots reading as a finished
    /// car.
    private func sideColour(_ sector: Int) -> Color {
        let bands: [SurfaceBand] = [.sill, .body, .glass]
        let hit = bands.filter { coverage.covered.contains(CoveragePatch(sector: sector, band: $0)) }.count
        return paint(Double(hit) / Double(bands.count))
    }

    private var roofColour: Color {
        paint(coverage.fraction(of: .roof)).opacity(0.55)
    }

    /// Red through amber to green. No intermediate grey: the point of the
    /// drawing is that unshot areas are alarming.
    private func paint(_ fraction: Double) -> Color {
        switch fraction {
        case ..<0.01: return Color(red: 0.82, green: 0.22, blue: 0.18)
        case ..<0.67: return Color(red: 0.92, green: 0.63, blue: 0.18)
        default: return Color(red: 0.24, green: 0.68, blue: 0.40)
        }
    }
}
