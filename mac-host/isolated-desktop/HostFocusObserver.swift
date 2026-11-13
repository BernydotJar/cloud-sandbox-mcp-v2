import AppKit
import Foundation

// Observation only, on the operator Mac. No app activate, pointer,
/// keystroke, screen capture, or Accessibility mutation calls.
let app=NSApplication.shared
app.setActivationPolicy(.prohibited)

let workspace=NSWorkspace.shared
let startApp=workspace.frontmostApplication?.bundleIdentifier ?? "UNKNOWN"
let startCursor=NSEvent.mouseLocation
var activations:[String]=[]
let center=workspace.notificationCenter
let observer=center.addObserver(forName:NSWorkspace.didActivateApplicationNotification,
    object:nil,queue:.main){note in
    if let application=note.userInfo?[NSWorkspace.applicationUserInfoKey]
        as? NSRunningApplication {
        activations.append(application.bundleIdentifier ?? "UNKNOWN")
    }
}
let duration:TimeInterval=12
RunLoop.current.run(until:Date().addingTimeInterval(duration))
center.removeObserver(observer)
let endApp=workspace.frontmostApplication?.bundleIdentifier ?? "UNKNOWN"
let endCursor=NSEvent.mouseLocation
let report:[String:Any]=[
    "observer":"operator_host_appkit",
    "read_only":true,
    "duration_seconds":duration,
    "start_app":startApp,
    "end_app":endApp,
    "activation_count":activations.count,
    "cursor_displacement_points":hypot(endCursor.x-startCursor.x,
                                         endCursor.y-startCursor.y),
    "app_stable":activations.isEmpty && startApp==endApp,
    "note":"User-initiated focus/cursor changes cannot be attributed to worker; review alongside guest identity and isolated action evidence."
]
if let json=try? JSONSerialization.data(withJSONObject:report),
   let text=String(data:json,encoding:.utf8) {print(text)}
