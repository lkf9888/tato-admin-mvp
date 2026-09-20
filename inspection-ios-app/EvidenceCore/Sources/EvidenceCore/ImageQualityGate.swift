import Foundation
import ImageIO
import CoreGraphics

public enum ImageQualityIssue: String, Sendable, Codable, CaseIterable {
    case blurry
    case overexposed
    case underexposed
    case lowContrast
}

/// Cut-offs for the retake prompt.
///
/// **These numbers are provisional and must be calibrated against real
/// photographs taken by real staff on real cars before anyone relies on
/// them.** Laplacian variance is not an absolute quantity: it moves with
/// lighting, paint colour and subject distance, so a figure borrowed from a
/// paper or another app means nothing here. The calibration procedure is in
/// the README.
///
/// Deliberately asymmetric: a false "blurry" costs one retake, a missed blur
/// costs a claim. Tuned tight, with the retake ceiling as the escape hatch.
public struct ImageQualityThresholds: Sendable, Equatable {
    public var minLaplacianVariance: Double
    public var maxClippedHighlightFraction: Double
    public var maxClippedShadowFraction: Double
    public var minLuminanceStdDev: Double

    public init(
        minLaplacianVariance: Double,
        maxClippedHighlightFraction: Double,
        maxClippedShadowFraction: Double,
        minLuminanceStdDev: Double
    ) {
        self.minLaplacianVariance = minLaplacianVariance
        self.maxClippedHighlightFraction = maxClippedHighlightFraction
        self.maxClippedShadowFraction = maxClippedShadowFraction
        self.minLuminanceStdDev = minLuminanceStdDev
    }

    public static let provisional = ImageQualityThresholds(
        minLaplacianVariance: 120,
        maxClippedHighlightFraction: 0.12,
        maxClippedShadowFraction: 0.20,
        minLuminanceStdDev: 18
    )

    /// For the odometer and the fuel gauge, where the photograph is worthless
    /// unless the digits can actually be read.
    public static let legibleText = ImageQualityThresholds(
        minLaplacianVariance: 260,
        maxClippedHighlightFraction: 0.06,
        maxClippedShadowFraction: 0.12,
        minLuminanceStdDev: 24
    )
}

public struct ImageQualityReport: Sendable, Codable, Equatable {
    public var laplacianVariance: Double
    public var meanLuminance: Double
    public var luminanceStdDev: Double
    public var clippedHighlightFraction: Double
    public var clippedShadowFraction: Double
    public var issues: [ImageQualityIssue]

    public var passes: Bool { issues.isEmpty }
}

public enum ImageQualityError: Error, Equatable {
    case unreadableImage
    case decodeFailed
}

/// Scores a capture for sharpness and exposure.
///
/// Runs on the archived bytes but never alters them: the file is decoded into
/// a scratch buffer and the original is left exactly as the camera wrote it.
public enum ImageQualityGate {

    /// Every capture is scored at this size regardless of the sensor that
    /// produced it. Laplacian variance scales with resolution, so comparing a
    /// 48MP frame against a 12MP one raw would make the newer phone look
    /// sharper than it is.
    static let analysisMaxDimension = 1024

    public static func evaluate(
        jpeg: Data,
        thresholds: ImageQualityThresholds = .provisional,
        regionOfInterest: Double = 0.7
    ) throws -> ImageQualityReport {
        let gray = try luminancePlane(from: jpeg)
        let roi = gray.centerCrop(fraction: regionOfInterest)

        let variance = roi.laplacianVariance()
        let stats = roi.luminanceStatistics()

        var issues: [ImageQualityIssue] = []
        if variance < thresholds.minLaplacianVariance { issues.append(.blurry) }
        if stats.clippedHighlights > thresholds.maxClippedHighlightFraction { issues.append(.overexposed) }
        if stats.clippedShadows > thresholds.maxClippedShadowFraction { issues.append(.underexposed) }
        if stats.standardDeviation < thresholds.minLuminanceStdDev { issues.append(.lowContrast) }

        return ImageQualityReport(
            laplacianVariance: variance,
            meanLuminance: stats.mean,
            luminanceStdDev: stats.standardDeviation,
            clippedHighlightFraction: stats.clippedHighlights,
            clippedShadowFraction: stats.clippedShadows,
            issues: issues
        )
    }

