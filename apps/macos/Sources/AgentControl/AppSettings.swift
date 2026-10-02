import Foundation
import ServiceManagement

@MainActor
final class AppSettings: ObservableObject {
    static let defaultPort = 3660
    private static let portKey = "port"

    @Published var port: Int {
        didSet { defaults.set(port, forKey: Self.portKey) }
    }
    @Published private(set) var launchAtLogin: Bool

    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        let stored = defaults.integer(forKey: Self.portKey)
        port = (1...65535).contains(stored) ? stored : Self.defaultPort
        launchAtLogin = SMAppService.mainApp.status == .enabled
    }

    // the toggle always reflects what macOS actually registered, so a failed
    // register/unregister shows as the toggle snapping back
    func setLaunchAtLogin(_ enabled: Bool) {
        try? enabled ? SMAppService.mainApp.register() : SMAppService.mainApp.unregister()
        launchAtLogin = SMAppService.mainApp.status == .enabled
    }
}
