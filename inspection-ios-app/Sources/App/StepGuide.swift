import EvidenceCore
import SwiftUI

/// The picture of what to photograph, floating in the middle of the
/// viewfinder.
///
/// ⚠️ A drawing rather than a sentence, and that is the point. "前后保险杠
/// 下方四个角" is four nouns and a preposition that somebody has to parse
/// while holding a phone in one hand in a car park at dusk; the same thing
/// drawn is understood before it is read, and it survives being glanced at.
/// It is also the one instruction in this app that cannot be wrong about the
/// car — it names a subject and draws it, and never claims to know which end
/// is the front. See `ShotStep`.
struct StepGuide: View {
    let step: ShotStep
    let taken: Int
    /// How wide to draw the line art. The caption under it is allowed to be
    /// wider, because a hint broken over three lines is a hint nobody reads.
    let outlineWidth: CGFloat

    var body: some View {
        VStack(spacing: 14) {
            StepArtwork(step: step)
                .frame(width: outlineWidth, height: outlineWidth)
            caption
        }
        .allowsHitTesting(false)
    }

    /// ⚠️ The drawing carries the subject; the words carry the detail the
    /// drawing cannot hold — *which* four corners, how many, how close.
    /// A picture on its own is unambiguous about "a wheel" and says nothing
    /// about "all four of them, rim in shot".
    ///
    /// It rides with the drawing rather than sitting at the bottom of the
    /// frame, because the two are one instruction: the eye that has just
    /// understood the picture is already here, and a caption thirty
    /// millimetres away is a second thing to go and look for.
    private var caption: some View {
        VStack(spacing: 3) {
            Text(step.titleZH)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(.white)
            HStack(spacing: 6) {
                Text(step.hintZH)
                // The one number the sentence under the frame never says.
                if step.required > 1 {
                    Text("·")
                    Text("\(min(taken, step.required)) / \(step.required)")
                        .monospacedDigit()
                }
            }
            .font(.system(size: 12.5, weight: .medium))
            .foregroundStyle(.white.opacity(0.82))
        }
        .multilineTextAlignment(.center)
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(.black.opacity(0.38))
        )
    }
}

/// The line art, in two weights.
///
/// ⚠️ Two layers, and this is what makes the set readable. The first pass was
/// one weight throughout: every drawing was *a shape*, and a shape has to be
/// decoded before it means anything — a rounded rectangle with a bar across
/// it is a door panel, or a dashboard, or a floor mat, depending on which
/// caption you happen to have read. Nothing stood out, so nothing was
/// recognised at a glance, which is the only way these are ever looked at.
///
/// Now every drawing is a **recognisable piece of car**, drawn thin, with the
/// **part being photographed** drawn thick over it. The thin layer answers
/// "what am I looking at"; the thick layer answers "which bit of it". Neither
/// question needs the caption, which is then free to carry the one thing a
/// drawing genuinely cannot say: how many.
///
/// Each layer is laid down twice — a wide dark pass under a narrow light one
/// — so the line holds against a white bonnet and against a night car park,
/// neither of which a single flat colour survives.
struct StepArtwork: View {
    let step: ShotStep

    var body: some View {
        ZStack {
            layer(.context, dark: 0.26, darkWidth: 4.4, light: 0.52, lightWidth: 1.5)
            layer(.focus, dark: 0.38, darkWidth: 6.4, light: 0.95, lightWidth: 2.8)
        }
    }

    private func layer(
        _ which: StepOutline.Layer,
        dark: Double, darkWidth: CGFloat, light: Double, lightWidth: CGFloat
    ) -> some View {
        ZStack {
            StepOutline(step: step, layer: which)
                .stroke(
                    Color.black.opacity(dark),
                    style: StrokeStyle(lineWidth: darkWidth, lineCap: .round, lineJoin: .round)
                )
            StepOutline(step: step, layer: which)
                .stroke(
                    Color.white.opacity(light),
                    style: StrokeStyle(lineWidth: lightWidth, lineCap: .round, lineJoin: .round)
                )
        }
    }
}

