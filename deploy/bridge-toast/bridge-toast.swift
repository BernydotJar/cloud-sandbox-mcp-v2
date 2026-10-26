import AppKit
import Foundation
import QuartzCore

// Akira: a native on-screen macOS splash, never a browser page.
// The Bridge is already connected before this process is launched.
// Connection: five seconds. Delegation notice: 20 seconds with an X to dismiss.
// Neither mode activates another app or blocks the agent.
private enum AkiraSplash {
    static let connectionLifetime: TimeInterval = 5.0
    static let delegatedLifetime: TimeInterval = 20.0
    static let fadeIn: TimeInterval = 0.28
    static let fadeOut: TimeInterval = 0.32
    static let width: CGFloat = 420
    static let connectionHeight: CGFloat = 122
    static let delegatedHeight: CGFloat = 155
    static let alertHeight: CGFloat = 176
    static let alertLifetime: TimeInterval = 20.0
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

// Original colorful laboratory burst around Akira. No external images, fonts,
// remote assets, or new browser debugging requirements. Particles are decorative
// CoreAnimation layers; they never intercept clicks or control any session.
private final class LabBurstView: NSView {
    override init(frame: NSRect) {
        super.init(frame: frame)
        prepareParticles()
    }
    required init?(coder: NSCoder) {
        super.init(coder: coder)
        prepareParticles()
    }
    private func prepareParticles() {
        wantsLayer = true
        guard let host = layer else { return }
        let colors: [NSColor] = [.systemCyan, .systemPink, .systemOrange,
                                 .systemGreen, .systemPurple, .systemYellow]
        let center = CGPoint(x: 48, y: bounds.midY)
        let reduced = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        for i in 0..<30 {
            let angle = CGFloat(i) * (.pi * 2 / 30)
            let radius = CGFloat(28 + (i % 5) * 13)
            let destination = CGPoint(x: center.x + cos(angle) * radius,
                                      y: center.y + sin(angle) * radius)
            let dot = CAShapeLayer()
            let diameter: CGFloat = i.isMultiple(of: 4) ? 5 : 2.8
            dot.path = CGPath(ellipseIn: CGRect(x: 0, y: 0,
                                               width: diameter, height: diameter),
                              transform: nil)
            dot.fillColor = colors[i % colors.count].cgColor
            dot.position = reduced ? destination : center
            dot.opacity = reduced ? 0.45 : 0
            host.addSublayer(dot)
            if !reduced {
                let motion = CABasicAnimation(keyPath: "position")
                motion.fromValue = NSValue(point: center)
                motion.toValue = NSValue(point: destination)
                motion.duration = 1.35 + Double(i % 5) * 0.14
                motion.beginTime = CACurrentMediaTime() + Double(i % 6) * 0.08
                motion.repeatCount = .infinity
                dot.add(motion, forKey: "laboratoryBurst")
                let pulse = CAKeyframeAnimation(keyPath: "opacity")
                pulse.values = [0, 0.93, 0.68, 0]
                pulse.keyTimes = [0, 0.18, 0.65, 1]
                pulse.duration = motion.duration
                pulse.beginTime = motion.beginTime
                pulse.repeatCount = .infinity
                dot.add(pulse, forKey: "laboratoryPulse")
            }
        }
    }
}

// This popup conveys information; only the local operator's trusted-mode setting
// can grant authority. The notice itself never has authority to approve actions.
let arguments = Array(CommandLine.arguments.dropFirst())
let delegated = arguments.first == "--session-notice"
// Explicit status presentation: the caller supplies a fixed code, never page
// content or an arbitrary shell command. An alert panel does not grant authority.
let alertCatalog: [String: (String, String)] = [
    "storage": ("Almacenamiento crítico", "Revisa capacidad y respaldos; no se eliminó nada."),
    "edge": ("Edge: control nativo", "CDP no disponible. Sin activar depuración remota."),
    "terminal": ("Terminal Mac pendiente", "El host de macOS y Linux son motores distintos."),
    "recovery": ("Acción sin confirmar", "Revisar el resultado antes de volver a ejecutar.")
]
let alertInfo = arguments.first == "--status-alert" && arguments.count >= 2
    ? alertCatalog[arguments[1]] : nil
let alerted = alertInfo != nil
let browserName = delegated && arguments.count >= 2 &&
    ["chrome", "edge"].contains(arguments[1]) ? arguments[1].capitalized : "Navegador"
let requestedMinutes = delegated && arguments.count >= 3 ? Int(arguments[2]) ?? 0 : 0
let actionsLabel = delegated && arguments.count >= 4 && arguments[3] == "unlimited"
    ? "acciones sin límite"
    : "máx. \(delegated && arguments.count >= 4 ? Int(arguments[3]) ?? 0 : 0) acciones"
let noticeLifetime = alerted ? AkiraSplash.alertLifetime : (delegated ? AkiraSplash.delegatedLifetime : AkiraSplash.connectionLifetime)
let noticeHeight = alerted ? AkiraSplash.alertHeight : (delegated ? AkiraSplash.delegatedHeight : AkiraSplash.connectionHeight)

let application = NSApplication.shared
application.setActivationPolicy(.accessory)

let screen = NSScreen.main ?? NSScreen.screens.first
let area = screen?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
let bounds = NSRect(x: area.maxX - AkiraSplash.width - AkiraSplash.margin,
                    y: area.maxY - noticeHeight - AkiraSplash.margin,
                    width: AkiraSplash.width, height: noticeHeight)

let panel = NSPanel(contentRect: bounds,
                    styleMask: [.borderless, .nonactivatingPanel],
                    backing: .buffered, defer: false)
panel.level = .floating
panel.backgroundColor = .clear
panel.isOpaque = false
panel.hasShadow = true
// The 5-second confirmation is click-through. Delegated and explicit alert
// panels accept clicks for dismissing or opening read-only local diagnostics.
panel.ignoresMouseEvents = !(delegated || alerted)
panel.hidesOnDeactivate = false
panel.animationBehavior = .none
panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
panel.isReleasedWhenClosed = false

let glass = NSVisualEffectView(frame: NSRect(x: 0, y: 0,
                                             width: AkiraSplash.width,
                                             height: noticeHeight))
glass.material = .hudWindow
glass.blendingMode = .behindWindow
glass.state = .active
glass.wantsLayer = true
glass.layer?.cornerRadius = 23
glass.layer?.masksToBounds = true
glass.layer?.borderWidth = 1.0
glass.layer?.borderColor = NSColor.systemPurple.withAlphaComponent(0.31).cgColor
panel.contentView = glass

let accent = NSView(frame: NSRect(x: 0, y: 14, width: 3, height: noticeHeight - 28))
accent.wantsLayer = true
accent.layer?.backgroundColor = NSColor.systemPink.withAlphaComponent(0.84).cgColor
accent.layer?.cornerRadius = 1.5
glass.addSubview(accent)

let burst = LabBurstView(frame: NSRect(x: 0, y: 0, width: 116,
                                         height: noticeHeight))
glass.addSubview(burst)

private let mascot = AkiraMascot(frame: NSRect(x: 13, y: noticeHeight - 86,
                                                width: 68, height: 64))
glass.addSubview(mascot)

let heading = NSTextField(labelWithString: "Edu!")
heading.frame = NSRect(x: 92, y: noticeHeight - 38, width: 278, height: 26)
heading.font = NSFont.systemFont(ofSize: 18, weight: .bold)
heading.textColor = .labelColor
heading.isSelectable = false
glass.addSubview(heading)

let status = NSTextField(labelWithString: alertInfo?.0 ?? (delegated ? "Bridge listo · Sesión activa" : "Bridge listo ✨"))
status.frame = NSRect(x: 92, y: noticeHeight - 62, width: 304, height: 22)
status.font = NSFont.systemFont(ofSize: 14, weight: .semibold)
status.textColor = .systemCyan
status.isSelectable = false
glass.addSubview(status)

// Original motivational phrasing inspired by reframing in
// "Introducción a la PNL" (Joseph O'Connor and John Seymour).
// This is a paraphrase, NOT a misattributed direct quotation.
let phrase = NSTextField(labelWithString: alertInfo?.1 ?? "Tu enfoque abre posibilidades. Hoy eliges avanzar.")
phrase.frame = NSRect(x: 92, y: noticeHeight - 85, width: 310, height: 19)
phrase.font = NSFont.systemFont(ofSize: 11, weight: .medium)
phrase.textColor = .secondaryLabelColor
phrase.lineBreakMode = .byTruncatingTail
phrase.isSelectable = false
glass.addSubview(phrase)

let attribution = NSTextField(labelWithString: alerted ? "Panel de estado local · sin cambios de navegador" : "Inspirado en Introducción a la PNL")
attribution.frame = NSRect(x: 92, y: noticeHeight - 103, width: 307, height: 16)
attribution.font = NSFont.systemFont(ofSize: 9.5, weight: .regular)
attribution.textColor = .tertiaryLabelColor
attribution.isSelectable = false
glass.addSubview(attribution)

if delegated {
    let details = NSTextField(
        labelWithString: "\(browserName) · \(requestedMinutes) min · \(actionsLabel)"
    )
    details.frame = NSRect(x: 92, y: 20, width: 290, height: 16)
    details.font = NSFont.systemFont(ofSize: 10, weight: .medium)
    details.textColor = .secondaryLabelColor
    details.isSelectable = false
    glass.addSubview(details)
}

// A close button dismisses *only the notice*. It never revokes a delegated
// session; the already-existing session_end / local STOP command does that.
private final class NoticeDismissal: NSObject {
    weak var panel: NSPanel?
    @objc func closeNotice(_ sender: Any?) {
        panel?.orderOut(nil)
        NSApplication.shared.terminate(nil)
    }
}
private let dismissal = NoticeDismissal()
dismissal.panel = panel
if delegated || alerted {
    let close = NSButton(title: "×", target: dismissal,
                         action: #selector(NoticeDismissal.closeNotice(_:)))
    close.frame = NSRect(x: AkiraSplash.width - 42, y: noticeHeight - 43,
                         width: 25, height: 25)
    close.isBordered = false
    close.font = NSFont.systemFont(ofSize: 21, weight: .medium)
    close.contentTintColor = .secondaryLabelColor
    close.toolTip = "Cerrar aviso (no modifica ninguna sesión)"
    close.setAccessibilityLabel("Cerrar aviso")
    glass.addSubview(close)
}

// Read-only interactive control: explicitly requested by the Mac operator.
// Opening the audit directory is a user click, not a background side effect.
// Never expose an inert Stop button or claim that closing revokes a session.
private final class LocalDiagnostics: NSObject {
    @objc func showLogs(_ sender: Any?) {
        let folder = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".cloud-sandbox-mcp-data/audit", isDirectory: true)
        NSWorkspace.shared.open(folder)
    }
}
private let localDiagnostics = LocalDiagnostics()
if alerted {
    let logs = NSButton(title: "Ver registros", target: localDiagnostics,
                        action: #selector(LocalDiagnostics.showLogs(_:)))
    logs.frame = NSRect(x: 92, y: 16, width: 125, height: 28)
    logs.setAccessibilityLabel("Abrir registros locales de Sandbox")
    logs.toolTip = "Abrir el directorio de auditoría de Sandbox en Finder"
    glass.addSubview(logs)
}

let reducedMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
panel.alphaValue = reducedMotion ? 1 : 0
panel.orderFrontRegardless()

if !reducedMotion {
    NSAnimationContext.runAnimationGroup { context in
        context.duration = AkiraSplash.fadeIn
        panel.animator().alphaValue = 1
    }
}

DispatchQueue.main.asyncAfter(deadline: .now() + noticeLifetime) {
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
