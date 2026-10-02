import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

@MainActor
public final class HealthClient {
    public private(set) var health: Health? {
        didSet { if health != oldValue { onChange?(health) } }
    }
    public var onChange: ((Health?) -> Void)?
    private var polling: Task<Void, Never>?

    public init() {}

    public func start(port: Int) {
        stop()
        let url = URL(string: "http://127.0.0.1:\(port)/health")!
        polling = Task { [weak self] in
            while !Task.isCancelled {
                let health = await Self.fetch(url)
                guard !Task.isCancelled else { return }
                self?.health = health
                try? await Task.sleep(for: .seconds(2))
            }
        }
    }

    public func stop() {
        polling?.cancel()
        polling = nil
        health = nil
    }

    private static func fetch(_ url: URL) async -> Health? {
        guard let (data, response) = try? await URLSession.shared.data(from: url),
              (response as? HTTPURLResponse)?.statusCode == 200
        else { return nil }
        return try? JSONDecoder().decode(Health.self, from: data)
    }
}
