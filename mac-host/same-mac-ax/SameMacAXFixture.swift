import AppKit
import Foundation

// Disposable background-only test app installed on the SAME Mac.
// No activate(), makeKeyAndOrderFront(), global input, web, or credentials.
final class Fixture: NSObject, NSApplicationDelegate {
    private var window: NSWindow?
    private var hours: NSTextField?
    private var result: NSTextField?
    private var dataFile: URL {
        FileManager.default.homeDirectoryForCurrentUser
          .appendingPathComponent("Library/Application Support/LCH/SameMacBackgroundAX/fixture-hours.txt")
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        let rect=NSRect(x:350,y:260,width:380,height:200)
        let panel=NSWindow(contentRect:rect,
            styleMask:[.titled,.closable],backing:.buffered,defer:false)
        panel.title="Same Mac AX Fixture"
        panel.collectionBehavior = [.canJoinAllSpaces]
        let heading=NSTextField(labelWithString:"Background AX test (same Mac)")
        heading.font=NSFont.systemFont(ofSize:15,weight:.semibold)
        heading.frame=NSRect(x:24,y:153,width:330,height:25)
        panel.contentView?.addSubview(heading)
        let label=NSTextField(labelWithString:"Hours")
        label.frame=NSRect(x:24,y:110,width:65,height:24)
        panel.contentView?.addSubview(label)
        let input=NSTextField(frame:NSRect(x:95,y:110,width:100,height:26))
        input.setAccessibilityLabel("Hours")
        input.stringValue=(try? String(contentsOf:dataFile,encoding:.utf8)) ?? "0"
        panel.contentView?.addSubview(input)
        hours=input
        let apply=NSButton(title:"Apply",target:self,
            action:#selector(applyValue(_:)))
        apply.setAccessibilityLabel("Apply")
        apply.frame=NSRect(x:207,y:106,width:100,height:32)
        panel.contentView?.addSubview(apply)
        let status=NSTextField(labelWithString:"Not saved")
        status.setAccessibilityLabel("Fixture status")
        status.frame=NSRect(x:24,y:64,width:330,height:20)
        panel.contentView?.addSubview(status)
        result=status
        window=panel
        // Order the window in the background. Do not request key or
        // application activation. Operator's foreground stays selected.
        panel.orderBack(nil)
    }
    @objc func applyValue(_ sender: Any?) {
        guard let typed=hours?.stringValue,
              typed.range(of:"^[0-9]{1,3}(\\.[0-9]{1,2})?$",
                options:.regularExpression) != nil,
              let value=Double(typed),value<=168 else {
            result?.stringValue="Invalid hours";return
        }
        do {
            try typed.write(to:dataFile,atomically:true,encoding:.utf8)
            result?.stringValue="Saved: "+typed
        }catch {
            result?.stringValue="Save failed"
        }
    }
}
let app=NSApplication.shared
let delegate=Fixture()
app.delegate=delegate
app.setActivationPolicy(.accessory)
app.run()
