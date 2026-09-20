import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

// The app icon, which is the app's one idea: a car seen from above, with the
// ring around it filled in as far as it has been photographed — and a notch
// still open, because the whole point is that you keep going.
//
// Greyscale throughout, deliberately. Nothing here is carrying a hue's
// worth of meaning: the ring says "done" by being bright, not by being
// green, and dropping colour removes the accidental traffic-light reading
// where a notch looks like a fault rather than like work left to do.

let side = 1024.0
let centre = CGPoint(x: side / 2, y: side / 2)

func rgb(_ hex: UInt32) -> CGColor {
    CGColor(
        red: Double((hex >> 16) & 0xFF) / 255,
        green: Double((hex >> 8) & 0xFF) / 255,
        blue: Double(hex & 0xFF) / 255,
        alpha: 1
    )
}

let space = CGColorSpaceCreateDeviceRGB()
guard let ctx = CGContext(
    data: nil, width: Int(side), height: Int(side),
    bitsPerComponent: 8, bytesPerRow: 0, space: space,
    bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
) else { fatalError("no context") }

// Work in screen coordinates: y grows downwards.
ctx.translateBy(x: 0, y: side)
ctx.scaleBy(x: 1, y: -1)
ctx.setAllowsAntialiasing(true)
ctx.interpolationQuality = .high

// MARK: - Ground

let backdrop = CGGradient(
    colorsSpace: space,
    colors: [rgb(0x2C2C2C), rgb(0x0A0A0A)] as CFArray,
    locations: [0, 1]
)!
ctx.drawLinearGradient(
    backdrop,
    start: CGPoint(x: side * 0.2, y: 0),
    end: CGPoint(x: side * 0.8, y: side),
    options: []
)

// MARK: - The ring

let segments = 16
let outerRadius = 430.0
let innerRadius = 344.0
let gapDegrees = 5.0
let stepDegrees = 360.0 / Double(segments)
// Three unshot segments, contiguous, low on the right — the notch reads as
// "nearly there, keep walking" rather than as a fault.
let unshot: Set<Int> = [4, 5, 6]

func radians(_ degrees: Double) -> Double { degrees * .pi / 180 }

for index in 0..<segments {
    // Index 0 points straight up at the bonnet, and they run clockwise.
    let start = -90.0 + Double(index) * stepDegrees + gapDegrees / 2
    let end = start + stepDegrees - gapDegrees

    ctx.beginPath()
    ctx.addArc(
        center: centre, radius: outerRadius,
        startAngle: radians(start), endAngle: radians(end), clockwise: false
    )
    ctx.addArc(
        center: centre, radius: innerRadius,
        startAngle: radians(end), endAngle: radians(start), clockwise: true
    )
    ctx.closePath()

    if unshot.contains(index) {
        ctx.setFillColor(rgb(0x3B3B3B))
    } else {
        ctx.setFillColor(rgb(0xE0E0E0))
    }
    ctx.fillPath()
}

// MARK: - The car, from above
//
// Four attempts got here. A solid white body with a dark cabin cut out of it
// reads as a padlock; so does the same thing drawn as outlines. What finally
// says "car" is the silhouette breaking out of its own rectangle — wheels
// standing proud of the flanks, and above all **wing mirrors**. Nothing else
// in the world of icons has ears.

let panel = rgb(0xFAFAFA)
let glass = rgb(0x1C1C1C)
// ⚠️ Mid-tone, not dark. These stick out past the white body into the dark
// backdrop, so they have to contrast with the *background*, not with the car.
// Drawn near-black they were perfectly invisible — a wheel nobody can see is
// not a wheel.
let trim = rgb(0x8A8A8A)
let bodyWidth = 232.0
let bodyLength = 508.0
let left = centre.x - bodyWidth / 2
let right = centre.x + bodyWidth / 2
let nose = centre.y - bodyLength / 2
let tail = centre.y + bodyLength / 2

let cowlY = centre.y - 84
let roofFrontY = centre.y - 6
let roofBackY = centre.y + 86
let bootY = centre.y + 146

// Wheels and mirrors go down first, so the body sits over their inner ends
// and only what should stick out does.
ctx.setFillColor(trim)
let wheelWidth = 44.0
let wheelLength = 96.0
for axleY in [nose + 130, tail - 124] {
    for wheelX in [left - 22, right - wheelWidth + 22] {
        ctx.addPath(CGPath(
            roundedRect: CGRect(x: wheelX, y: axleY - wheelLength / 2, width: wheelWidth, height: wheelLength),
            cornerWidth: 18, cornerHeight: 18, transform: nil
        ))
    }
}
let mirrorWidth = 42.0
let mirrorHeight = 30.0
for mirrorX in [left - 26, right - mirrorWidth + 26] {
    ctx.addPath(CGPath(
        roundedRect: CGRect(x: mirrorX, y: cowlY - mirrorHeight / 2 + 8, width: mirrorWidth, height: mirrorHeight),
        cornerWidth: 13, cornerHeight: 13, transform: nil
    ))
}
ctx.fillPath()

let noseInset = 44.0
let tailInset = 28.0
let shoulder = 108.0

let body = CGMutablePath()
body.move(to: CGPoint(x: left + noseInset, y: nose))
body.addLine(to: CGPoint(x: right - noseInset, y: nose))
body.addQuadCurve(to: CGPoint(x: right, y: nose + shoulder), control: CGPoint(x: right, y: nose + 8))
body.addLine(to: CGPoint(x: right, y: tail - 132))
body.addQuadCurve(to: CGPoint(x: right - tailInset, y: tail), control: CGPoint(x: right, y: tail - 10))
body.addLine(to: CGPoint(x: left + tailInset, y: tail))
body.addQuadCurve(to: CGPoint(x: left, y: tail - 132), control: CGPoint(x: left, y: tail - 10))
body.addLine(to: CGPoint(x: left, y: nose + shoulder))
body.addQuadCurve(to: CGPoint(x: left + noseInset, y: nose), control: CGPoint(x: left, y: nose + 8))
body.closeSubpath()

ctx.addPath(body)
ctx.setFillColor(panel)
ctx.fillPath()

// Windscreen deliberately larger than the backlight. Two dark shapes of the
// same size on a pale body stop being windows and become a pair of eyes.
func quad(_ points: [CGPoint]) {
    let path = CGMutablePath()
    path.move(to: points[0])
    for point in points.dropFirst() { path.addLine(to: point) }
    path.closeSubpath()
    ctx.addPath(path)
}

ctx.setFillColor(glass)
quad([
    CGPoint(x: left + 26, y: cowlY),
    CGPoint(x: right - 26, y: cowlY),
    CGPoint(x: right - 52, y: roofFrontY),
    CGPoint(x: left + 52, y: roofFrontY),
])
quad([
    CGPoint(x: left + 52, y: roofBackY),
    CGPoint(x: right - 52, y: roofBackY),
    CGPoint(x: right - 38, y: bootY),
    CGPoint(x: left + 38, y: bootY),
])
ctx.fillPath()

// MARK: - Out

let url = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "icon-1024.png")
guard let image = ctx.makeImage(),
      let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)
else { fatalError("no image") }
CGImageDestinationAddImage(destination, image, nil)
guard CGImageDestinationFinalize(destination) else { fatalError("write failed") }
print("wrote \(url.path)")