/// Every subject in the plan, as line art.
///
/// Drawn in a unit square and scaled, so one set of coordinates serves every
/// screen. Schematic, but never abstract: each one keeps whatever detail it
/// takes to be named without reading the caption — a door needs its glass and
/// its speaker, a dashboard needs the steering wheel you see it through, and
/// a wheel needs the arch above it or it is a steering wheel.
struct StepOutline: Shape {
    /// `context` is the car around the subject, drawn thin. `focus` is the
    /// subject itself, drawn thick.
    enum Layer { case context, focus }

    let step: ShotStep
    let layer: Layer

    func path(in rect: CGRect) -> Path {
        // Square, centred: the drawings assume equal scales, which is what
        // keeps a wheel round.
        let side = min(rect.width, rect.height)
        let board = Board(
            rect: CGRect(
                x: rect.midX - side / 2, y: rect.midY - side / 2, width: side, height: side
            )
        )
        var context = Path()
        var focus = Path()
        switch step {
        case .walkAround: Self.walkAround(&context, &focus, board)
        case .bumperCorners: Self.bumperCorners(&context, &focus, board)
        case .wheels: Self.wheel(&context, &focus, board)
        case .roof: Self.roof(&context, &focus, board)
        case .windscreen: Self.windscreen(&context, &focus, board)
        case .rearSeats: Self.rearSeats(&context, &focus, board)
        case .frontSeats: Self.frontSeats(&context, &focus, board)
        case .centreConsole: Self.centreConsole(&context, &focus, board)
        case .dashboard: Self.dashboard(&context, &focus, board)
        case .headliner: Self.headliner(&context, &focus, board)
        case .carpetsAndDoors: Self.carpetsAndDoors(&context, &focus, board)
        }
        return layer == .focus ? focus : context
    }

    // MARK: - Exterior

    /// The whole car, and the ring on the ground to walk round it.
    private static func walkAround(_ context: inout Path, _ focus: inout Path, _ b: Board) {
        context.addEllipse(in: b.box(0.05, 0.655, 0.95, 0.925))
        context.poly(b, [(0.45, 0.893), (0.523, 0.924), (0.45, 0.955)])

        // ⚠️ Short bonnet, long cabin, steep tailgate. The first pass had a
        // long flat bonnet and a short cabin, and it drew a pickup — which is
        // not what anybody in this fleet is standing in front of.
        focus.move(to: b.at(0.10, 0.565))
        focus.addLine(to: b.at(0.10, 0.495))
        focus.addQuadCurve(to: b.at(0.165, 0.437), control: b.at(0.105, 0.45))
        focus.addLine(to: b.at(0.30, 0.418))
        focus.addLine(to: b.at(0.395, 0.295))
        focus.addLine(to: b.at(0.695, 0.285))
        focus.addLine(to: b.at(0.80, 0.395))
        focus.addLine(to: b.at(0.875, 0.425))
        focus.addQuadCurve(to: b.at(0.90, 0.50), control: b.at(0.905, 0.44))
        focus.addLine(to: b.at(0.90, 0.565))
        focus.addLine(to: b.at(0.815, 0.565))
        focus.addQuadCurve(to: b.at(0.655, 0.565), control: b.at(0.735, 0.418))
        focus.addLine(to: b.at(0.385, 0.565))
        focus.addQuadCurve(to: b.at(0.225, 0.565), control: b.at(0.305, 0.418))
        focus.closeSubpath()

        focus.addEllipse(in: b.circle(0.305, 0.568, 0.068))
        focus.addEllipse(in: b.circle(0.305, 0.568, 0.028))
        focus.addEllipse(in: b.circle(0.735, 0.568, 0.068))
        focus.addEllipse(in: b.circle(0.735, 0.568, 0.028))
        // Glass, a door line, a handle, a headlight. Without them a side
        // profile is a loaf with wheels.
        focus.poly(b, [(0.408, 0.312), (0.688, 0.302), (0.775, 0.39), (0.418, 0.398)], closed: true)
        focus.poly(b, [(0.545, 0.307), (0.552, 0.395)])
        focus.poly(b, [(0.50, 0.40), (0.50, 0.535)])
        focus.poly(b, [(0.535, 0.44), (0.595, 0.437)])
        focus.poly(b, [(0.105, 0.455), (0.163, 0.443), (0.168, 0.478), (0.108, 0.487)], closed: true)
    }

