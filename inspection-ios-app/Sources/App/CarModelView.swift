import EvidenceCore
import SceneKit
import SwiftUI

/// Red to amber to green, and nothing else.
///
/// The three stops mean three things a photographer can act on: nothing here
/// yet, one angle only, done. Between them the renderer interpolates, so a
/// door that is half covered reads as half covered rather than snapping
/// between states.
enum CoverageColour {
    static func components(_ confidence: Double) -> (r: Double, g: Double, b: Double) {
        let t = min(max(confidence, 0), 1)
        let stops: [(Double, Double, Double)] = [
            (0.86, 0.22, 0.20),   // not photographed
            (0.95, 0.72, 0.16),   // one angle
            (0.24, 0.75, 0.42),   // enough
        ]
        let scaled = t * Double(stops.count - 1)
        let low = Int(scaled)
        guard low < stops.count - 1 else { return stops[stops.count - 1] }
        let mix = scaled - Double(low)
        let a = stops[low], b = stops[low + 1]
        return (a.0 + (b.0 - a.0) * mix, a.1 + (b.1 - a.1) * mix, a.2 + (b.2 - a.2) * mix)
    }

    /// Nothing measures this surface, so it gets no opinion. See
    /// `CarModelMesh.measured`.
    static let unmeasured = (r: 0.55, g: 0.56, b: 0.57)

    static func swiftUI(_ confidence: Double) -> Color {
        let c = components(confidence)
        return Color(red: c.r, green: c.g, blue: c.b)
    }
}

/// The car, big enough to inspect, and turnable.
///
/// This is the answer to "which bit have I not done" when the corner diagram
/// is too small to say. SceneKit's own camera control does the turning, the
/// panning and the pinching, which is both less code and the gestures
/// everyone already has in their fingers.
struct CarModelView: UIViewRepresentable {
    let coverage: SurfaceCoverage

    func makeUIView(context: Context) -> SCNView {
        let view = SCNView()
        view.scene = SCNScene()
        view.backgroundColor = .clear
        view.allowsCameraControl = true
        view.defaultCameraController.interactionMode = .orbitTurntable
        view.defaultCameraController.inertiaEnabled = true
        view.autoenablesDefaultLighting = true
        view.antialiasingMode = .multisampling2X

        let camera = SCNNode()
        camera.camera = SCNCamera()
        camera.position = SCNVector3(6.4, 2.9, 5.2)
        camera.look(at: SCNVector3(0, 0.75, 0))
        view.scene?.rootNode.addChildNode(camera)
        view.pointOfView = camera

        context.coordinator.shell = SCNNode()
        view.scene?.rootNode.addChildNode(context.coordinator.shell)
        return view
    }

    func updateUIView(_ view: SCNView, context: Context) {
        let mesh = CarModelMesh(coverage: coverage)
        context.coordinator.shell.geometry = Self.geometry(from: mesh)
        if context.coordinator.wheels == nil {
            let wheels = Self.wheels(from: mesh)
            context.coordinator.wheels = wheels
            view.scene?.rootNode.addChildNode(wheels)
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    @MainActor
    final class Coordinator {
        var shell = SCNNode()
        var wheels: SCNNode?
    }

    // MARK: - Geometry

    private static func geometry(from mesh: CarModelMesh) -> SCNGeometry {
        let colours = mesh.confidence.indices.map { index -> SIMD3<Float> in
            let c = mesh.measured[index]
                ? CoverageColour.components(Double(mesh.confidence[index]))
                : CoverageColour.unmeasured
            return SIMD3(Float(c.r), Float(c.g), Float(c.b))
        }

        let geometry = SCNGeometry(
            sources: [
                SCNGeometrySource(vertices: mesh.positions.map { SCNVector3($0.x, $0.y, $0.z) }),
                SCNGeometrySource(normals: mesh.normals.map { SCNVector3($0.x, $0.y, $0.z) }),
                SCNGeometrySource(
                    data: Data(bytes: colours, count: colours.count * MemoryLayout<SIMD3<Float>>.stride),
                    semantic: .color,
                    vectorCount: colours.count,
                    usesFloatComponents: true,
                    componentsPerVector: 3,
                    bytesPerComponent: MemoryLayout<Float>.size,
                    dataOffset: 0,
                    dataStride: MemoryLayout<SIMD3<Float>>.stride
                ),
            ],
            elements: [
                SCNGeometryElement(indices: mesh.indices, primitiveType: .triangles)
            ]
        )

        let material = SCNMaterial()
        material.lightingModel = .lambert
        material.diffuse.contents = UIColor.white
        // Both faces: the shell is open underneath and somebody will turn it
        // over, and a car that vanishes when tilted looks broken.
        material.isDoubleSided = true
        geometry.materials = [material]
        return geometry
    }

    /// Four dark discs. Not scored, not coloured — they are there so the eye
    /// knows instantly which way the car is facing, which a smooth shell
    /// cannot say on its own.
    private static func wheels(from mesh: CarModelMesh) -> SCNNode {
        let node = SCNNode()
        for centre in mesh.wheelCentres {
            let wheel = SCNCylinder(
                radius: CGFloat(mesh.wheelRadius), height: CGFloat(mesh.wheelRadius) * 0.62
            )
            let material = SCNMaterial()
            material.lightingModel = .lambert
            material.diffuse.contents = UIColor(white: 0.16, alpha: 1)
            wheel.materials = [material]

            let wheelNode = SCNNode(geometry: wheel)
            wheelNode.eulerAngles = SCNVector3(Float.pi / 2, 0, 0)
            wheelNode.position = SCNVector3(centre.x, centre.y, centre.z)
            node.addChildNode(wheelNode)
        }
        return node
    }
}
