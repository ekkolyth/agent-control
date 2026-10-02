import XCTest
@testable import AgentControlCore

final class HealthTests: XCTestCase {
    func testDecodesTheContractSample() throws {
        let repoRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let sample = repoRoot.appendingPathComponent("testdata/contracts/health.json")
        let health = try JSONDecoder().decode(Health.self, from: Data(contentsOf: sample))

        XCTAssertEqual(health.extensionState, .connected)
        XCTAssertEqual(
            health.tab,
            Health.Tab(id: 42, url: "https://example.com/", title: "Example Domain")
        )
        XCTAssertEqual(health.uptime, 12345)
    }

    func testDecodesADisconnectedServer() throws {
        let body = Data(#"{"extension":"disconnected","tab":null,"uptime":0}"#.utf8)
        let health = try JSONDecoder().decode(Health.self, from: body)
        XCTAssertEqual(health.extensionState, .disconnected)
        XCTAssertNil(health.tab)
    }
}
