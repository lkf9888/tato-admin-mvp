import Foundation

/// A reason a photograph would be thrown out before anyone looked at it.
public enum EvidenceGap: String, Sendable, Codable, CaseIterable {
    case notJPEG
    case noCaptureTime
    case noTimeZoneOffset
    case noLocation
}

public struct EvidenceCheck: Sendable, Codable, Equatable {
    public var gaps: [EvidenceGap]

    /// Nothing missing that would get the photo rejected unread.
    public var isClaimReady: Bool { gaps.isEmpty }

    public init(gaps: [EvidenceGap]) { self.gaps = gaps }
}

/// The floor a capture has to clear to be worth archiving as evidence.
///
/// Turo's rule is blunt: a photo whose metadata lacks date, time or
/// geolocation is deemed invalid. That is not a quality judgement on the
/// photograph — it is never looked at. So this check runs on the bytes the
/// camera produced, against the real EXIF IFDs, before anything is filed.
///
/// A capture that fails is not silently dropped and not silently fixed.
/// It is archived with its gaps recorded, and the staff member is told to
/// take it again — usually because location services were off, which is a
/// thing a person can walk over and change.
public enum EvidenceRequirements {

    public static func check(jpeg: Data) -> EvidenceCheck {
        guard let exif = ExifReader(jpeg: jpeg) else {
            return EvidenceCheck(gaps: [.notJPEG])
        }

        var gaps: [EvidenceGap] = []
        if exif.captureTime == nil { gaps.append(.noCaptureTime) }
        // Without the offset, a timestamp near midnight cannot be placed on
        // one side or the other of a 24-hour window.
        if exif.utcOffset == nil { gaps.append(.noTimeZoneOffset) }
        if !exif.hasLocation { gaps.append(.noLocation) }
        return EvidenceCheck(gaps: gaps)
    }
}