    /// The car from above with all four bumper corners bracketed.
    ///
    /// ⚠️ From above so that "four" is countable. A three-quarter view of one
    /// corner is a better picture and a worse instruction: it shows one
    /// corner, and this step asks for four.
    private static func bumperCorners(_ context: inout Path, _ focus: inout Path, _ b: Board) {
        topDownCar(&context, b)
        let brackets: [[(CGFloat, CGFloat)]] = [
            [(0.245, 0.185), (0.245, 0.045), (0.385, 0.045)],
            [(0.755, 0.185), (0.755, 0.045), (0.615, 0.045)],
            [(0.245, 0.815), (0.245, 0.955), (0.385, 0.955)],
            [(0.755, 0.815), (0.755, 0.955), (0.615, 0.955)],
        ]
        for bracket in brackets { focus.poly(b, bracket) }
        // The bumpers themselves, so the brackets are bracketing something.
        focus.poly(b, [(0.355, 0.10), (0.645, 0.10)])
        focus.poly(b, [(0.355, 0.90), (0.645, 0.90)])
    }

    /// One wheel, under its arch. The arch is what stops this being a
    /// steering wheel.
    private static func wheel(_ context: inout Path, _ focus: inout Path, _ b: Board) {
        context.poly(b, [(0.03, 0.60), (0.118, 0.60)])
        context.move(to: b.at(0.118, 0.60))
        context.addQuadCurve(to: b.at(0.50, 0.175), control: b.at(0.125, 0.225))
        context.addQuadCurve(to: b.at(0.882, 0.60), control: b.at(0.875, 0.225))
        context.poly(b, [(0.882, 0.60), (0.97, 0.60)])
        context.poly(b, [(0.06, 0.90), (0.94, 0.90)])

        focus.addEllipse(in: b.circle(0.5, 0.545, 0.325))
        focus.addEllipse(in: b.circle(0.5, 0.545, 0.238))
        focus.addEllipse(in: b.circle(0.5, 0.545, 0.068))
        for index in 0..<5 {
            let angle = -.pi / 2 + Double(index) * 2 * .pi / 5
            let inner = CGFloat(0.08), outer = CGFloat(0.226)
            focus.poly(b, [
                (0.5 + inner * CGFloat(cos(angle)), 0.545 + inner * CGFloat(sin(angle))),
                (0.5 + outer * CGFloat(cos(angle)), 0.545 + outer * CGFloat(sin(angle))),
            ])
        }
    }

    /// The same car from above, roof split into its front and back halves.
    private static func roof(_ context: inout Path, _ focus: inout Path, _ b: Board) {
        topDownCar(&context, b)
        focus.addRoundedRect(in: b.box(0.365, 0.355, 0.635, 0.645), cornerSize: b.corner(0.035))
        focus.poly(b, [(0.365, 0.50), (0.635, 0.50)])
        focus.poly(b, [(0.41, 0.425), (0.59, 0.425)])
        focus.poly(b, [(0.41, 0.575), (0.59, 0.575)])
    }

    /// The glass, seen from in front of the car.
    private static func windscreen(_ context: inout Path, _ focus: inout Path, _ b: Board) {
        // Roof, pillars, bonnet, mirrors: the frame the glass sits in.
        context.poly(b, [(0.175, 0.155), (0.825, 0.155)])
        context.poly(b, [(0.175, 0.158), (0.115, 0.665)])
        context.poly(b, [(0.825, 0.158), (0.885, 0.665)])
        context.poly(b, [(0.075, 0.70), (0.925, 0.70)])
        context.poly(b, [(0.075, 0.70), (0.095, 0.875), (0.905, 0.875), (0.925, 0.70)])
        context.poly(b, [(0.115, 0.60), (0.045, 0.565), (0.03, 0.635), (0.105, 0.655)], closed: true)
        context.poly(b, [(0.885, 0.60), (0.955, 0.565), (0.97, 0.635), (0.895, 0.655)], closed: true)

        focus.poly(b, [(0.175, 0.665), (0.245, 0.20), (0.755, 0.20), (0.825, 0.665)], closed: true)
        focus.addRoundedRect(in: b.box(0.44, 0.20, 0.56, 0.265), cornerSize: b.corner(0.022))
        focus.poly(b, [(0.315, 0.635), (0.395, 0.42), (0.43, 0.437)])
        focus.poly(b, [(0.605, 0.635), (0.685, 0.42), (0.72, 0.437)])
    }

