import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

// READ ONLY. Never activate a window, request TCC permission, capture a frame,
// read field text, window titles, or send input to a remote desktop.
func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var result: CFTypeRef?
    if AXUIElementCopyAttributeValue(element, name as CFString, &result) != .success {
        return nil
    }
    return result
}
func elements(_ element: AXUIElement, _ name: String) -> [AXUIElement] {
    return (attribute(element, name) as? [AXUIElement]) ?? []
}
func role(_ element: AXUIElement) -> String {
    return (attribute(element, kAXRoleAttribute) as? String) ?? "UNKNOWN"
}
func isHorizon(_ app: NSRunningApplication) -> Bool {
    let name = (app.localizedName ?? "").lowercased()
    let bundle = (app.bundleIdentifier ?? "").lowercased()
    return (name.contains("horizon") &&
             (name.contains("client") || name.contains("omnissa") || name.contains("vmware"))) ||
           (bundle.contains("horizon") &&
             (bundle.contains("omnissa") || bundle.contains("vmware")))
}

let foregroundBefore = NSWorkspace.shared.frontmostApplication?.processIdentifier
let candidates = NSWorkspace.shared.runningApplications.filter { !$0.isTerminated && isHorizon($0) }
let axTrusted = AXIsProcessTrusted()
let screenCaptureGranted = CGPreflightScreenCaptureAccess()
var numberOfWindows = 0
var numberOfNodes = 0
var numberOfInteractiveNodes = 0
var roleCounts: [String: Int] = [:]

if axTrusted {
    for app in candidates.prefix(3) {
        let root = AXUIElementCreateApplication(app.processIdentifier)
        AXUIElementSetMessagingTimeout(root, 1)
        let windows = elements(root, kAXWindowsAttribute).prefix(8)
        numberOfWindows += windows.count
        for window in windows {
            var pending: [(AXUIElement, Int)] = [(window, 0)]
            while !pending.isEmpty && numberOfNodes < 360 {
                let (item, depth) = pending.removeLast()
                let name = role(item)
                numberOfNodes += 1
                roleCounts[name, default: 0] += 1
                if ["AXButton", "AXTextField", "AXTextArea", "AXComboBox",
                    "AXTable", "AXRow", "AXLink", "AXCheckBox", "AXPopUpButton"].contains(name) {
                    numberOfInteractiveNodes += 1
                }
                if depth < 6 {
                    for child in elements(item, kAXChildrenAttribute).prefix(40).reversed() {
                        pending.append((child, depth + 1))
                    }
                }
            }
        }
    }
}
let foregroundAfter = NSWorkspace.shared.frontmostApplication?.processIdentifier
let uniqueBundle = candidates.count == 1 ? (candidates[0].bundleIdentifier ?? "") : ""
let safeBundle = uniqueBundle.range(of: "^[A-Za-z0-9.-]{8,120}$",
                                    options: .regularExpression) != nil ? uniqueBundle : ""
let result: [String: Any] = [
    "schema": "omnissa.vdi.host-readonly.v1",
    "running": !candidates.isEmpty,
    "candidate_count": candidates.count,
    "bundle_id": safeBundle,
    "accessibility_trusted": axTrusted,
    "screen_capture_preflight": screenCaptureGranted,
    "window_count": numberOfWindows,
    "role_count": numberOfNodes,
    "interactive_role_count": numberOfInteractiveNodes,
    "roles": roleCounts,
    "foreground_unchanged": foregroundBefore == foregroundAfter,
    "captured_remote_content": false,
    "sent_input": false
]
if JSONSerialization.isValidJSONObject(result),
   let encoded = try? JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]) {
    FileHandle.standardOutput.write(encoded)
    FileHandle.standardOutput.write(Data([0x0A]))
} else {
    FileHandle.standardError.write(Data("HOST_DOCTOR_SERIALIZATION_FAILED\n".utf8))
    exit(2)
}
