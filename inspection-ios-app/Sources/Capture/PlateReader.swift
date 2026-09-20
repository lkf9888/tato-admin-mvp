import Foundation
import Vision

/// Reads the licence plate out of the photographs as they are taken, so
/// nobody has to type it.
///
/// Runs on the archived JPEG rather than on a live frame: the photographs are
/// already being taken, and a full-resolution still is a far better subject
/// for text recognition than a preview frame. It costs nothing the
/// photographer can feel because it happens after the shutter, off the main
/// actor.
///
/// It votes rather than trusts. A plate is photographed from several angles
/// over a walk-around, and the reading that keeps coming back is the reading
/// to believe — one confident misread of a dealer sticker loses to four
/// agreeing looks at the plate itself.
actor PlateReader {

    private var tally: [String: Int] = [:]

    /// The reading seen most often, and how sure that makes us.
    var best: (plate: String, sightings: Int)? {
        tally.max { $0.value < $1.value }.map { ($0.key, $0.value) }
    }

    /// Enough agreement to put in the box without making somebody check it.
    var confident: String? {
        guard let best, best.sightings >= 2 else { return nil }
        return best.plate
    }

    func read(jpeg: Data) async {
        for candidate in await Self.candidates(in: jpeg) {
            tally[candidate, default: 0] += 1
        }
    }

    /// Plate-shaped strings found in an image.
    ///
    /// Deliberately loose about format and strict about shape. North American
    /// plates vary by province and state; what they have in common is a short
    /// run of letters and digits with no spaces. Anything with a word in it
    /// is a badge, a sticker or a car park sign.
    private static func candidates(in jpeg: Data) async -> [String] {
        await withCheckedContinuation { continuation in
            let request = VNRecognizeTextRequest { request, _ in
                let observations = request.results as? [VNRecognizedTextObservation] ?? []
                let found = observations
                    .compactMap { $0.topCandidates(1).first?.string }
                    .flatMap { $0.split(whereSeparator: { !$0.isLetterOrDigit }) }
                    .map { String($0).uppercased() }
                    .filter(isPlateShaped)
                continuation.resume(returning: found)
            }
            request.recognitionLevel = .accurate
            request.usesLanguageCorrection = false

            let handler = VNImageRequestHandler(data: jpeg, options: [:])
            do {
                try handler.perform([request])
            } catch {
                continuation.resume(returning: [])
            }
        }
    }

    static func isPlateShaped(_ text: String) -> Bool {
        guard (5...8).contains(text.count) else { return false }
        let letters = text.filter(\.isLetter).count
        let digits = text.filter(\.isNumber).count
        // Every plate has both. A run of digits is a VIN fragment or a price;
        // a run of letters is a word.
        guard letters > 0, digits > 0, letters + digits == text.count else { return false }
        return true
    }
}

private extension Character {
    var isLetterOrDigit: Bool { isLetter || isNumber }
}
