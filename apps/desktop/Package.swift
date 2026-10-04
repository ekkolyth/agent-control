// swift-tools-version:5.9
import PackageDescription

var targets: [Target] = [
    .target(name: "AgentControlCore", path: "Sources/AgentControlCore"),
    .testTarget(
        name: "AgentControlCoreTests",
        dependencies: ["AgentControlCore"],
        path: "Tests/AgentControlCoreTests"
    ),
]

// the app target needs SwiftUI and AppKit; declaring it only on macOS lets the
// core library build and test on Linux
#if os(macOS)
targets.append(
    .executableTarget(
        name: "AgentControl",
        dependencies: ["AgentControlCore"],
        path: "Sources/AgentControl"
    )
)
#endif

let package = Package(
    name: "AgentControl",
    platforms: [.macOS(.v13)],
    targets: targets
)
