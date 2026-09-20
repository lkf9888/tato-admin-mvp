import CoreLocation
import EvidenceCore

/// Supplies the coordinate that goes into each photograph, or nothing at all.
///
/// A claim photo without geolocation is rejected unread, so this is not a
/// nice-to-have — but the response to a missing fix is to say so and let
/// somebody switch location services on, never to reach for the last known
/// position and hope.
@MainActor
@Observable
final class LocationProvider: NSObject, CLLocationManagerDelegate {

    /// Beyond this, a fix is from somewhere else. Two minutes of walking
    /// around a car is nothing; two minutes of driving is a different street,
    /// and a photograph tagged with the wrong street is worse than one tagged
    /// with nowhere.
    private static let maximumFixAge: TimeInterval = 120

    private let manager = CLLocationManager()
    private(set) var authorization: CLAuthorizationStatus = .notDetermined
    private(set) var latest: CLLocation?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
    }

    func start() {
        if manager.authorizationStatus == .notDetermined {
            manager.requestWhenInUseAuthorization()
        }
        manager.startUpdatingLocation()
    }

    func stop() {
        manager.stopUpdatingLocation()
    }

    /// The fix to stamp into a photo taken right now, or nil if there is not
    /// a current one.
    func currentFix(now: Date = Date()) -> CaptureLocation? {
        guard let location = latest else { return nil }
        guard now.timeIntervalSince(location.timestamp) <= Self.maximumFixAge else { return nil }
        guard location.horizontalAccuracy > 0 else { return nil }

        return CaptureLocation(
            latitude: location.coordinate.latitude,
            longitude: location.coordinate.longitude,
            // A vertical accuracy of zero or less means the altitude is not a
            // measurement, so it is left out rather than written as sea level.
            altitude: location.verticalAccuracy > 0 ? location.altitude : nil,
            horizontalAccuracy: location.horizontalAccuracy,
            timestamp: location.timestamp,
            // CoreLocation fuses GNSS with wifi and cell. Calling that
            // "satellite" would overstate it; either way the phone measured
            // it, which is what separates both from a typed-in coordinate.
            source: .fused
        )
    }

    var isReady: Bool { currentFix() != nil }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let last = locations.last else { return }
        Task { @MainActor in self.latest = last }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        // Deliberately `self.manager` rather than the delegate argument: the
        // same object, but reached from the actor that owns it instead of
        // handed across a boundary it cannot safely cross.
        Task { @MainActor in
            self.authorization = status
            if status == .authorizedWhenInUse || status == .authorizedAlways {
                self.manager.startUpdatingLocation()
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        // Nothing to do but keep the last good fix and let it age out. A
        // failure here surfaces as "no fix", which is the honest reading.
    }
}
