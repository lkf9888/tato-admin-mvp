import XCTest
import simd
@testable import EvidenceCore

/// The skin may be prettier than the measurement, but it may never say
/// anything the measurement does not.
final class CarModelMeshTests: XCTestCase {

    func testEveryTriangleIndexPointsAtAVertex() {
        let mesh = CarModelMesh(coverage: SurfaceCoverage())
        XCTAssertFalse(mesh.indices.isEmpty)
        XCTAssertEqual(mesh.indices.count % 3, 0)
        for index in mesh.indices {
            XCTAssertTrue(mesh.positions.indices.contains(Int(index)), "index \(index) is off the end")
        }
        XCTAssertEqual(mesh.positions.count, mesh.normals.count)
        XCTAssertEqual(mesh.positions.count, mesh.confidence.count)
    }

    func testAnUnphotographedCarIsEntirelyAtZero() {
        XCTAssertEqual(CarModelMesh(coverage: SurfaceCoverage()).confidence.max(), 0)
    }

    // MARK: - It has to be an SUV, not a loaf

    /// Heights along the centre line, which is where a car is a car.
    private func roofline(_ mesh: CarModelMesh) -> [(x: Float, y: Float)] {
        var tallest: [Float: Float] = [:]
        for point in mesh.positions where abs(point.z) < 0.12 {
            tallest[round(point.x * 20) / 20] = max(tallest[round(point.x * 20) / 20] ?? 0, point.y)
        }
        return tallest.map { (x: $0.key, y: $0.value) }.sorted { $0.x > $1.x }
    }

    func testItHasABonnetTheRoofDoesNotRunOver() {
        let mesh = CarModelMesh(coverage: SurfaceCoverage())
        let line = roofline(mesh)
        let bonnet = line.filter { $0.x > 1.0 }.map(\.y).max() ?? 0
        let cabin = line.filter { abs($0.x) < 0.5 }.map(\.y).max() ?? 0
        XCTAssertLessThan(bonnet, cabin * 0.75, "the roof runs the whole length: that is a loaf")
        XCTAssertGreaterThan(bonnet, 0.6, "there is no bonnet at all")
    }

    func testTheRoofIsFlatAcrossTheCabin() {
        let mesh = CarModelMesh(coverage: SurfaceCoverage())
        let cabin = roofline(mesh).filter { (-0.5...0.0).contains($0.x) }.map(\.y)
        let spread = (cabin.max() ?? 0) - (cabin.min() ?? 0)
        XCTAssertLessThan(spread, 0.06, "the roof of an SUV does not dome")
    }

    func testTheTailgateIsSteeperThanTheWindscreen() {
        let mesh = CarModelMesh(coverage: SurfaceCoverage())
        let line = roofline(mesh)
        func drop(from a: Float, to b: Float) -> Float {
            let here = line.filter { ($0.x - a) * ($0.x - b) <= 0 }
            guard let high = here.map(\.y).max(), let low = here.map(\.y).min() else { return 0 }
            return (high - low) / abs(a - b)
        }
        XCTAssertGreaterThan(drop(from: -2.0, to: -1.2), drop(from: 1.6, to: 0.3),
                             "an SUV drops off the back faster than it rakes at the front")
    }

    // MARK: - The reading

    /// Straight off the nose at waist height is sector 0, band body.
    func testAPointOnTheNoseReadsTheNosePatch() {
        let reading = CarModelMesh.reading(
            of: SIMD3(2.2, 0.95, 0), normal: SIMD3(1, 0, 0), semiLength: 2.3, semiWidth: 0.93
        )
        XCTAssertEqual(reading?.sector, 0)
        XCTAssertEqual(reading?.band, .body)
    }

    /// A quarter of the way round is the flank, and it must not be read with
    /// the nose's paint. Using a plain compass bearing instead of the
    /// ellipse parameter is exactly how that goes wrong.
    func testAPointOnTheFlankReadsTheFlankPatch() {
        let reading = CarModelMesh.reading(
            of: SIMD3(0, 0.95, 0.93), normal: SIMD3(0, 0, 1), semiLength: 2.3, semiWidth: 0.93
        )
        XCTAssertEqual(reading?.sector, SurfaceCoverage.sectorCount / 4)
    }

    /// Anything facing the sky is roof, whatever height the skin puts it at —
    /// an SUV's roof stands well above the band the maths scores it in.
    func testAnythingFacingTheSkyIsRoof() {
        let reading = CarModelMesh.reading(
            of: SIMD3(0, 1.62, 0), normal: SIMD3(0, 1, 0), semiLength: 2.3, semiWidth: 0.93
        )
        XCTAssertEqual(reading?.band, .roof)
    }

    /// ⚠️ The bonnet is a horizontal panel that no band covers, so it has
    /// no reading at all. Borrowing the nose's instead would put a colour on
    /// a panel nobody checked.
    func testTheBonnetHasNoReadingRatherThanABorrowedOne() {
        XCTAssertNil(CarModelMesh.reading(
            of: SIMD3(1.5, 0.88, 0), normal: SIMD3(0.15, 0.98, 0), semiLength: 2.3, semiWidth: 0.93
        ))
        let mesh = CarModelMesh(coverage: SurfaceCoverage())
        XCTAssertTrue(mesh.measured.contains(false), "nothing is marked unmeasured")
        XCTAssertTrue(mesh.measured.contains(true), "everything is marked unmeasured")
    }

    /// Paint one patch and only its part of the skin lights up.
    func testPaintingOnePatchLightsUpThatPatchOnly() {
        var coverage = SurfaceCoverage()
        let patch = CoveragePatch(sector: 0, band: .body)
        coverage.add([patch]); coverage.add([patch])

        let mesh = CarModelMesh(coverage: coverage)
        let lit = mesh.confidence.indices.filter { mesh.confidence[$0] > 0.9 && mesh.measured[$0] }
        XCTAssertFalse(lit.isEmpty, "nothing lit up")
        for index in lit {
            XCTAssertGreaterThan(mesh.positions[index].x, 0.3, "lit something behind the axle")
            XCTAssertLessThan(abs(mesh.positions[index].z), 0.7, "lit the flank, not the nose")
        }
    }

    /// Writes the real mesh out so it can be looked at before it ships. A
    /// model nobody has seen is a model nobody has checked.
    func testDumpForPreview() throws {
        var coverage = SurfaceCoverage()
        for sector in 0..<SurfaceCoverage.sectorCount {
            let bearing = Double(sector) / Double(SurfaceCoverage.sectorCount) * 360
            let hits = bearing < 60 || bearing > 300 ? 2 : (bearing < 150 || bearing > 240 ? 1 : 0)
            for band in [SurfaceBand.sill, .body, .glass] where hits > 0 {
                for _ in 0..<hits { coverage.add([CoveragePatch(sector: sector, band: band)]) }
            }
        }
        let mesh = CarModelMesh(coverage: coverage)
        let payload: [String: Any] = [
            "positions": mesh.positions.flatMap { [$0.x, $0.y, $0.z] },
            "normals": mesh.normals.flatMap { [$0.x, $0.y, $0.z] },
            "confidence": mesh.confidence,
            "measured": mesh.measured,
            "indices": mesh.indices,
            "wheels": mesh.wheelCentres.flatMap { [$0.x, $0.y, $0.z] },
            "wheelRadius": mesh.wheelRadius,
        ]
        let data = try JSONSerialization.data(withJSONObject: payload)
        try data.write(to: URL(fileURLWithPath: "/tmp/carpreview/mesh.json"))
    }
}
