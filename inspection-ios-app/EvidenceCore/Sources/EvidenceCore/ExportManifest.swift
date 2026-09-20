import Foundation

/// The text file that ships beside the photographs.
///
/// Anyone holding the folder can recompute every digest and check it against
/// this, without trusting us, our server, or each other. Plain text on
/// purpose: a recipient's lawyer can read it, and `shasum -c` can verify it.
public enum ExportManifest {

    public static func plainText(for manifest: SessionManifest, plan: [ShotSlot] = ShotPlan.standard) -> String {
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
            "",
            "Photographs are the files the camera produced. Their metadata was",
            "written at the moment of capture and nothing has been re-encoded.",
            "Each SHA-256 below covers the file exactly as shipped.",
            "",
        ]

        for slot in plan {
            guard let record = manifest.acceptedRecord(forSlot: slot.id) else {
                lines.append("MISSING   \(slot.id)  (\(slot.titleEN))")
                continue
            }
            lines.append("\(record.sha256)  \(record.filename)")
            lines.append("          \(slot.titleEN), taken \(formatter.string(from: record.capturedAt))")

            var notes: [String] = []
            if !record.evidence.isClaimReady {
                notes.append("no geolocation recorded")
            }
            if record.stationVerified == false {
                notes.append("not taken from the planned position")
            }
            if !record.acceptedDespite.isEmpty {
                notes.append("accepted despite: " + record.acceptedDespite.map(\.rawValue).joined(separator: ", "))
            }
            if record.attempt > 1 {
                notes.append("attempt \(record.attempt)")
            }
            // Stated rather than buried. A record that quietly omits its own
            // weak points is worth less than one that lists them, because the
            // first thing an opponent does is look for what was left out.
            if !notes.isEmpty {
                lines.append("          note: " + notes.joined(separator: "; "))
            }
        }

        return lines.joined(separator: "\n") + "\n"
    }
}
