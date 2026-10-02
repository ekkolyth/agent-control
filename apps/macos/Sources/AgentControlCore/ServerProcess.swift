import Foundation
#if canImport(Glibc)
import Glibc
#elseif canImport(Darwin)
import Darwin
#endif

// pipe handlers run off the main actor, so writes share one lock
private final class LogWriter: @unchecked Sendable {
    private let handle: FileHandle?
    private let lock = NSLock()

    init(url: URL) {
        let fileManager = FileManager.default
        try? fileManager.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        if !fileManager.fileExists(atPath: url.path) {
            _ = fileManager.createFile(atPath: url.path, contents: nil)
        }
        handle = try? FileHandle(forWritingTo: url)
        _ = try? handle?.seekToEnd()
    }

    func append(_ data: Data) {
        lock.lock()
        defer { lock.unlock() }
        try? handle?.write(contentsOf: data)
    }
}

@MainActor
public final class ServerProcess {
    public enum State: Equatable, Sendable {
        case stopped
        case starting
        case running
        // nil when Process.run() itself threw
        case crashed(exitStatus: Int32?)
    }

    public private(set) var state: State = .stopped {
        didSet {
            if state != oldValue { onStateChange?(state) }
        }
    }

    public var onStateChange: ((State) -> Void)?

    private let executableURL: URL
    private let logURL: URL
    private var logWriter: LogWriter?
    private var port = 0
    private var process: Process?
    // held for the child's lifetime; the server exits when it closes
    private var stdinPipe: Pipe?
    private var stopping = false
    // a Process address can be reused after stop() then start(), so exits are matched by launch number
    private var generation = 0
    private var exitTimes: [Date] = []
    private var restartTask: Task<Void, Never>?

    private static let crashWindow: TimeInterval = 10
    private static let maxExitsInWindow = 3

    public init(executableURL: URL, logURL: URL) {
        self.executableURL = executableURL
        self.logURL = logURL
    }

    public func start(port: Int) {
        stopping = false
        restartTask?.cancel()
        restartTask = nil
        exitTimes = []
        self.port = port
        launch()
    }

    public func stop() {
        stopping = true
        restartTask?.cancel()
        restartTask = nil
        guard let process else {
            state = .stopped
            return
        }
        self.process = nil
        if process.isRunning {
            process.terminate()
            let deadline = Date().addingTimeInterval(2)
            while process.isRunning, Date() < deadline {
                Thread.sleep(forTimeInterval: 0.05)
            }
            if process.isRunning {
                kill(process.processIdentifier, SIGKILL)
            }
            process.waitUntilExit()
        }
        stdinPipe = nil
        state = .stopped
    }

    private func launch() {
        state = .starting
        generation += 1
        let launchGeneration = generation

        let writer = logWriter ?? LogWriter(url: logURL)
        logWriter = writer

        let child = Process()
        child.executableURL = executableURL
        child.arguments = ["--port", String(port), "--exit-on-stdin-close"]
        child.environment = ProcessInfo.processInfo.environment.merging(["LOG_PRETTY": "false"]) { _, new in new }

        let stdin = Pipe()
        child.standardInput = stdin
        let stdout = Pipe()
        let stderr = Pipe()
        child.standardOutput = stdout
        child.standardError = stderr
        for output in [stdout, stderr] {
            output.fileHandleForReading.readabilityHandler = { handle in
                let data = handle.availableData
                if data.isEmpty {
                    handle.readabilityHandler = nil
                } else {
                    writer.append(data)
                }
            }
        }

        child.terminationHandler = { [weak self] exited in
            let status = exited.terminationStatus
            Task { @MainActor in
                self?.handleExit(ofLaunch: launchGeneration, status: status)
            }
        }

        do {
            try child.run()
        } catch {
            state = .crashed(exitStatus: nil)
            return
        }
        process = child
        stdinPipe = stdin
        state = .running
    }

    private func handleExit(ofLaunch launchGeneration: Int, status: Int32) {
        guard !stopping, process != nil, launchGeneration == generation else { return }
        process = nil
        stdinPipe = nil

        let now = Date()
        exitTimes = exitTimes.filter { now.timeIntervalSince($0) < Self.crashWindow }
        exitTimes.append(now)
        if exitTimes.count >= Self.maxExitsInWindow {
            state = .crashed(exitStatus: status)
            return
        }

        state = .starting
        let delay = exitTimes.count == 1 ? 1 : 2
        restartTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(delay))
            guard !Task.isCancelled, let self, !self.stopping else { return }
            self.launch()
        }
    }
}
