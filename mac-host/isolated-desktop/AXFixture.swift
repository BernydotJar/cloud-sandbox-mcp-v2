import AppKit
import Foundation

// Disposable test app for independent Mac GUI worker acceptance only.
// No corporate accounts, input hooks, network, or host macOS interaction.
final class FixtureDelegate: NSObject, NSApplicationDelegate {
    var window:NSWindow!
    var field:NSTextField!
    var status:NSTextField!
    private var storage:URL {
        let dir=FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/LCH/IsolatedMacCUA")
        try? FileManager.default.createDirectory(at:dir,withIntermediateDirectories:true)
        return dir.appendingPathComponent("fixture-hours.txt")
    }
    func applicationDidFinishLaunching(_ notification:Notification) {
        window=NSWindow(contentRect:NSRect(x:250,y:220,width:380,height:220),
             styleMask:[.titled,.closable,.miniaturizable],
             backing:.buffered,defer:false)
        window.title="Sandbox AX Fixture"
        let heading=NSTextField(labelWithString:"Disposable isolated-worker test")
        heading.frame=NSRect(x:25,y:170,width:320,height:24)
        heading.font=NSFont.systemFont(ofSize:16,weight:.semibold)
        window.contentView?.addSubview(heading)
        let hours=NSTextField(labelWithString:"Hours")
        hours.frame=NSRect(x:25,y:125,width:70,height:24)
        window.contentView?.addSubview(hours)
        field=NSTextField(frame:NSRect(x:95,y:125,width:110,height:26))
        field.setAccessibilityLabel("Hours")
        field.identifier=NSUserInterfaceItemIdentifier("fixture-hours")
        field.stringValue=(try? String(contentsOf:storage,encoding:.utf8)) ?? "0"
        window.contentView?.addSubview(field)
        let apply=NSButton(title:"Apply",target:self,action:#selector(applyFixture))
        apply.frame=NSRect(x:215,y:120,width:110,height:33)
        apply.setAccessibilityLabel("Apply")
        window.contentView?.addSubview(apply)
        status=NSTextField(labelWithString:"Not applied")
        status.frame=NSRect(x:25,y:75,width:335,height:20)
        status.setAccessibilityLabel("Fixture status")
        window.contentView?.addSubview(status)
        window.makeKeyAndOrderFront(nil)
        NSApplication.shared.activate(ignoringOtherApps:true)
    }
    @objc func applyFixture(_ sender:Any?) {
        let value=field.stringValue
        guard let number=Double(value), number>=0, number<=168,
              value.count<=6 else {
            status.stringValue="Invalid hours";return
        }
        do {
            try value.write(to:storage,atomically:true,encoding:.utf8)
            status.stringValue="Saved hours: "+value
        }catch {
            status.stringValue="Save failed"
        }
    }
}
let app=NSApplication.shared
let delegate=FixtureDelegate()
app.delegate=delegate
app.setActivationPolicy(.regular)
app.run()
