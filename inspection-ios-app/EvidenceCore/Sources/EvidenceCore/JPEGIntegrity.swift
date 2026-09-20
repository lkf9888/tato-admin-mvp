import Foundation

/// Structural checks on a JPEG, used to prove that adding metadata did not
/// touch a single pixel.
///
/// "Does it still have EXIF?" is not the question. Some re-encoders copy EXIF
/// across faithfully while re-compressing the image underneath, which is the
/// most dangerous case of all: the file looks untampered and is not. The only
/// honest checks are (a) the entropy-coded scan is byte-identical, and
/// (b) the archived SHA-256 still matches.
public enum JPEGIntegrity {
    private static let marker: UInt8 = 0xFF

    /// Byte offset of the first Start-Of-Scan marker, i.e. where the
    /// compressed image data begins. Everything before it is headers and
    /// metadata; everything from it onward is the picture itself.
    public static func scanOffset(in data: Data) -> Int? {
        let bytes = [UInt8](data)
        guard bytes.count > 4, bytes[0] == marker, bytes[1] == 0xD8 else { return nil }

        var index = 2
        while index + 1 < bytes.count {
            guard bytes[index] == marker else {
                // Fill bytes are legal between segments; anything else means
                // we have lost the structure and must not guess.
                index += 1
                continue
            }
            let code = bytes[index + 1]
            switch code {
            case 0xD8, 0x01, 0xD0...0xD7:
                index += 2                      // standalone markers, no payload
            case 0xDA:
                return index                    // start of scan
            case 0xD9:
                return nil                      // end of image before any scan
            default:
                guard index + 3 < bytes.count else { return nil }
                let length = Int(bytes[index + 2]) << 8 | Int(bytes[index + 3])
                guard length >= 2 else { return nil }
                index += 2 + length
            }
        }
        return nil
    }

    /// True when both files carry exactly the same compressed image data,
    /// however much their headers differ.
    public static func imageDataIsIdentical(_ lhs: Data, _ rhs: Data) -> Bool {
        guard let left = scanOffset(in: lhs), let right = scanOffset(in: rhs) else { return false }
        return lhs[left...] == rhs[right...]
    }
}
