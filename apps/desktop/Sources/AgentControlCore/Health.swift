import Foundation

public struct Health: Decodable, Equatable, Sendable {
    public enum ExtensionState: String, Decodable, Sendable {
        case connected
        case disconnected
    }

    public struct Tab: Decodable, Equatable, Sendable {
        public let id: Int
        public let url: String
        public let title: String
    }

    public let extensionState: ExtensionState
    public let tab: Tab?
    public let uptime: Double

    private enum CodingKeys: String, CodingKey {
        case extensionState = "extension"
        case tab
        case uptime
    }
}
