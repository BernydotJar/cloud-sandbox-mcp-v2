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
    static let alertHeight: CGFloat = 164
    static let alertLifetime: TimeInterval = 20.0
    static let margin: CGFloat = 16
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

// A restrained, Akira-centered burst: never paints the glass panel border.
// Particles stay inside the left 96pt illustration region and settle after
// two cycles. Reduce Motion users see static, faint particles instead.
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
        let colors: [NSColor] = [
            NSColor(calibratedRed: 0.48, green: 0.74, blue: 0.89, alpha: 1),
            NSColor(calibratedRed: 0.72, green: 0.63, blue: 0.91, alpha: 1),
            NSColor(calibratedRed: 0.90, green: 0.74, blue: 0.84, alpha: 1)
        ]
        let center = CGPoint(x: 45, y: bounds.midY)
        let reduced = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        for i in 0..<15 {
            let angle = CGFloat(i) * (.pi * 2 / 15)
            let radius = CGFloat(20 + (i % 4) * 8)
            let destination = CGPoint(x: center.x + cos(angle) * radius,
                                      y: center.y + sin(angle) * radius)
            let dot = CAShapeLayer()
            let diameter: CGFloat = i.isMultiple(of: 5) ? 3.5 : 2.2
            dot.path = CGPath(ellipseIn: CGRect(x: 0, y: 0,
                                               width: diameter, height: diameter),
                              transform: nil)
            dot.fillColor = colors[i % colors.count].cgColor
            dot.position = destination
            dot.opacity = 0.18
            host.addSublayer(dot)
            if !reduced {
                let motion = CABasicAnimation(keyPath: "position")
                motion.fromValue = NSValue(point: center)
                motion.toValue = NSValue(point: destination)
                motion.duration = 1.3 + Double(i % 3) * 0.17
                motion.beginTime = CACurrentMediaTime() + Double(i % 4) * 0.055
                motion.repeatCount = 2
                dot.add(motion, forKey: "laboratoryBurst")
                let pulse = CAKeyframeAnimation(keyPath: "opacity")
                pulse.values = [0.0, 0.57, 0.4, 0.18]
                pulse.keyTimes = [0.0, 0.24, 0.72, 1.0]
                pulse.duration = motion.duration
                pulse.beginTime = motion.beginTime
                pulse.repeatCount = 2
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
    "storage": ("Almacenamiento crítico", "Revisar capacidad y respaldos. No se eliminó nada."),
    "storage-warning": ("Espacio de trabajo bajo", "Revisar archivos regenerables cuando convenga."),
    "edge": ("Edge · Control nativo", "Pestañas disponibles sin depuración remota."),
    "terminal": ("Terminal macOS", "Motor nativo pendiente de validación."),
    "recovery": ("Acción pendiente", "Verifica el resultado antes de reintentar.")
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

// Prefer Apple's real Liquid Glass on macOS 26 with Xcode 26 / Swift 6.2.
// Older SDKs compile the legacy branch without referencing an unavailable
// class. Never use private CAFilter properties or hidden browser debugging.
let glass = NSView(frame: NSRect(x: 0, y: 0,
                                 width: AkiraSplash.width,
                                 height: noticeHeight))
glass.wantsLayer = true

#if compiler(>=6.2)
if #available(macOS 26.0, *) {
    let liquid = NSGlassEffectView(frame: glass.bounds)
    liquid.cornerRadius = 24
    liquid.style = .clear
    liquid.tintColor = nil
    liquid.contentView = glass
    panel.contentView = liquid
    print("[Akira View] MATERIAL=NATIVE_LIQUID_GLASS")
} else {
    let fallback = NSVisualEffectView(frame: glass.bounds)
    fallback.material = .popover
    fallback.blendingMode = .behindWindow
    fallback.state = .active
    fallback.wantsLayer = true
    fallback.layer?.cornerRadius = 24
    fallback.layer?.masksToBounds = true
    fallback.layer?.borderWidth = 0.65
    fallback.layer?.borderColor = NSColor.white.withAlphaComponent(0.30).cgColor
    let reflection = CAGradientLayer()
    reflection.frame = fallback.bounds
    reflection.colors = [
        NSColor.white.withAlphaComponent(0.17).cgColor,
        NSColor.white.withAlphaComponent(0.05).cgColor,
        NSColor.clear.cgColor
    ]
    reflection.locations = [0, 0.32, 1]
    reflection.startPoint = CGPoint(x: 0.5, y: 1.0)
    reflection.endPoint = CGPoint(x: 0.5, y: 0.0)
    reflection.cornerRadius = 24
    fallback.layer?.insertSublayer(reflection, at: 0)
    fallback.addSubview(glass)
    panel.contentView = fallback
    print("[Akira View] MATERIAL=LEGACY_VIBRANCY")
}
#else
let fallback = NSVisualEffectView(frame: glass.bounds)
fallback.material = .popover
fallback.blendingMode = .behindWindow
fallback.state = .active
fallback.wantsLayer = true
fallback.layer?.cornerRadius = 24
fallback.layer?.masksToBounds = true
fallback.layer?.borderWidth = 0.65
fallback.layer?.borderColor = NSColor.white.withAlphaComponent(0.30).cgColor
fallback.addSubview(glass)
panel.contentView = fallback
print("[Akira View] MATERIAL=LEGACY_SDK")
#endif

// Confetti remains around Akira, not around the panel or the content.
private let burst = LabBurstView(frame: NSRect(x: 0, y: 0, width: 96,
                                               height: noticeHeight))
glass.addSubview(burst)

private let mascot = AkiraMascot(frame: NSRect(x: 17, y: noticeHeight - 98,
                                               width: 68, height: 64))
glass.addSubview(mascot)

// Clean, neutral content hierarchy. Only a tiny signal dot carries
// the state color; titles and controls use adaptive label colors.
let contentX: CGFloat = 102
let brand = NSTextField(labelWithString: "Edu!  ·  SANDBOX V3")
brand.frame = NSRect(x: contentX, y: noticeHeight - 31, width: 246, height: 15)
brand.font = NSFont.systemFont(ofSize: 10.5, weight: .semibold)
brand.textColor = .secondaryLabelColor
brand.isSelectable = false
glass.addSubview(brand)

let indicator = NSView(frame: NSRect(x: contentX, y: noticeHeight - 53,
                                     width: 6, height: 6))
indicator.wantsLayer = true
indicator.layer?.cornerRadius = 3
let alertCode = arguments.first == "--status-alert" && arguments.count >= 2
    ? arguments[1] : ""
let signalColor: NSColor
switch alertCode {
case "storage", "storage-warning", "recovery":
    signalColor = .systemOrange
case "terminal":
    signalColor = .systemBlue
case "edge":
    signalColor = .systemTeal
default:
    signalColor = .systemGreen
}
indicator.layer?.backgroundColor = signalColor.withAlphaComponent(0.70).cgColor
glass.addSubview(indicator)

let status = NSTextField(labelWithString:
    alertInfo?.0 ?? (delegated ? "Sesión delegada activa" : "Bridge listo"))
status.frame = NSRect(x: contentX + 13, y: noticeHeight - 61,
                      width: AkiraSplash.width - contentX - 45, height: 25)
status.font = NSFont.systemFont(ofSize: 16, weight: .semibold)
status.textColor = .labelColor
status.lineBreakMode = .byTruncatingTail
status.isSelectable = false
glass.addSubview(status)

let phrase = NSTextField(wrappingLabelWithString:
    alertInfo?.1 ?? (delegated ? "Sesión segura y limitada al navegador autorizado."
                                : "Conexión establecida · Automatización lista."))
phrase.frame = NSRect(x: contentX, y: noticeHeight - 98,
                      width: AkiraSplash.width - contentX - 24, height: 33)
phrase.font = NSFont.systemFont(ofSize: 11.5, weight: .regular)
phrase.textColor = .secondaryLabelColor
phrase.maximumNumberOfLines = 2
phrase.lineBreakMode = .byWordWrapping
phrase.isSelectable = false
glass.addSubview(phrase)

let attribution = NSTextField(labelWithString: alerted
    ? "ESTADO LOCAL  ·  SIN CAMBIOS DE NAVEGADOR"
    : (delegated ? "CONTROL DEL OPERADOR" : "COMPUTER USE  ·  macOS"))
attribution.frame = NSRect(x: contentX, y: noticeHeight - 113,
                           width: 298, height: 14)
attribution.font = NSFont.systemFont(ofSize: 8.5, weight: .medium)
attribution.textColor = .tertiaryLabelColor
attribution.lineBreakMode = .byTruncatingTail
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
    close.frame = NSRect(x: AkiraSplash.width - 39, y: noticeHeight - 37,
                         width: 22, height: 22)
    close.isBordered = false
    close.wantsLayer = true
    close.layer?.cornerRadius = 11
    close.layer?.backgroundColor = NSColor.white.withAlphaComponent(0.11).cgColor
    close.layer?.borderWidth = 0.5
    close.layer?.borderColor = NSColor.white.withAlphaComponent(0.24).cgColor
    close.font = NSFont.systemFont(ofSize: 15, weight: .medium)
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
    // A real glass secondary action: a popover material surface under
    // a transparent native button, with a quiet stroke and no inert actions.
    let buttonFrame = NSRect(x: contentX, y: 14, width: 126, height: 29)
    let buttonGlass = NSVisualEffectView(frame: buttonFrame)
    buttonGlass.material = .menu
    buttonGlass.blendingMode = .withinWindow
    buttonGlass.state = .active
    buttonGlass.wantsLayer = true
    buttonGlass.layer?.cornerRadius = 10
    buttonGlass.layer?.masksToBounds = true
    buttonGlass.layer?.borderWidth = 0.65
    buttonGlass.layer?.borderColor = NSColor.white.withAlphaComponent(0.36).cgColor
    glass.addSubview(buttonGlass)

    let logs = NSButton(title: "Ver registros", target: localDiagnostics,
                        action: #selector(LocalDiagnostics.showLogs(_:)))
    logs.frame = buttonFrame
    logs.isBordered = false
    logs.font = NSFont.systemFont(ofSize: 11.5, weight: .semibold)
    logs.contentTintColor = .labelColor
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