    // MARK: - Interior

    /// A bench with three headrests. ⚠️ Three, and one unbroken backrest:
    /// that is the whole difference between this drawing and the front seats,
    /// and it has to survive a glance.
    private static func rearSeats(_ context: inout Path, _ focus: inout Path, _ b: Board) {
        context.poly(b, [(0.045, 0.09), (0.955, 0.09)])
        context.poly(b, [(0.045, 0.09), (0.045, 0.81)])
        context.poly(b, [(0.955, 0.09), (0.955, 0.81)])
        context.poly(b, [(0.045, 0.235), (0.155, 0.235)])
        context.poly(b, [(0.955, 0.235), (0.845, 0.235)])

        focus.addRoundedRect(in: b.box(0.185, 0.195, 0.325, 0.325), cornerSize: b.corner(0.045))
        focus.addRoundedRect(in: b.box(0.43, 0.195, 0.57, 0.325), cornerSize: b.corner(0.045))
        focus.addRoundedRect(in: b.box(0.675, 0.195, 0.815, 0.325), cornerSize: b.corner(0.045))
        focus.addRoundedRect(in: b.box(0.13, 0.325, 0.87, 0.645), cornerSize: b.corner(0.05))
        focus.poly(b, [(0.09, 0.645), (0.91, 0.645), (0.955, 0.80), (0.045, 0.80)], closed: true)
    }

    /// Two buckets with a console between them, and the wheel in front of the
    /// left one.
    private static func frontSeats(_ context: inout Path, _ focus: inout Path, _ b: Board) {
        context.poly(b, [(0.03, 0.125), (0.97, 0.125)])
        context.poly(b, [(0.03, 0.125), (0.03, 0.21)])
        context.poly(b, [(0.97, 0.125), (0.97, 0.21)])
        context.poly(b, [(0.445, 0.60), (0.555, 0.60), (0.585, 0.875), (0.415, 0.875)], closed: true)

        bucket(&focus, b, from: 0.055, to: 0.415)
        bucket(&focus, b, from: 0.585, to: 0.945)
    }

    private static func bucket(_ path: inout Path, _ b: Board, from x0: CGFloat, to x1: CGFloat) {
        let width = x1 - x0
        path.addRoundedRect(
            in: b.box(x0 + width * 0.24, 0.20, x1 - width * 0.24, 0.325),
            cornerSize: b.corner(0.045)
        )
        path.addRoundedRect(in: b.box(x0, 0.325, x1, 0.635), cornerSize: b.corner(0.055))
        path.poly(b, [
            (x0 - 0.012, 0.635), (x1 + 0.012, 0.635), (x1 + 0.035, 0.785), (x0 - 0.035, 0.785),
        ], closed: true)
    }

    /// The centre stack, straight on: screen, buttons, knobs, gear lever.
    private static func centreConsole(_ context: inout Path, _ focus: inout Path, _ b: Board) {
        context.move(to: b.at(0.045, 0.175))
        context.addQuadCurve(to: b.at(0.955, 0.175), control: b.at(0.50, 0.055))
        context.addRoundedRect(in: b.box(0.065, 0.225, 0.205, 0.315), cornerSize: b.corner(0.02))
        context.addRoundedRect(in: b.box(0.795, 0.225, 0.935, 0.315), cornerSize: b.corner(0.02))
        context.poly(b, [(0.215, 0.30), (0.175, 0.93)])
        context.poly(b, [(0.785, 0.30), (0.825, 0.93)])

        focus.addRoundedRect(in: b.box(0.265, 0.20, 0.735, 0.46), cornerSize: b.corner(0.03))
        for column in 0..<4 {
            let x = 0.275 + CGFloat(column) * 0.12
            focus.addRoundedRect(in: b.box(x, 0.515, x + 0.085, 0.58), cornerSize: b.corner(0.018))
        }
        focus.addEllipse(in: b.circle(0.335, 0.685, 0.058))
        focus.addEllipse(in: b.circle(0.665, 0.685, 0.058))
        focus.poly(b, [(0.50, 0.93), (0.50, 0.845)])
        focus.addEllipse(in: b.circle(0.50, 0.808, 0.052))
    }

