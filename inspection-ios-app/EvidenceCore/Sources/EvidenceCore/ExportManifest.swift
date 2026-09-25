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
            "Walk-around:  photographed from \(Int(manifest.headings.fraction * 100))% of the directions around the vehicle",
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

        // ⚠️ Stated as what it is. The figure above is which ways the camera
        // faced, from the phone's motion sensor. It is not a measurement of
        // the car's surface, and a document an adjuster reads must not let it
        // pass for one.
        let missing = manifest.progress().outstanding
        if !missing.isEmpty {
            lines.append("")
            lines.append("The guided shot list was not completed. Still short:")
            for requirement in missing {
                lines.append("  \(requirement.step.rawValue): \(requirement.shortBy) more")
            }
        }

        return lines.joined(separator: "\n") + "\n"
    }
}
