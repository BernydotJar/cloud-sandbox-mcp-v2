import AppKit
import Foundation
import QuartzCore

// Akira: a tiny, unobtrusive, purely informational macOS splash.
// The Bridge is already connected before this process is launched.
// It is click-through, never activates a window, and closes after five seconds.
private enum AkiraSplash {
    static let lifetime: TimeInterval = 5.0
    static let fadeIn: TimeInterval = 0.28
    static let fadeOut: TimeInterval = 0.32
    static let width: CGFloat = 326
    static let height: CGFloat = 94
    static let margin: CGFloat = 18
}

/// Hand-drawn, original mini mascot: no network assets, fonts, or bundled images.
private final class AkiraMascot: NSView {
    override var isOpaque: Bool { false }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        let lilac = NSColor(calibratedRed: 0.71, green: 0.60, blue: 0.99, alpha: 1)
        let blush = NSColor(calibratedRed: 1.00, green: 0.61, blue: 0.74, alpha: 1)
        let ink = NSColor(calibratedRed: 0.26, green: 0.19, blue: 0.39, alpha: 1)

        // Little ears peek out above Akira's head.
        let leftEar = NSBezierPath()
        leftEar.move(to: NSPoint(x: 14, y: 41))
        leftEar.line(to: NSPoint(x: 15, y: 56))
        leftEar.line(to: NSPoint(x: 27, y: 48))
        leftEar.close()
        lilac.setFill()
        leftEar.fill()

        let rightEar = NSBezierPath()
        rightEar.move(to: NSPoint(x: 40, y: 48))
        rightEar.line(to: NSPoint(x: 53, y: 56))
        rightEar.line(to: NSPoint(x: 54, y: 40))
        rightEar.close()
        lilac.setFill()
        rightEar.fill()

        let face = NSBezierPath(roundedRect: NSRect(x: 9, y: 6, width: 49, height: 45),
                                xRadius: 20, yRadius: 20)
        lilac.setFill()
        face.fill()

        // Soft reflection gives the mascot the small glass-toy appearance.
        NSColor.white.withAlphaComponent(0.33).setFill()
        NSBezierPath(ovalIn: NSRect(x: 16, y: 33, width: 22, height: 12)).fill()

        ink.setFill()
        NSBezierPath(ovalIn: NSRect(x: 25, y: 24, width: 3.8, height: 5.5)).fill()
        NSBezierPath(ovalIn: NSRect(x: 40, y: 24, width: 3.8, height: 5.5)).fill()

        blush.setFill()
        NSBezierPath(ovalIn: NSRect(x: 16, y: 20, width: 9, height: 4.2)).fill()
        NSBezierPath(ovalIn: NSRect(x: 44, y: 20, width: 9, height: 4.2)).fill()

        let smile = NSBezierPath()
        smile.move(to: NSPoint(x: 31, y: 23))
        smile.curve(to: NSPoint(x: 37, y: 23),
                    controlPoint1: NSPoint(x: 32, y: 18),
                    controlPoint2: NSPoint(x: 36, y: 18))
        smile.lineWidth = 1.8
        smile.lineCapStyle = .round
        ink.setStroke()
        smile.stroke()

        // One deliberately tiny sparkle.
        let sparkle = NSBezierPath()
        sparkle.move(to: NSPoint(x: 60, y: 43))
        sparkle.line(to: NSPoint(x: 65, y: 43))
        sparkle.move(to: NSPoint(x: 62.5, y: 40.5))
        sparkle.line(to: NSPoint(x: 62.5, y: 45.5))
        sparkle.lineWidth = 1.5
        blush.setStroke()
        sparkle.stroke()
    }
}

let application = NSApplication.shared
application.setActivationPolicy(.accessory)

let screen = NSScreen.main ?? NSScreen.screens.first
let area = screen?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
let bounds = NSRect(x: area.maxX - AkiraSplash.width - AkiraSplash.margin,
                    y: area.maxY - AkiraSplash.height - AkiraSplash.margin,
                    width: AkiraSplash.width, height: AkiraSplash.height)

let panel = NSPanel(contentRect: bounds,
                    styleMask: [.borderless, .nonactivatingPanel],
                    backing: .buffered, defer: false)
panel.level = .floating
panel.backgroundColor = .clear
panel.isOpaque = false
panel.hasShadow = true
panel.ignoresMouseEvents = true
panel.hidesOnDeactivate = false
panel.animationBehavior = .none
panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
panel.isReleasedWhenClosed = false

let glass = NSVisualEffectView(frame: NSRect(x: 0, y: 0,
                                             width: AkiraSplash.width,
                                             height: AkiraSplash.height))
glass.material = .hudWindow
glass.blendingMode = .behindWindow
glass.state = .active
glass.wantsLayer = true
glass.layer?.cornerRadius = 23
glass.layer?.masksToBounds = true
glass.layer?.borderWidth = 1.0
glass.layer?.borderColor = NSColor.systemPurple.withAlphaComponent(0.31).cgColor
panel.contentView = glass

let accent = NSView(frame: NSRect(x: 0, y: 15, width: 3, height: 63))
accent.wantsLayer = true
accent.layer?.backgroundColor = NSColor.systemPink.withAlphaComponent(0.84).cgColor
accent.layer?.cornerRadius = 1.5
glass.addSubview(accent)

let mascot = AkiraMascot(frame: NSRect(x: 13, y: 13, width: 68, height: 64))
glass.addSubview(mascot)

let heading = NSTextField(labelWithString: "Bridge listo ✨")
heading.frame = NSRect(x: 91, y: 45, width: 220, height: 27)
heading.font = NSFont.systemFont(ofSize: 17, weight: .semibold)
heading.textColor = .labelColor
heading.lineBreakMode = .byTruncatingTail
heading.isSelectable = false
glass.addSubview(heading)

let detail = NSTextField(labelWithString: "Chrome conectado · Playwright")
detail.frame = NSRect(x: 91, y: 23, width: 223, height: 20)
detail.font = NSFont.systemFont(ofSize: 11.5, weight: .medium)
detail.textColor = .secondaryLabelColor
detail.isSelectable = false
glass.addSubview(detail)

let reducedMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
panel.alphaValue = reducedMotion ? 1 : 0
panel.orderFrontRegardless()

if !reducedMotion {
    NSAnimationContext.runAnimationGroup { context in
        context.duration = AkiraSplash.fadeIn
        panel.animator().alphaValue = 1
    }
}

DispatchQueue.main.asyncAfter(deadline: .now() + AkiraSplash.lifetime) {
    if reducedMotion {
        panel.orderOut(nil)
        application.terminate(nil)
    } else {
        NSAnimationContext.runAnimationGroup({ context in
            context.duration = AkiraSplash.fadeOut
            panel.animator().alphaValue = 0
        }, completionHandler: {
            panel.orderOut(nil)
            application.terminate(nil)
        })
    }
}

application.run()