    /// The binnacle, seen over the rim of the steering wheel — which is the
    /// only way anybody has ever seen one.
    private static func dashboard(_ context: inout Path, _ focus: inout Path, _ b: Board) {
        // ⚠️ Vents and a dash edge, not a steering wheel. The wheel's rim is
        // an arc of the same size and curvature as the binnacle's hood, and
        // drawing both stacked one under the other read as two domes rather
        // than as a car.
        context.move(to: b.at(0.02, 0.775))
        context.addQuadCurve(to: b.at(0.98, 0.775), control: b.at(0.50, 0.685))
        context.addRoundedRect(in: b.box(0.035, 0.53, 0.175, 0.625), cornerSize: b.corner(0.022))
        context.addRoundedRect(in: b.box(0.825, 0.53, 0.965, 0.625), cornerSize: b.corner(0.022))
        context.poly(b, [(0.06, 0.555), (0.15, 0.555)])
        context.poly(b, [(0.06, 0.60), (0.15, 0.60)])
        context.poly(b, [(0.85, 0.555), (0.94, 0.555)])
        context.poly(b, [(0.85, 0.60), (0.94, 0.60)])

        focus.move(to: b.at(0.085, 0.665))
        focus.addQuadCurve(to: b.at(0.50, 0.145), control: b.at(0.105, 0.195))
        focus.addQuadCurve(to: b.at(0.915, 0.665), control: b.at(0.895, 0.195))
        focus.closeSubpath()
        focus.addEllipse(in: b.circle(0.295, 0.435, 0.145))
        focus.poly(b, [(0.295, 0.435), (0.225, 0.345)])
        focus.addEllipse(in: b.circle(0.705, 0.435, 0.145))
        focus.poly(b, [(0.705, 0.435), (0.775, 0.345)])
        // The odometer, which is the reason this photograph is on the list.
        focus.addRoundedRect(in: b.box(0.425, 0.375, 0.575, 0.50), cornerSize: b.corner(0.022))
        focus.poly(b, [(0.455, 0.438), (0.545, 0.438)])
    }

    /// The roof from inside, looking up and forward past the mirror.
    private static func headliner(_ context: inout Path, _ focus: inout Path, _ b: Board) {
        context.poly(b, [(0.055, 0.96), (0.145, 0.835)])
        context.poly(b, [(0.945, 0.96), (0.855, 0.835)])
        context.poly(b, [(0.425, 0.885), (0.575, 0.885), (0.59, 0.965), (0.41, 0.965)], closed: true)
        context.poly(b, [(0.50, 0.838), (0.50, 0.885)])

        focus.poly(b, [(0.125, 0.835), (0.235, 0.135), (0.765, 0.135), (0.875, 0.835)], closed: true)
        focus.poly(b, [(0.325, 0.215), (0.675, 0.215), (0.695, 0.495), (0.305, 0.495)], closed: true)
        focus.addRoundedRect(in: b.box(0.435, 0.555, 0.565, 0.625), cornerSize: b.corner(0.02))
        focus.poly(b, [(0.185, 0.675), (0.45, 0.675), (0.455, 0.765), (0.19, 0.765)], closed: true)
        focus.poly(b, [(0.815, 0.675), (0.55, 0.675), (0.545, 0.765), (0.81, 0.765)], closed: true)
    }

