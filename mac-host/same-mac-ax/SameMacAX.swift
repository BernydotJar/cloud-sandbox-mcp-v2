import Foundation
import AppKit
import ApplicationServices
import CryptoKit

// Same-machine semantic AX backend. NEVER activates apps, posts keyboard
// events, moves the pointer or changes windows to the foreground.
// Input: one JSON request on stdin. Output: one bounded JSON reply.
func respond(_ output: [String:Any], _ exitCode: Int32 = 0) -> Never {
    guard let bytes = try? JSONSerialization.data(withJSONObject: output),
          bytes.count < 140_000 else {exit(3)}
    FileHandle.standardOutput.write(bytes)
    FileHandle.standardOutput.write(Data([10]))
    exit(exitCode)
}
func fail(_ code: String) -> Never {
    respond(["ok":false,"error":code],2)
}
func ax(_ item: AXUIElement, _ property: String) -> AnyObject? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(item, property as CFString, &value) == .success
    else {return nil}
    return value
}
func text(_ item: AXUIElement, _ key: String) -> String {
    (ax(item,key) as? String) ?? ""
}
func children(_ item: AXUIElement) -> [AXUIElement] {
    (ax(item,kAXChildrenAttribute) as? [AXUIElement]) ?? []
}
func enabled(_ item: AXUIElement) -> Bool {
    (ax(item,kAXEnabledAttribute) as? NSNumber)?.boolValue ?? false
}
func sha(_ string: String) -> String {
    SHA256.hash(data:Data(string.utf8))
        .map{String(format:"%02x",$0)}.joined()
}
func isProtected(_ item: AXUIElement) -> Bool {
    let name = [
        text(item,kAXSubroleAttribute),text(item,kAXTitleAttribute),
        text(item,kAXDescriptionAttribute),text(item,"AXPlaceholderValue")
    ].joined(separator:" ").lowercased()
    let phrases=["secure","password","passcode","otp","one-time",
        "credit card","cvv","secret","access token","verification code"]
    return phrases.contains(where:{name.contains($0)}) ||
        (ax(item,"AXProtectedContent") as? NSNumber)?.boolValue == true
}
func label(_ item: AXUIElement) -> String {
    let candidates=[text(item,kAXTitleAttribute),
        text(item,kAXDescriptionAttribute),text(item,"AXPlaceholderValue"),
        text(item,kAXHelpAttribute)]
    guard let name=candidates.first(where:{!$0.isEmpty}) else {return ""}
    guard name.count<=120 && !name.contains("://") &&
          !name.contains("@") else {return ""}
    return name
}
func observation(_ item: AXUIElement, _ role: String,
                 _ name: String) -> [String:Any]? {
    guard ["AXTextField","AXTextArea","AXComboBox","AXCheckBox",
           "AXRadioButton"].contains(role),
          let raw=ax(item,kAXValueAttribute) else {return nil}
    if ["AXCheckBox","AXRadioButton"].contains(role),
       let value=raw as? NSNumber {
        return ["kind":"boolean","value":value.boolValue]
    }
    guard let string=raw as? String else {
        return ["kind":"redacted","has_value":true]
    }
    let trimmed=string.trimmingCharacters(in:.whitespacesAndNewlines)
    if trimmed.isEmpty {return ["kind":"empty","has_value":false]}
    let hints=["hours","hour","duration","time","lunes","martes",
       "miércoles","jueves","viernes","sábado","domingo",
       "monday","tuesday","wednesday","thursday","friday",
       "saturday","sunday"]
    let relevant=hints.contains(where:{name.lowercased().contains($0)})
    if relevant &&
       trimmed.range(of:"^[0-9]{1,3}(\\.[0-9]{1,2})?$",
        options:.regularExpression) != nil,
       let number=Double(trimmed), number<=168 {
        return ["kind":"hours_numeric","value":trimmed,"has_value":true]
    }
    return ["kind":"redacted","has_value":true]
}
struct AXEntry {
    let item: AXUIElement
    let path: [Int]
    let role: String
    let name: String
    let active: Bool
    let value: [String:Any]?
    var fingerprint: String {
        let kind=value?["kind"] as? String ?? ""
        let observed=value?["value"].map{String(describing:$0)} ?? ""
        return sha("\(path.map(String.init).joined(separator:"."))|\(role)|\(name)|\(active)|\(kind)|\(observed)")
    }
    var record: [String:Any] {
        var result: [String:Any]=["path":path,"role":role,
            "name":name,"enabled":active,"fingerprint":fingerprint]
        if let value=value {result["value_observation"]=value}
        return result
    }
}
func snapshot(_ root:AXUIElement) -> [AXEntry] {
    var queue:[(AXUIElement,[Int])]=[(root,[])]
    var cursor=0
    var rows:[AXEntry]=[]
    while cursor<queue.count && rows.count<350 {
        let (item,path)=queue[cursor]
        cursor+=1
        if isProtected(item) {continue}
        let role=text(item,kAXRoleAttribute)
        let title=label(item)
        rows.append(AXEntry(item:item,path:path,role:role,name:title,
            active:enabled(item),value:observation(item,role,title)))
        if path.count>=10 {continue}
        for (index,child) in children(item).prefix(120).enumerated() {
            if queue.count>=1200 {break}
            queue.append((child,path+[index]))
        }
    }
    return rows
}
func frontmost() -> String {
    NSWorkspace.shared.frontmostApplication?.bundleIdentifier ?? "UNKNOWN"
}
func main() {
    let bytes=FileHandle.standardInput.readDataToEndOfFile()
    guard bytes.count>1 && bytes.count<=16_384,
       let request=(try? JSONSerialization.jsonObject(with:bytes)) as? [String:Any],
       let operation=request["operation"] as? String else {fail("INVALID_REQUEST")}
    if operation=="health" {
        respond(["ok":true,"data":["ax_permission":AXIsProcessTrusted(),
            "provider":"same_mac_background_ax",
            "global_input":false,"requires_foreground":false]])
    }
    guard AXIsProcessTrusted() else {fail("AX_PERMISSION_DENIED")}
    guard ["snapshot","set_value","press"].contains(operation),
       let bundle=request["bundle_id"] as? String,
       bundle.count>=8 && bundle.count<=120 &&
       bundle.range(of:"^[A-Za-z0-9.-]+$",options:.regularExpression) != nil,
       let windowTitle=request["window_title"] as? String,
       !windowTitle.isEmpty && windowTitle.count<=120 else {fail("INVALID_TARGET")}
    let before=frontmost()
    guard before != bundle else {fail("TARGET_IS_FRONTMOST_USE_FOREGROUND_MODE")}
    let apps=NSRunningApplication.runningApplications(withBundleIdentifier:bundle)
        .filter{!$0.isTerminated}
    guard apps.count==1,let app=apps.first else {fail("APP_INSTANCE_NOT_UNIQUE")}
    let root=AXUIElementCreateApplication(app.processIdentifier)
    AXUIElementSetMessagingTimeout(root,3)
    let windows=(ax(root,kAXWindowsAttribute) as? [AXUIElement]) ?? []
    let matches=windows.filter{text($0,kAXTitleAttribute)==windowTitle}
    guard matches.count==1,let window=matches.first else {
        fail("WINDOW_NOT_UNIQUE_OR_AX_UNAVAILABLE")
    }
    let entries=snapshot(window)
    let revision=sha(entries.map{$0.fingerprint}.joined(separator:"|"))
    guard frontmost()==before else {fail("FOREGROUND_CHANGED_DURING_AX_READ")}
    if operation=="snapshot" {
        respond(["ok":true,"data":["provider":"same_mac_background_ax",
          "revision":revision,"window_title":windowTitle,
          "nodes":entries.map{$0.record},"frontmost_unchanged":true]])
    }
    guard let expected=request["expected_revision"] as? String,
        expected==revision,
        let targetPath=request["path"] as? [Int],
        targetPath.count<=10 &&
        targetPath.allSatisfy({$0>=0 && $0<120}),
        let fingerprint=request["fingerprint"] as? String,
        let target=entries.first(where:{$0.path==targetPath}),
        target.fingerprint==fingerprint,target.active,
        !isProtected(target.item) else {fail("AX_TARGET_STALE")}
    if operation=="set_value" {
        guard ["AXTextField","AXTextArea","AXComboBox"].contains(target.role),
            let value=request["value"] as? String,
            !value.isEmpty && value.count<=2000 else {fail("AX_VALUE_INVALID")}
        var writable: DarwinBoolean=false
        guard AXUIElementIsAttributeSettable(target.item,
            kAXValueAttribute as CFString,&writable) == .success &&
            writable.boolValue else {fail("AX_VALUE_NOT_SETTABLE")}
        guard AXUIElementSetAttributeValue(target.item,
            kAXValueAttribute as CFString,value as CFTypeRef) == .success
        else {fail("AX_SET_VALUE_FAILED")}
    } else {
        guard request["allow_press"] as? Bool == true,
            ["AXButton","AXLink","AXCheckBox","AXRadioButton",
             "AXPopUpButton","AXMenuItem"].contains(target.role)
        else {fail("AX_PRESS_NOT_CERTIFIED")}
        guard AXUIElementPerformAction(target.item,kAXPressAction as CFString)
           == .success else {fail("AX_PRESS_FAILED")}
    }
    guard frontmost()==before else {
        fail("FOREGROUND_CHANGED_BY_TARGET_APP")
    }
    respond(["ok":true,"data":["dispatched":true,
        "provider":"same_mac_background_ax","frontmost_unchanged":true,
        "business_effect":"UNVERIFIED_REQUIRE_READBACK"]])
}
main()
