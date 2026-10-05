import AgentControlCore
import AppKit
import SwiftUI

@MainActor
final class AppModel: ObservableObject {
    @Published private(set) var serverState: ServerProcess.State = .stopped
    @Published private(set) var health: Health?
    let settings = AppSettings()
    let logURL = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Logs/AgentControl/server.log")
    private let server: ServerProcess
    private let healthClient = HealthClient()

    init() {
        let executable = Bundle.main.bundleURL
            .appendingPathComponent("Contents/MacOS/agent-control-server")
        server = ServerProcess(executableURL: executable, logURL: logURL)
        server.onStateChange = { [weak self] in self?.serverState = $0 }
        healthClient.onChange = { [weak self] in self?.health = $0 }
    }

    var mcpURL: String { "http://127.0.0.1:\(settings.port)/mcp" }

    func launch() {
        server.start(port: settings.port)
        healthClient.start(port: settings.port)
    }

    func changePort(_ port: Int) {
        guard port != settings.port else { return }
        settings.port = port
        server.stop()
        launch()
    }

    // the new instance is opened only once this process has exited, so it never
    // races the old instance's server for the port
    func restartApp() {
        let relauncher = Process()
        relauncher.executableURL = URL(fileURLWithPath: "/bin/sh")
        relauncher.arguments = [
            "-c",
            "while kill -0 \(ProcessInfo.processInfo.processIdentifier) 2>/dev/null; do sleep 0.1; done; open \"$0\"",
            Bundle.main.bundlePath,
        ]
        do {
            try relauncher.run()
        } catch {
            return
        }
        NSApplication.shared.terminate(nil)
    }

    func shutdown() {
        healthClient.stop()
        server.stop()
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    let model = AppModel()

    func applicationDidFinishLaunching(_ notification: Notification) {
        model.launch()
    }

    func applicationWillTerminate(_ notification: Notification) {
        model.shutdown()
    }
}

@main
struct AgentControlApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate

    var body: some Scene {
        MenuBarExtra {
            MenuContent(model: delegate.model)
        } label: {
            Image(nsImage: BotIcon.image)
        }
        Settings {
            SettingsView(model: delegate.model, settings: delegate.model.settings)
        }
    }
}

struct MenuContent: View {
    @ObservedObject var model: AppModel

    var body: some View {
        Text(serverStatus)
        Text(model.health?.extensionState == .connected ? "Extension connected" : "Extension disconnected")
        if let title = model.health?.tab?.title {
            Text(title)
        }
        Divider()
        if case .crashed = model.serverState {
            Button("Restart") { model.restartApp() }
        }
        Button("Copy MCP URL") {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(model.mcpURL, forType: .string)
        }
        Button("Open Logs") {
            NSWorkspace.shared.activateFileViewerSelecting([model.logURL])
        }
        settingsButton
        Divider()
        Button("Quit") { NSApplication.shared.terminate(nil) }
    }

    private var serverStatus: String {
        switch model.serverState {
        case .stopped: return "Server stopped"
        case .starting: return "Server starting"
        case .running: return model.health == nil ? "Server not responding" : "Server running"
        case .crashed:
            return model.serverState.isPortInUse
                ? "Port \(model.settings.port) is already in use"
                : "The server stopped unexpectedly"
        }
    }

    // SettingsLink only exists from macOS 14; 13 opens the window by selector
    @ViewBuilder private var settingsButton: some View {
        if #available(macOS 14, *) {
            SettingsLink { Text("Settings…") }
        } else {
            Button("Settings…") {
                NSApp.activate(ignoringOtherApps: true)
                NSApp.sendAction(Selector(("showSettingsWindow:")), to: nil, from: nil)
            }
        }
    }
}

struct SettingsView: View {
    let model: AppModel
    @ObservedObject var settings: AppSettings
    @State private var draftPort = AppSettings.defaultPort

    var body: some View {
        Form {
            TextField("Port", value: $draftPort, format: .number.grouping(.never))
                .onSubmit {
                    if (1...65535).contains(draftPort) {
                        model.changePort(draftPort)
                    } else {
                        draftPort = settings.port
                    }
                }
            Toggle("Launch at login", isOn: Binding(
                get: { settings.launchAtLogin },
                set: { settings.setLaunchAtLogin($0) }
            ))
        }
        .padding()
        .frame(width: 320)
        .onAppear { draftPort = settings.port }
    }
}