    /// A door panel with the mat at its foot. Two subjects in one drawing,
    /// because they are one step: the two things on Turo's own interior list
    /// that nothing else in this plan covers.
    private static func carpetsAndDoors(_ context: inout Path, _ focus: inout Path, _ b: Board) {
        context.poly(b, [(0.145, 0.70), (0.915, 0.635)])

        // ⚠️ One skin with the window cut out of it, and a sill that runs
        // uphill towards the front. Drawing the glass as a separate shape
        // sitting on top made the door read as a box with a lid; a door is a
        // panel with a hole in it.
        focus.move(to: b.at(0.105, 0.225))
        focus.addQuadCurve(to: b.at(0.185, 0.115), control: b.at(0.108, 0.125))
        focus.addLine(to: b.at(0.865, 0.075))
        focus.addLine(to: b.at(0.905, 0.565))
        focus.addLine(to: b.at(0.135, 0.635))
        focus.closeSubpath()
        focus.poly(b, [(0.172, 0.198), (0.82, 0.152), (0.832, 0.312), (0.182, 0.352)], closed: true)
        focus.poly(b, [(0.185, 0.40), (0.60, 0.368), (0.618, 0.458), (0.205, 0.492)], closed: true)
        focus.poly(b, [(0.665, 0.355), (0.815, 0.343), (0.822, 0.408), (0.672, 0.422)], closed: true)
        focus.addEllipse(in: b.circle(0.285, 0.552, 0.055))
        focus.addEllipse(in: b.circle(0.285, 0.552, 0.023))
        // The mat at its foot, with the bound edge every mat has.
        focus.poly(b, [(0.30, 0.755), (0.80, 0.715), (0.86, 0.905), (0.345, 0.945)], closed: true)
        focus.poly(b, [(0.35, 0.792), (0.765, 0.758), (0.805, 0.868), (0.39, 0.905)], closed: true)
    }

    // MARK: - Shared pieces

    /// The car from above, thin. Shared by the two steps that point at a
    /// place on it, so that the *same* car means the highlight is the only
    /// thing that changed between them.
    private static func topDownCar(_ path: inout Path, _ b: Board) {
        // ⚠️ Roughly 2.3 long to 1 wide. The first pass was 1.7 and read as
        // a phone lying on a table — a car seen from above is a *long* thing,
        // and that proportion is most of what makes the view legible.
        path.move(to: b.at(0.395, 0.06))
        path.addLine(to: b.at(0.605, 0.06))
        path.addQuadCurve(to: b.at(0.685, 0.175), control: b.at(0.683, 0.068))
        path.addLine(to: b.at(0.685, 0.79))
        path.addQuadCurve(to: b.at(0.60, 0.94), control: b.at(0.688, 0.932))
        path.addLine(to: b.at(0.40, 0.94))
        path.addQuadCurve(to: b.at(0.315, 0.79), control: b.at(0.312, 0.932))
        path.addLine(to: b.at(0.315, 0.175))
        path.addQuadCurve(to: b.at(0.395, 0.06), control: b.at(0.317, 0.068))
        path.closeSubpath()
        // Windscreen, rear glass, mirrors and the two panel seams: which way
        // up the car is, and that it is panelled rather than moulded.
        path.poly(b, [(0.345, 0.285), (0.655, 0.285), (0.635, 0.355), (0.365, 0.355)], closed: true)
        path.poly(b, [(0.365, 0.645), (0.635, 0.645), (0.655, 0.715), (0.345, 0.715)], closed: true)
        path.poly(b, [(0.315, 0.325), (0.252, 0.30), (0.252, 0.352), (0.315, 0.37)], closed: true)
        path.poly(b, [(0.685, 0.325), (0.748, 0.30), (0.748, 0.352), (0.685, 0.37)], closed: true)
        path.poly(b, [(0.355, 0.155), (0.645, 0.155)])
        path.poly(b, [(0.355, 0.845), (0.645, 0.845)])
    }
}

/// A unit square mapped onto whatever rectangle the shape was handed.
private struct Board {
    let rect: CGRect

    func at(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
        CGPoint(x: rect.minX + x * rect.width, y: rect.minY + y * rect.height)
    }

    func box(_ x0: CGFloat, _ y0: CGFloat, _ x1: CGFloat, _ y1: CGFloat) -> CGRect {
        CGRect(
            origin: at(x0, y0),
            size: CGSize(width: (x1 - x0) * rect.width, height: (y1 - y0) * rect.height)
        )
    }

    func circle(_ cx: CGFloat, _ cy: CGFloat, _ r: CGFloat) -> CGRect {
        box(cx - r, cy - r, cx + r, cy + r)
    }

    func corner(_ r: CGFloat) -> CGSize {
        CGSize(width: r * rect.width, height: r * rect.height)
    }
}

private extension Path {
    /// A run of straight segments in unit coordinates.
    mutating func poly(_ board: Board, _ points: [(CGFloat, CGFloat)], closed: Bool = false) {
        guard let first = points.first else { return }
        move(to: board.at(first.0, first.1))
        for point in points.dropFirst() { addLine(to: board.at(point.0, point.1)) }
        if closed { closeSubpath() }
    }
}
