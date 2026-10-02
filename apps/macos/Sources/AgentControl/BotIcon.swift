import AppKit

// lucide's `bot` icon (ISC licence), the one the extension popup uses; drawn
// rather than bundled so the app carries no image resources
enum BotIcon {
    static let image: NSImage = {
        let image = NSImage(size: NSSize(width: 18, height: 18), flipped: true) { rect in
            let scale = rect.width / 24
            let path = NSBezierPath()
            path.move(to: NSPoint(x: 12, y: 8))
            path.line(to: NSPoint(x: 12, y: 4))
            path.line(to: NSPoint(x: 8, y: 4))
            path.append(NSBezierPath(
                roundedRect: NSRect(x: 4, y: 8, width: 16, height: 12),
                xRadius: 2,
                yRadius: 2
            ))
            let strokes: [(NSPoint, NSPoint)] = [
                (NSPoint(x: 2, y: 14), NSPoint(x: 4, y: 14)),
                (NSPoint(x: 20, y: 14), NSPoint(x: 22, y: 14)),
                (NSPoint(x: 15, y: 13), NSPoint(x: 15, y: 15)),
                (NSPoint(x: 9, y: 13), NSPoint(x: 9, y: 15)),
            ]
            for (from, to) in strokes {
                path.move(to: from)
                path.line(to: to)
            }
            path.transform(using: AffineTransform(scale: scale))
            path.lineWidth = 2 * scale
            path.lineCapStyle = .round
            path.lineJoinStyle = .round
            NSColor.black.setStroke()
            path.stroke()
            return true
        }
        image.isTemplate = true
        return image
    }()
}
