import Foundation

/// The text file that ships beside the photographs.
///
/// Anyone holding the folder can recompute every digest and check it against
/// this, without trusting us, our server, or each other. Plain text on
/// purpose: a recipient's lawyer can read it, and `shasum -c` can verify it.
public enum ExportManifest {

    public static func plainText(for manifest: SessionManifest) -> String {
        let formatter = ISO8601DateFormatter()
        var lines: [String] = [
            "TATO vehicle condition record",
            "",
            "Vehicle:      \(manifest.vehicleLabel)",
            "Occasion:     \(manifest.kind == .checkout ? "Handover to guest" : "Return from guest")",
            "Photographer: \(manifest.staffLabel)",
            "Device:       \(manifest.deviceModel)",
            "Software:     \(manifest.appVersion)",
            "Started:      \(formatter.string(from: manifest.startedAt)) (\(manifest.timeZoneIdentifier))",
            "Photographs:  \(manifest.exteriorShots) exterior, \(manifest.interiorShots) interior",
            "Coverage:     \(Int(manifest.coverage.fraction * 100))% of the vehicle's surface",
            "",
            "Photographs are the files the camera produced. Their metadata was",
            "written at the moment of capture and nothing has been re-encoded.",
            "Each SHA-256 below covers the file exactly as shipped.",
            "",
        ]

        for record in manifest.acceptedRecords.sorted(by: { $0.sequence < $1.sequence }) {
            lines.append("\(record.sha256)  \(record.filename)")
            lines.append("          \(record.region.rawValue), taken \(formatter.string(from: record.capturedAt))")

            var notes: [String] = []
            if !record.evidence.isClaimReady { notes.append("no geolocation recorded") }
            if !record.acceptedDespite.isEmpty {
                notes.append("accepted despite: " + record.acceptedDespite.map(\.rawValue).joined(separator: ", "))
            }
            // Stated rather than buried. A record that quietly omits its own
            // weak points is worth less than one that lists them, because the
            // first thing an opponent does is look for what was left out.
            if !notes.isEmpty { lines.append("          note: " + notes.joined(separator: "; ")) }
        }

        if manifest.coverage.fraction < 0.999, let thin = manifest.coverage.thinnestRegion() {
            lines.append("")
            lines.append("Least-covered area: \(thin.rawValue).")
        }

        return lines.joined(separator: "\n") + "\n"
    }
}
