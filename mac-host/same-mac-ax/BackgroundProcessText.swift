import Foundation
import AppKit
import ApplicationServices
import CryptoKit

func reply(_ value:[String:Any], _ code:Int32=0) -> Never {
    FileHandle.standardOutput.write(try! JSONSerialization.data(withJSONObject:value))
    FileHandle.standardOutput.write(Data([10])); exit(code)
}
func fail(_ code:String) -> Never {reply(["ok":false,"error":code],2)}
func ax(_ item:AXUIElement,_ key:String) -> AnyObject? {
    var value:CFTypeRef?
    guard AXUIElementCopyAttributeValue(item,key as CFString,&value) == .success else {return nil}
    return value
}
func text(_ item:AXUIElement,_ key:String) -> String {(ax(item,key) as? String) ?? ""}
func front() -> String {NSWorkspace.shared.frontmostApplication?.bundleIdentifier ?? "UNKNOWN"}
func digest(_ value:String) -> String {SHA256.hash(data:Data(value.utf8)).map{String(format:"%02x",$0)}.joined()}
func same(_ a:AnyObject?,_ b:AXUIElement) -> Bool {
    guard let a=a,CFGetTypeID(a)==AXUIElementGetTypeID() else {return false}
    return CFEqual(a,b)
}
func main() {
    let bytes=FileHandle.standardInput.readDataToEndOfFile()
    guard bytes.count<16000,let r=(try? JSONSerialization.jsonObject(with:bytes)) as? [String:Any] else {fail("INVALID_REQUEST")}
    if r["operation"] as? String == "health" {
        reply(["ok":true,"data":["ax_permission":AXIsProcessTrusted(),"post_event_access":CGPreflightPostEventAccess()]])
    }
    guard AXIsProcessTrusted(),CGPreflightPostEventAccess() else {fail("PROCESS_INPUT_PERMISSION_REQUIRED")}
    guard let bundle=r["bundle_id"] as? String,bundle=="com.microsoft.edgemac",
          let title=r["window_title"] as? String,!title.isEmpty,title.count<=120,
          let path=r["path"] as? [Int],path.count<=30,path.allSatisfy({$0>=0 && $0<120}),
          let value=r["value"] as? String,value.utf16.count<=2000,
          let expected=r["expected_text"] as? [String:Any] else {fail("PROCESS_INPUT_TARGET_INVALID")}
    let before=front()
    guard before != bundle else {fail("TARGET_IS_FRONTMOST_USE_FOREGROUND_MODE")}
    let apps=NSRunningApplication.runningApplications(withBundleIdentifier:bundle)
    guard apps.count==1 else {fail("APP_INSTANCE_NOT_UNIQUE")}
    let app=apps[0],root=AXUIElementCreateApplication(app.processIdentifier)
    AXUIElementSetMessagingTimeout(root,3)
    let windows=(ax(root,kAXWindowsAttribute) as? [AXUIElement]) ?? []
    let found=windows.filter{text($0,kAXTitleAttribute)==title}
    guard found.count==1 else {fail("WINDOW_NOT_UNIQUE")}
    let window=found[0]
    var field=window
    for index in path {
        let children=(ax(field,kAXChildrenAttribute) as? [AXUIElement]) ?? []
        guard index<children.count else {fail("TEXT_CONTROL_STALE")}
        field=children[index]
    }
    guard text(field,kAXRoleAttribute)=="AXTextArea",
          (ax(field,kAXEnabledAttribute) as? NSNumber)?.boolValue==true else {fail("TEXT_CONTROL_UNSUPPORTED")}
    let labels=[text(field,kAXTitleAttribute),text(field,kAXDescriptionAttribute),text(field,kAXSubroleAttribute),text(field,"AXPlaceholderValue")].joined(separator:" ").lowercased()
    guard !["password","secure","passcode","credit card","cvv","otp","verification code","secret","access token"].contains(where:{labels.contains($0)}),
          (ax(field,"AXProtectedContent") as? NSNumber)?.boolValue != true else {fail("PROTECTED_TEXT_CONTROL")}
    func matchesValue() -> Bool {
        let raw=text(field,kAXValueAttribute)
        if expected["kind"] as? String == "empty" {return raw.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty}
        guard expected["kind"] as? String == "text_digest",let hash=expected["sha256"] as? String else {return false}
        return digest(raw)==hash
    }
    guard matchesValue(),front()==before else {fail("TEXT_CONTENT_OR_FOREGROUND_CHANGED")}
    guard AXUIElementSetAttributeValue(field,kAXFocusedAttribute as CFString,kCFBooleanTrue) == .success else {fail("ELEMENT_FOCUS_UNSUPPORTED")}
    var focused=false
    for _ in 0..<20 {
        guard front()==before else {fail("FOREGROUND_CHANGED_DURING_FOCUS")}
        if same(ax(root,kAXFocusedUIElementAttribute),field) {focused=true;break}
        RunLoop.current.run(until:Date().addingTimeInterval(0.05))
    }
    guard focused,same(ax(root,kAXFocusedWindowAttribute),window),matchesValue(),front()==before else {fail("PROCESS_INPUT_FOCUS_NOT_VERIFIED")}
    let source:CGEventSource?=nil
    func pair(_ key:CGKeyCode,_ flags:CGEventFlags,_ unicode:[UniChar]?=nil) -> [CGEvent] {
        guard let down=CGEvent(keyboardEventSource:source,virtualKey:key,keyDown:true),
              let up=CGEvent(keyboardEventSource:source,virtualKey:key,keyDown:false) else {fail("PROCESS_EVENT_CREATE_FAILED")}
        down.flags=flags;up.flags=flags
        if let chars=unicode {chars.withUnsafeBufferPointer{down.keyboardSetUnicodeString(stringLength:chars.count,unicodeString:$0.baseAddress!)}}
        return [down,up]
    }
    // Construct every event before dispatch. Only empty-field entry or a
    // fingerprint-bound clear is supported. No Command-A, session/HID tap,
    // clipboard or foreground activation is used.
    let previous=text(field,kAXValueAttribute)
    let name=text(field,kAXTitleAttribute).isEmpty ? text(field,kAXDescriptionAttribute) : text(field,kAXTitleAttribute)
    let placeholder=previous==name+"\n"
    let isEmpty=previous.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty || placeholder
    guard value.isEmpty || isEmpty else {fail("PROCESS_REPLACE_EXISTING_TEXT_UNSUPPORTED")}
    var events:[CGEvent]=[]
    if value.isEmpty && !isEmpty {
        let count=(ax(field,kAXNumberOfCharactersAttribute) as? NSNumber)?.intValue ?? previous.utf16.count
        guard count>0 && count<=2000 else {fail("PROCESS_CLEAR_LENGTH_UNSUPPORTED")}
        var range=CFRange(location:0,length:count)
        guard let selection=AXValueCreate(.cfRange,&range),AXUIElementSetAttributeValue(field,kAXSelectedTextRangeAttribute as CFString,selection) == .success else {fail("PROCESS_CLEAR_SELECTION_UNSUPPORTED")}
        var selected=false
        for _ in 0..<20 {
            guard front()==before && matchesValue() else {fail("PROCESS_CLEAR_TARGET_CHANGED")}
            if let v=ax(field,kAXSelectedTextRangeAttribute),CFGetTypeID(v)==AXValueGetTypeID() {
                let selectedValue=unsafeBitCast(v,to:AXValue.self);var actual=CFRange()
                if AXValueGetValue(selectedValue,.cfRange,&actual) && actual.location==0 && actual.length==count {selected=true;break}
            }
            RunLoop.current.run(until:Date().addingTimeInterval(0.05))
        }
        guard selected else {fail("PROCESS_CLEAR_SELECTION_NOT_VERIFIED")}
        events += pair(51,[])
    }
    else {
        let units=Array(value.utf16);var index=0
        while index<units.count {
            var end=min(index+20,units.count)
            if end<units.count && units[end-1]>=0xD800 && units[end-1]<=0xDBFF {end-=1}
            events += pair(0,[],Array(units[index..<end]));index=end
        }
    }
    guard same(ax(root,kAXFocusedUIElementAttribute),field),same(ax(root,kAXFocusedWindowAttribute),window),matchesValue(),front()==before else {fail("PROCESS_INPUT_TARGET_CHANGED_BEFORE_DISPATCH")}
    for event in events {event.postToPid(app.processIdentifier)}
    guard front()==before else {fail("FOREGROUND_CHANGED_BY_TARGET_APP")}
    reply(["ok":true,"data":["dispatched":true,"frontmost_unchanged":true,"input_backend":"process_unicode","global_event_posts":0,"pointer_events":0,"activation_calls":0,"replacement_scope":"empty_field_or_clear","persistence":"UNVERIFIED_REQUIRE_READBACK"]])
}
main()