    static func luminancePlane(from jpeg: Data) throws -> LuminancePlane {
        guard let source = CGImageSourceCreateWithData(jpeg as CFData, nil) else {
            throw ImageQualityError.unreadableImage
        }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: analysisMaxDimension,
            kCGImageSourceShouldCacheImmediately: true,
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
            throw ImageQualityError.decodeFailed
        }
        return try LuminancePlane(image: image)
    }
}

/// An 8-bit grayscale scratch copy of a capture.
struct LuminancePlane {
    let width: Int
    let height: Int
    var pixels: [UInt8]

    init(image: CGImage) throws {
        let pixelWidth = image.width
        let pixelHeight = image.height
        guard pixelWidth > 2, pixelHeight > 2 else { throw ImageQualityError.decodeFailed }

        var buffer = [UInt8](repeating: 0, count: pixelWidth * pixelHeight)
        let drawn: Bool = buffer.withUnsafeMutableBytes { raw -> Bool in
            guard let context = CGContext(
                data: raw.baseAddress,
                width: pixelWidth,
                height: pixelHeight,
                bitsPerComponent: 8,
                bytesPerRow: pixelWidth,
                space: CGColorSpaceCreateDeviceGray(),
                bitmapInfo: CGImageAlphaInfo.none.rawValue
            ) else { return false }
            context.draw(image, in: CGRect(x: 0, y: 0, width: pixelWidth, height: pixelHeight))
            return true
        }
        guard drawn else { throw ImageQualityError.decodeFailed }

        width = pixelWidth
        height = pixelHeight
        pixels = buffer
    }

    init(width: Int, height: Int, pixels: [UInt8]) {
        self.width = width
        self.height = height
        self.pixels = pixels
    }

    /// The car is in the middle of the frame; the tarmac and the sky around it
    /// are not evidence and should not drag the score in either direction.
    func centerCrop(fraction: Double) -> LuminancePlane {
        let clamped = min(max(fraction, 0.1), 1.0)
        guard clamped < 1.0 else { return self }

        let cropWidth = max(3, Int(Double(width) * clamped))
        let cropHeight = max(3, Int(Double(height) * clamped))
        let originX = (width - cropWidth) / 2
        let originY = (height - cropHeight) / 2

        var cropped = [UInt8](repeating: 0, count: cropWidth * cropHeight)
        for row in 0..<cropHeight {
            let sourceStart = (originY + row) * width + originX
            let destinationStart = row * cropWidth
            cropped.replaceSubrange(
                destinationStart..<(destinationStart + cropWidth),
                with: pixels[sourceStart..<(sourceStart + cropWidth)]
            )
        }
        return LuminancePlane(width: cropWidth, height: cropHeight, pixels: cropped)
    }

    /// Variance of the 4-neighbour Laplacian — the standard focus measure.
    /// A sharp edge produces a large second derivative; blur flattens it.
    func laplacianVariance() -> Double {
        var sum = 0.0
        var sumOfSquares = 0.0
        var count = 0.0

        pixels.withUnsafeBufferPointer { buffer in
            for y in 1..<(height - 1) {
                let row = y * width
                for x in 1..<(width - 1) {
                    let index = row + x
                    let response =
                        Double(buffer[index - width])
                        + Double(buffer[index + width])
                        + Double(buffer[index - 1])
                        + Double(buffer[index + 1])
                        - 4.0 * Double(buffer[index])
                    sum += response
                    sumOfSquares += response * response
                    count += 1
                }
            }
        }

        guard count > 0 else { return 0 }
        let mean = sum / count
        return max(0, sumOfSquares / count - mean * mean)
    }

    struct Statistics {
        var mean: Double
        var standardDeviation: Double
        var clippedHighlights: Double
        var clippedShadows: Double
    }

    func luminanceStatistics() -> Statistics {
        var histogram = [Int](repeating: 0, count: 256)
        for pixel in pixels { histogram[Int(pixel)] += 1 }

        let total = Double(pixels.count)
        var sum = 0.0
        var sumOfSquares = 0.0
        for (value, count) in histogram.enumerated() {
            let weight = Double(count)
            sum += Double(value) * weight
            sumOfSquares += Double(value) * Double(value) * weight
        }
        let mean = sum / total
        let variance = max(0, sumOfSquares / total - mean * mean)

        let highlights = histogram[250...].reduce(0, +)
        let shadows = histogram[...5].reduce(0, +)

        return Statistics(
            mean: mean,
            standardDeviation: variance.squareRoot(),
            clippedHighlights: Double(highlights) / total,
            clippedShadows: Double(shadows) / total
        )
    }
}
