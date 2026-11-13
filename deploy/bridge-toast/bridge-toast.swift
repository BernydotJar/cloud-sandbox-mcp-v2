import AppKit
import Foundation
import QuartzCore

private enum PortalSplash {
    static let connectionLifetime: TimeInterval = 5.0
    static let delegatedLifetime: TimeInterval = 20.0
    static let alertLifetime: TimeInterval = 20.0
    static let width: CGFloat = 500
    static let connectionHeight: CGFloat = 174
    static let delegatedHeight: CGFloat = 198
    static let alertHeight: CGFloat = 216
    static let margin: CGFloat = 18
}

// Procedural green portal: irregular luminous rim, counter-rotating eddies,
// drifting sparks and a deep center. No cartoon mascot or downloaded assets.
private final class PortalView: NSView {
    override var isOpaque: Bool { false }
    override init(frame: NSRect) { super.init(frame: frame); buildPortal() }
    required init?(coder: NSCoder) { super.init(coder: coder); buildPortal() }

    private func buildPortal() {
        wantsLayer = true
        guard let host = layer else { return }
        let reduced = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        let center = CGPoint(x: bounds.midX, y: bounds.midY)
        let radius: CGFloat = min(bounds.width, bounds.height) * 0.34
        let green = NSColor(calibratedRed: 0.48, green: 1, blue: 0.10, alpha: 1)
        let lime = NSColor(calibratedRed: 0.78, green: 1, blue: 0.20, alpha: 1)
        let emerald = NSColor(calibratedRed: 0.05, green: 0.45, blue: 0.14, alpha: 1)
        func contour(_ r: CGFloat, phase: CGFloat) -> CGPath {
            let p = CGMutablePath()
            for i in 0...192 {
                let a = CGFloat(i) / 192 * .pi * 2
                let wave = 1 + 0.055 * sin(a * 7 + phase) + 0.032 * sin(a * 13 - phase)
                let point = CGPoint(x: center.x + cos(a) * r * wave,
                                    y: center.y + sin(a) * r * wave * 1.10)
                if i == 0 { p.move(to: point) } else { p.addLine(to: point) }
            }
            p.closeSubpath()
            return p
        }
        let halo = CAShapeLayer()
        halo.path = contour(radius * 1.02, phase: 0)
        halo.fillColor = emerald.cgColor
        halo.shadowColor = green.cgColor
        halo.shadowOpacity = 0.8
        halo.shadowRadius = 19
        halo.shadowOffset = .zero
        host.addSublayer(halo)

        let aperture = CAGradientLayer()
        aperture.frame = bounds
        aperture.type = .radial
        aperture.startPoint = CGPoint(x: 0.42, y: 0.58)
        aperture.endPoint = CGPoint(x: 0.93, y: 1)
        aperture.colors = [
            NSColor(calibratedRed: 0.02, green: 0.16, blue: 0.08, alpha: 1).cgColor,
            emerald.cgColor, green.cgColor, lime.cgColor
        ]
        aperture.locations = [0, 0.28, 0.72, 1]
        let mask = CAShapeLayer()
        mask.path = contour(radius, phase: 0)
        aperture.mask = mask
        host.addSublayer(aperture)

        let vortex = CALayer()
        vortex.frame = bounds
        host.addSublayer(vortex)
        let vortexMask = CAShapeLayer()
        vortexMask.path = contour(radius * 0.97, phase: 0)
        vortex.mask = vortexMask
        for i in 0..<22 {
            let path = CGMutablePath()
            let seed = CGFloat(i) * 2.399963
            for j in 0...90 {
                let t = CGFloat(j) / 90
                let a = seed + t * .pi * 1.65
                let r = radius * (0.06 + 0.9 * t)
                let point = CGPoint(x: center.x + cos(a) * r,
                                    y: center.y + sin(a) * r * 1.10)
                if j == 0 { path.move(to: point) } else { path.addLine(to: point) }
            }
            let filament = CAShapeLayer()
            filament.path = path
            filament.fillColor = nil
            filament.strokeColor = (i.isMultiple(of: 3) ? lime : emerald).withAlphaComponent(i.isMultiple(of: 3) ? 0.75 : 0.8).cgColor
            filament.lineWidth = i.isMultiple(of: 3) ? 1.6 : 3.4
            filament.lineCap = .round
            vortex.addSublayer(filament)
        }
        let rim = CAShapeLayer()
        rim.path = contour(radius, phase: 0)
        rim.fillColor = nil
        rim.strokeColor = lime.cgColor
        rim.lineWidth = 3
        rim.shadowColor = green.cgColor
        rim.shadowRadius = 8
        rim.shadowOpacity = 1
        rim.shadowOffset = .zero
        host.addSublayer(rim)
        if !reduced {
            let rotation = CABasicAnimation(keyPath: "transform.rotation.z")
            rotation.fromValue = 0
            rotation.toValue = Double.pi * 2
            rotation.duration = 14
            rotation.repeatCount = .infinity
            vortex.add(rotation, forKey: "portalVortex")
            let ripple = CAKeyframeAnimation(keyPath: "path")
            ripple.values = [contour(radius, phase: 0), contour(radius, phase: 2.1),
                             contour(radius, phase: 4.2), contour(radius, phase: 0)]
            ripple.duration = 3.8
            ripple.repeatCount = .infinity
            ripple.calculationMode = .linear
            rim.add(ripple, forKey: "organicRim")
            mask.add(ripple, forKey: "organicAperture")
            let breathe = CABasicAnimation(keyPath: "shadowOpacity")
            breathe.fromValue = 0.45
            breathe.toValue = 0.9
            breathe.duration = 2
            breathe.autoreverses = true
            breathe.repeatCount = .infinity
            halo.add(breathe, forKey: "portalGlow")
        }
        for i in 0..<11 {
            let a = CGFloat(i) * 2.399963
            let r = radius * (1.16 + CGFloat(i % 3) * 0.1)
            let spark = CAShapeLayer()
            let size: CGFloat = i.isMultiple(of: 3) ? 2.6 : 1.5
            spark.path = CGPath(ellipseIn: CGRect(x: -size/2, y: -size/2, width: size, height: size), transform: nil)
            spark.fillColor = lime.cgColor
            spark.position = CGPoint(x: center.x + cos(a)*r, y: center.y + sin(a)*r*1.08)
            spark.opacity = 0.35
            host.addSublayer(spark)
            if !reduced {
                let shimmer = CAKeyframeAnimation(keyPath: "opacity")
                shimmer.values = [0.05, 0.75, 0.05]
                shimmer.duration = 2.2 + Double(i % 4)*0.35
                shimmer.timeOffset = Double(i)*0.19
                shimmer.repeatCount = .infinity
                spark.add(shimmer, forKey: "portalSpark")
            }
        }
        setAccessibilityElement(true)
        setAccessibilityLabel("Portal verde animado")
    }
}

