import XCTest
@testable import AgentControlCore

@MainActor
final class ServerProcessTests: XCTestCase {
    private var dir: URL!

    override func setUp() async throws {
        dir = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }

    override func tearDown() async throws {
        try? FileManager.default.removeItem(at: dir)
    }

    private func script(_ body: String) throws -> URL {
        let url = dir.appendingPathComponent("server.sh")
        try ("#!/bin/sh\n" + body).write(to: url, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: url.path)
        return url
    }

    private struct LaunchContract: Decodable {
        struct Flags: Decodable {
            let port: String
            let exitOnStdinClose: String
        }

        struct ExitCodes: Decodable {
            let portInUse: Int32
        }

        let flags: Flags
        let exitCodes: ExitCodes
    }

    private func launchContract() throws -> LaunchContract {
        let repoRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let sample = repoRoot.appendingPathComponent("testdata/contracts/launch.json")
        return try JSONDecoder().decode(LaunchContract.self, from: Data(contentsOf: sample))
    }

    private func read(_ name: String) -> String {
        (try? String(contentsOf: dir.appendingPathComponent(name), encoding: .utf8)) ?? ""
    }

    private func launches() -> Int {
        read("launches").split(separator: "\n").count
    }

    private func waitUntil(timeout: TimeInterval, _ condition: () -> Bool) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while !condition() {
            if Date() > deadline { XCTFail("condition not met within \(timeout)s"); return }
            try await Task.sleep(for: .milliseconds(50))
        }
    }

    func testGivesUpAfterThreeExitsWithTheExitStatus() async throws {
        let counter = dir.appendingPathComponent("launches").path
        let exe = try script("echo x >> '\(counter)'\nexit 3\n")
        let server = ServerProcess(executableURL: exe, logURL: dir.appendingPathComponent("server.log"))
        var seen: [ServerProcess.State] = []
        server.onStateChange = { seen.append($0) }

        server.start(port: 3660)
        try await waitUntil(timeout: 2) { self.launches() >= 1 }
        let firstLaunch = Date()
        try await waitUntil(timeout: 4) { self.launches() >= 2 }
        let secondLaunch = Date()
        try await waitUntil(timeout: 6) { self.launches() >= 3 }
        let thirdLaunch = Date()
        XCTAssertGreaterThanOrEqual(secondLaunch.timeIntervalSince(firstLaunch), 0.9, "first restart waits 1s")
        XCTAssertGreaterThanOrEqual(thirdLaunch.timeIntervalSince(secondLaunch), 1.5, "second restart waits 2s")
        try await waitUntil(timeout: 8) { server.state == .crashed(exitStatus: 3) }
        XCTAssertEqual(launches(), 3)
        XCTAssertEqual(seen.last, .crashed(exitStatus: 3))

        try await Task.sleep(for: .seconds(5))
        XCTAssertEqual(launches(), 3, "no restart after giving up")
    }

    func testStartAfterCrashLaunchesAgain() async throws {
        let counter = dir.appendingPathComponent("launches").path
        let exe = try script("echo x >> '\(counter)'\nexit 1\n")
        let server = ServerProcess(executableURL: exe, logURL: dir.appendingPathComponent("server.log"))
        server.start(port: 1)
        try await waitUntil(timeout: 8) { server.state == .crashed(exitStatus: 1) }

        server.start(port: 1)
        try await waitUntil(timeout: 2) { self.launches() == 4 }
    }

    func testPassesTheLaunchContract() async throws {
        let flags = try launchContract().flags
        let args = dir.appendingPathComponent("args").path
        let exe = try script("echo \"$@ LOG_PRETTY=$LOG_PRETTY\" > '\(args)'\nexec sleep 30\n")
        let server = ServerProcess(executableURL: exe, logURL: dir.appendingPathComponent("server.log"))
        server.start(port: 4242)
        try await waitUntil(timeout: 2) { !self.read("args").isEmpty }
        XCTAssertEqual(
            read("args").trimmingCharacters(in: .whitespacesAndNewlines),
            "\(flags.port) 4242 \(flags.exitOnStdinClose) LOG_PRETTY=false"
        )
        server.stop()
    }

    func testPortInUseExitStatusMatchesTheLaunchContract() throws {
        XCTAssertEqual(ServerProcess.portInUseExitStatus, try launchContract().exitCodes.portInUse)
        XCTAssertTrue(ServerProcess.State.crashed(exitStatus: 3).isPortInUse)
        XCTAssertFalse(ServerProcess.State.crashed(exitStatus: 1).isPortInUse)
        XCTAssertFalse(ServerProcess.State.crashed(exitStatus: nil).isPortInUse)
        XCTAssertFalse(ServerProcess.State.running.isPortInUse)
    }

    func testStopEscalatesToSigkillAfterTwoSeconds() async throws {
        let ready = dir.appendingPathComponent("ready").path
        let pidFile = dir.appendingPathComponent("pid").path
        let exe = try script("trap '' TERM\necho $$ > '\(pidFile)'\necho x > '\(ready)'\nwhile true; do sleep 0.1; done\n")
        let server = ServerProcess(executableURL: exe, logURL: dir.appendingPathComponent("server.log"))
        server.start(port: 1)
        // .running only means the process spawned; wait until the trap is installed
        try await waitUntil(timeout: 2) { !self.read("ready").isEmpty }
        let pid = try XCTUnwrap(Int32(read("pid").trimmingCharacters(in: .whitespacesAndNewlines)))

        // stop() blocks the main actor; if escalation regresses this frees it so the test fails instead of hanging
        let watchdog = Task.detached {
            try? await Task.sleep(for: .seconds(4))
            kill(pid, SIGKILL)
        }
        defer { watchdog.cancel() }

        let began = Date()
        server.stop()
        let elapsed = Date().timeIntervalSince(began)
        XCTAssertGreaterThanOrEqual(elapsed, 2)
        XCTAssertLessThan(elapsed, 3.5, "stop() needed the watchdog; SIGKILL escalation is broken")
        XCTAssertEqual(server.state, .stopped)
        XCTAssertEqual(kill(pid, 0), -1, "child \(pid) survived stop()")
    }

    func testStopThenStartIgnoresTheOldChildsExit() async throws {
        let counter = dir.appendingPathComponent("launches").path
        let pids = dir.appendingPathComponent("pids").path
        let exe = try script("echo x >> '\(counter)'\necho $$ >> '\(pids)'\nexec sleep 30\n")
        let server = ServerProcess(executableURL: exe, logURL: dir.appendingPathComponent("server.log"))
        // a failed run must not leave stand-ins behind
        addTeardownBlock { [dir] in
            let text = (try? String(contentsOf: dir!.appendingPathComponent("pids"), encoding: .utf8)) ?? ""
            for pid in text.split(separator: "\n").compactMap({ Int32($0) }) {
                kill(pid, SIGKILL)
            }
        }

        server.start(port: 1)
        try await waitUntil(timeout: 2) { self.launches() == 1 }
        server.stop()
        server.start(port: 1)
        try await waitUntil(timeout: 2) { self.launches() == 2 }

        // the old child's termination lands after the restart; backoff is 1s
        try await Task.sleep(for: .milliseconds(1500))
        XCTAssertEqual(launches(), 2, "no restart from the old child's exit")
        XCTAssertEqual(server.state, .running)

        server.stop()
        XCTAssertEqual(server.state, .stopped)
        let pidList = read("pids").split(separator: "\n").compactMap { Int32($0) }
        XCTAssertEqual(pidList.count, 2)
        for pid in pidList {
            XCTAssertEqual(kill(pid, 0), -1, "child \(pid) survived stop()")
        }
    }

    func testStopDuringBackoffPreventsTheRestart() async throws {
        let counter = dir.appendingPathComponent("launches").path
        let exe = try script("echo x >> '\(counter)'\nexit 1\n")
        let server = ServerProcess(executableURL: exe, logURL: dir.appendingPathComponent("server.log"))
        server.start(port: 1)
        try await waitUntil(timeout: 2) { self.launches() == 1 && server.state == .starting }
        server.stop()
        try await Task.sleep(for: .seconds(2))
        XCTAssertEqual(launches(), 1)
        XCTAssertEqual(server.state, .stopped)
    }

    func testOutputIsAppendedToTheLogFile() async throws {
        let logDir = dir.appendingPathComponent("logs")
        try FileManager.default.createDirectory(at: logDir, withIntermediateDirectories: true)
        let previousRun = "previous run\n"
        try previousRun.write(to: logDir.appendingPathComponent("server.log"), atomically: true, encoding: .utf8)
        let exe = try script("echo out\necho err >&2\nexec sleep 30\n")
        let server = ServerProcess(executableURL: exe, logURL: logDir.appendingPathComponent("server.log"))
        server.start(port: 1)
        try await waitUntil(timeout: 2) {
            let text = self.read("logs/server.log")
            return text.contains("out") && text.contains("err")
        }
        server.stop()
        XCTAssertTrue(read("logs/server.log").hasPrefix(previousRun), "earlier log content was overwritten")
    }
}