// Original synthesized portal whoosh, created entirely in memory. No microphone,
// recording, downloaded clip or borrowed soundtrack. System mute remains effective.
private func portalWhoosh() -> Data {
    let sampleRate = 22050
    let count = Int(Double(sampleRate) * 0.64)
    var pcm = Data(capacity: count * 2)
    var phase = 0.0
    var seed: UInt32 = 0x51A5D00D
    var air = 0.0
    func append16(_ value: Int16, to data: inout Data) {
        var little = value.littleEndian
        withUnsafeBytes(of: &little) { data.append(contentsOf: $0) }
    }
    for i in 0..<count {
        let t = Double(i) / Double(sampleRate)
        let position = Double(i) / Double(count)
        seed = 1664525 &* seed &+ 1013904223
        let noise = Double(seed) / Double(UInt32.max) * 2 - 1
        air += (noise - air) * 0.20
        let frequency = 170 + 850 * pow(1 - position, 2.4)
        phase += 2 * Double.pi * frequency / Double(sampleRate)
        let envelope = pow(sin(Double.pi * position), 1.45)
        let wave = (sin(phase) * 0.29 + sin(phase * 1.503) * 0.11
                    + air * 0.64 + sin(2 * Double.pi * 57 * t) * 0.09) * envelope
        append16(Int16(max(-1, min(1, wave)) * 16000), to: &pcm)
    }
    var wav = Data()
    func text(_ value: String) { wav.append(contentsOf: value.utf8) }
    func u16(_ value: UInt16) { var n = value.littleEndian; withUnsafeBytes(of: &n) { wav.append(contentsOf: $0) } }
    func u32(_ value: UInt32) { var n = value.littleEndian; withUnsafeBytes(of: &n) { wav.append(contentsOf: $0) } }
    text("RIFF"); u32(UInt32(36 + pcm.count)); text("WAVE")
    text("fmt "); u32(16); u16(1); u16(1); u32(UInt32(sampleRate))
    u32(UInt32(sampleRate * 2)); u16(2); u16(16)
    text("data"); u32(UInt32(pcm.count)); wav.append(pcm)
    return wav
}
private var portalSound: NSSound?

let arguments = Array(CommandLine.arguments.dropFirst())
let delegated = arguments.first == "--session-notice"
let alertCatalog: [String: (String, String)] = [
    "storage": ("Almacenamiento crítico", "Revisar capacidad y respaldos. No se eliminó nada."),
    "storage-warning": ("Espacio de trabajo bajo", "Revisar archivos regenerables cuando convenga."),
    "edge": ("Edge · Control nativo", "Pestañas disponibles sin depuración remota."),
    "terminal": ("Terminal macOS", "Motor nativo pendiente de validación."),
    "recovery": ("Acción pendiente", "Verifica el resultado antes de reintentar.")
]
let alertInfo = arguments.first == "--status-alert" && arguments.count >= 2 ? alertCatalog[arguments[1]] : nil
let alerted = alertInfo != nil
let browserName = delegated && arguments.count >= 2 && ["chrome", "edge"].contains(arguments[1]) ? arguments[1].capitalized : "Navegador"
let minutes = delegated && arguments.count >= 3 ? max(0, min(30, Int(arguments[2]) ?? 0)) : 0
let actions = delegated && arguments.count >= 4 ? max(0, min(200, Int(arguments[3]) ?? 0)) : 0
let lifetime = alerted ? PortalSplash.alertLifetime : (delegated ? PortalSplash.delegatedLifetime : PortalSplash.connectionLifetime)
let height = alerted ? PortalSplash.alertHeight : (delegated ? PortalSplash.delegatedHeight : PortalSplash.connectionHeight)
let reducedMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion

let application = NSApplication.shared
application.setActivationPolicy(.accessory)
let area = (NSScreen.main ?? NSScreen.screens.first)?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
let frame = NSRect(x: area.maxX - PortalSplash.width - PortalSplash.margin,
                   y: area.maxY - height - PortalSplash.margin, width: PortalSplash.width, height: height)
let panel = NSPanel(contentRect: frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
panel.level = .floating
panel.backgroundColor = .clear
panel.isOpaque = false
panel.hasShadow = true
panel.ignoresMouseEvents = !(delegated || alerted)
panel.hidesOnDeactivate = false
panel.animationBehavior = .none
panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
panel.isReleasedWhenClosed = false
panel.appearance = NSAppearance(named: .darkAqua)

let glass = NSView(frame: NSRect(x: 0, y: 0, width: PortalSplash.width, height: height))
glass.wantsLayer = true
#if compiler(>=6.2)
if #available(macOS 26.0, *) {
    let liquid = NSGlassEffectView(frame: glass.bounds)
    liquid.cornerRadius = 26
    liquid.style = .clear
    liquid.tintColor = NSColor(calibratedRed: 0.025, green: 0.05, blue: 0.04, alpha: 0.90)
    liquid.contentView = glass
    panel.contentView = liquid
    print("[Portal View] MATERIAL=NATIVE_LIQUID_GLASS")
} else {
    let fallback = NSVisualEffectView(frame: glass.bounds)
    fallback.material = .popover
    fallback.blendingMode = .behindWindow
    fallback.state = .active
    fallback.wantsLayer = true
    fallback.layer?.cornerRadius = 26
    fallback.layer?.masksToBounds = true
    fallback.addSubview(glass)
    panel.contentView = fallback
    print("[Portal View] MATERIAL=LEGACY_VIBRANCY")
}
#else
let fallback = NSVisualEffectView(frame: glass.bounds)
fallback.material = .popover
fallback.blendingMode = .behindWindow
fallback.state = .active
fallback.wantsLayer = true
fallback.layer?.cornerRadius = 26
fallback.layer?.masksToBounds = true
fallback.addSubview(glass)
panel.contentView = fallback
print("[Portal View] MATERIAL=LEGACY_SDK")
#endif
let shade = CAGradientLayer()
shade.frame = glass.bounds
shade.colors = [NSColor(calibratedRed: 0.015, green: 0.055, blue: 0.035, alpha: 0.90).cgColor,
                NSColor(calibratedRed: 0.025, green: 0.032, blue: 0.045, alpha: 0.92).cgColor]
shade.startPoint = CGPoint(x: 0, y: 0.5)
shade.endPoint = CGPoint(x: 1, y: 0.5)
shade.cornerRadius = 26
glass.layer?.addSublayer(shade)
private let portal = PortalView(frame: NSRect(x: 6, y: height - 154, width: 146, height: 146))
glass.addSubview(portal)
let contentX: CGFloat = 152
func label(_ text: String, x: CGFloat, y: CGFloat, width: CGFloat, height: CGFloat,
           size: CGFloat, weight: NSFont.Weight, color: NSColor) -> NSTextField {
    let field = NSTextField(labelWithString: text)
    field.frame = NSRect(x: x, y: y, width: width, height: height)
    field.font = .systemFont(ofSize: size, weight: weight)
    field.textColor = color
    field.isSelectable = false
    return field
}
let brand = label("Edu!  ·  SANDBOX V3", x: contentX, y: height - 32, width: 285, height: 15,
                  size: 10.5, weight: .semibold, color: NSColor.white.withAlphaComponent(0.58))
glass.addSubview(brand)
let status = label(alertInfo?.0 ?? (delegated ? "Sesión delegada activa" : "Portal conectado"),
                   x: contentX, y: height - 63, width: 310, height: 25,
                   size: 18, weight: .semibold, color: .white)
glass.addSubview(status)
// Spanish translation of The Tempest, 4.1: "We are such stuff as dreams are made on."
// Attribution and the primary text URL are documented in README, not loaded remotely.
let phrase = NSTextField(wrappingLabelWithString: alertInfo?.1 ?? "«Estamos hechos de la materia de los sueños.»")
phrase.frame = NSRect(x: contentX, y: height - 111, width: 308, height: 38)
phrase.font = NSFont(name: "Georgia-Italic", size: 13) ?? .systemFont(ofSize: 13)
phrase.textColor = NSColor.white.withAlphaComponent(0.87)
phrase.maximumNumberOfLines = 2
phrase.isSelectable = false
glass.addSubview(phrase)
let attribution = label(alerted ? "ESTADO LOCAL · SANDBOX" : "WILLIAM SHAKESPEARE · LA TEMPESTAD",
                        x: contentX, y: height - 129, width: 315, height: 14,
                        size: 8.5, weight: .medium, color: NSColor.white.withAlphaComponent(0.46))
glass.addSubview(attribution)
let quip = label("Portal listo. Multiverso intacto.", x: contentX, y: height - 150, width: 315, height: 15,
                 size: 10.5, weight: .regular,
                 color: NSColor(calibratedRed: 0.70, green: 0.90, blue: 0.59, alpha: 0.9))
if !alerted { glass.addSubview(quip) }
if delegated {
    let details = label("\(browserName)  ·  \(minutes) min  ·  máx. \(actions) acciones",
                        x: contentX, y: 15, width: 315, height: 16,
                        size: 10, weight: .medium, color: NSColor.white.withAlphaComponent(0.58))
    glass.addSubview(details)
}
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
    let close = NSButton(title: "×", target: dismissal, action: #selector(NoticeDismissal.closeNotice(_:)))
    close.frame = NSRect(x: PortalSplash.width - 36, y: height - 34, width: 20, height: 20)
    close.isBordered = false
    close.font = .systemFont(ofSize: 18, weight: .light)
    close.contentTintColor = NSColor.white.withAlphaComponent(0.65)
    close.setAccessibilityLabel("Cerrar aviso")
    close.toolTip = "Cerrar aviso; no revoca la sesión"
    glass.addSubview(close)
}
// Dismissing only hides the notification; closing never revokes a session.
private final class LocalDiagnostics: NSObject {
    @objc func showLogs(_ sender: Any?) {
        let folder = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".cloud-sandbox-mcp-data/audit", isDirectory: true)
        NSWorkspace.shared.open(folder)
    }
}
private let diagnostics = LocalDiagnostics()
if alerted {
    let logs = NSButton(title: "Ver registros", target: diagnostics, action: #selector(LocalDiagnostics.showLogs(_:)))
    logs.frame = NSRect(x: contentX, y: 18, width: 125, height: 26)
    logs.bezelStyle = .rounded
    logs.setAccessibilityLabel("Abrir registros locales de Sandbox")
    glass.addSubview(logs)
}
panel.alphaValue = reducedMotion ? 1 : 0
panel.orderFrontRegardless()
if !arguments.contains("--silent") && ProcessInfo.processInfo.environment["SANDBOX_PORTAL_SOUND"] != "0" {
    portalSound = NSSound(data: portalWhoosh())
    portalSound?.volume = 0.22
    portalSound?.play()
}
if !reducedMotion {
    NSAnimationContext.runAnimationGroup { context in
        context.duration = 0.3
        panel.animator().alphaValue = 1
    }
}
// Render only this app's view for visual QA; never capture desktop/browser content.
if let index = arguments.firstIndex(of: "--render-preview"), index + 1 < arguments.count {
    let output = arguments[index + 1]
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
        guard let bitmap = glass.bitmapImageRepForCachingDisplay(in: glass.bounds) else {
            application.terminate(nil); return
        }
        glass.cacheDisplay(in: glass.bounds, to: bitmap)
        if let png = bitmap.representation(using: .png, properties: [:]) {
            try? png.write(to: URL(fileURLWithPath: output), options: .atomic)
        }
        panel.orderOut(nil)
        application.terminate(nil)
    }
}
DispatchQueue.main.asyncAfter(deadline: .now() + lifetime) {
    if reducedMotion { panel.orderOut(nil); application.terminate(nil) }
    else {
        NSAnimationContext.runAnimationGroup({ context in
            context.duration = 0.3
            panel.animator().alphaValue = 0
        }, completionHandler: { panel.orderOut(nil); application.terminate(nil) })
    }
}
application.run()
