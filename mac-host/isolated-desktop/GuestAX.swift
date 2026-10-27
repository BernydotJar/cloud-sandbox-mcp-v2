import AppKit
import ApplicationServices
import Foundation
import CryptoKit

// Runs in a separate macOS GUI worker session, never on the operator desktop.
// Input is a single JSON request over stdin; output is one bounded JSON reply.
// Controls are selected by fresh AX paths, names, roles, and a tree revision.
func output(_ result:[String:Any],_ code:Int32=0) -> Never {
    if let data=try? JSONSerialization.data(withJSONObject:result),data.count<150000 {
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data([10]))
    }
    exit(code)
}
func fail(_ code:String) -> Never { output(["ok":false,"error":code],2) }
func attribute(_ node:AXUIElement,_ key:String) -> AnyObject? {
    var value:CFTypeRef?
    if AXUIElementCopyAttributeValue(node,key as CFString,&value) != .success {return nil}
    return value
}
func str(_ node:AXUIElement,_ key:String) -> String {
    (attribute(node,key) as? String) ?? ""
}
func children(_ node:AXUIElement) -> [AXUIElement] {
    (attribute(node,kAXChildrenAttribute) as? [AXUIElement]) ?? []
}
func hash(_ value:String) -> String {
    SHA256.hash(data:Data(value.utf8)).map{String(format:"%02x",$0)}.joined()
}
func protected(_ node:AXUIElement) -> Bool {
    let label = [
        str(node, kAXSubroleAttribute),
        str(node, kAXTitleAttribute),
        str(node, kAXDescriptionAttribute)
    ].joined(separator: " ").lowercased()
    return ["password","passcode","secure","otp","credit card","cvv"].contains{label.contains($0)}
}
func name(_ node:AXUIElement) -> String {
    for key in [kAXTitleAttribute,kAXDescriptionAttribute,"AXPlaceholderValue"] {
        let value=str(node,key)
        if !value.isEmpty && value.count<=120 && !value.contains("://") {return value}
    }
    return ""
}
func observedValue(_ node:AXUIElement,_ role:String,_ name:String) -> [String:Any]? {
    guard ["AXTextField","AXTextArea","AXComboBox","AXCheckBox",
           "AXRadioButton"].contains(role),
          !protected(node), let raw=attribute(node,kAXValueAttribute)
    else {return nil}
    if ["AXCheckBox","AXRadioButton"].contains(role),
       let boolean=raw as? NSNumber {
        return ["kind":"boolean","value":boolean.boolValue]
    }
    guard let string=raw as? String else {
        return ["kind":"redacted","has_value":true]
    }
    let trimmed=string.trimmingCharacters(in:.whitespacesAndNewlines)
    if trimmed.isEmpty {return ["kind":"empty","has_value":false]}
    let number=trimmed.range(of:"^[0-9]{1,3}(\\.[0-9]{1,2})?$",
      options:.regularExpression) != nil
    let label=name.lowercased()
    let time=["hour","time","duration","lunes","martes","miércoles",
      "jueves","viernes","sábado","domingo","monday","tuesday",
      "wednesday","thursday","friday","saturday","sunday"]
    if number && time.contains(where:{label.contains($0)}),
       let value=Double(trimmed),value<=168 {
        return ["kind":"hours_numeric","value":trimmed,"has_value":true]
    }
    return ["kind":"redacted","has_value":true]
}
struct Row {
    let path:[Int]
    let node:AXUIElement
    let role:String
    let title:String
    let enabled:Bool
    let fingerprint:String
    let valueObservation:[String:Any]?
    var json:[String:Any] {
        var result:[String:Any]=["path":path,"role":role,"name":title,
         "enabled":enabled,"fingerprint":fingerprint]
        if let value=valueObservation {result["value_observation"]=value}
        return result
    }
}
func inventory(_ root:AXUIElement) -> [Row] {
    var pending:[(AXUIElement,[Int])]=[(root,[])]
    var rows:[Row]=[]
    var cursor=0
    while cursor<pending.count && rows.count<300 {
        let (node,path)=pending[cursor]
        cursor+=1
        let role=str(node,kAXRoleAttribute)
        if !protected(node) {
            let title=name(node)
            let enabled=(attribute(node,kAXEnabledAttribute) as? NSNumber)?.boolValue ?? false
            let observation=observedValue(node,role,title)
            let kind=observation?["kind"] as? String ?? ""
            let value=observation?["value"].map{String(describing:$0)} ?? ""
            let sig=hash("\(path.map(String.init).joined(separator:"."))|\(role)|\(title)|\(enabled)|\(kind)|\(value)")
            rows.append(Row(path:path,node:node,role:role,title:title,
                            enabled:enabled,fingerprint:sig,valueObservation:observation))
        }
        if path.count<10 {
            for (index,child) in children(node).prefix(100).enumerated() {
                if pending.count>=1200 {break}
                pending.append((child,path+[index]))
            }
        }
    }
    return rows
}
func main() {
    guard AXIsProcessTrusted() else { fail("WORKER_AX_PERMISSION_DENIED") }
    let raw=FileHandle.standardInput.readDataToEndOfFile()
    guard raw.count<16000,
          let request=(try? JSONSerialization.jsonObject(with:raw)) as? [String:Any],
          let operation=request["operation"] as? String,
          let bundle=request["bundle_id"] as? String,
          bundle.count>=8 && bundle.count<=120,
          let windowName=request["window_title"] as? String,
          !windowName.isEmpty && windowName.count<=120
    else {fail("INVALID_AX_REQUEST")}
    let apps=NSRunningApplication.runningApplications(withBundleIdentifier:bundle)
       .filter{ !$0.isTerminated }
    guard apps.count==1,let app=apps.first else {fail("WORKER_APP_NOT_UNIQUE")}
    let appElement=AXUIElementCreateApplication(app.processIdentifier)
    let windows=(attribute(appElement,kAXWindowsAttribute) as? [AXUIElement]) ?? []
    let matches=windows.filter{str($0,kAXTitleAttribute)==windowName}
    guard matches.count==1,let window=matches.first else {fail("WORKER_WINDOW_NOT_UNIQUE")}
    let nodes=inventory(window)
    let revision=hash(nodes.map{$0.fingerprint}.joined(separator:"|"))
    if operation=="snapshot" {
        output(["ok":true,"data":["provider":"isolated_mac_ax",
          "revision":revision,"window_title":windowName,
          "nodes":nodes.map{$0.json}]])
    }
    guard operation=="press" || operation=="set_value",
          request["expected_revision"] as? String == revision,
          let path=request["path"] as? [Int],
          path.count<=10,
          let fingerprint=request["fingerprint"] as? String,
          let target=nodes.first(where:{$0.path==path}),
          target.fingerprint==fingerprint,
          target.enabled else {fail("WORKER_AX_TARGET_STALE")}
    if operation=="press" {
        guard ["AXButton","AXLink","AXCheckBox","AXRadioButton",
           "AXPopUpButton","AXMenuItem"].contains(target.role)
        else {fail("WORKER_ACTION_NOT_SUPPORTED")}
        guard AXUIElementPerformAction(target.node,kAXPressAction as CFString) == .success
        else {fail("WORKER_AX_PRESS_FAILED")}
    } else {
        guard ["AXTextField","AXTextArea","AXComboBox"].contains(target.role),
          let value=request["value"] as? String,
          !value.isEmpty && value.count<=2000 else {fail("WORKER_INPUT_INVALID")}
        guard AXUIElementSetAttributeValue(target.node,kAXValueAttribute as CFString,
            value as CFTypeRef) == .success else {fail("WORKER_AX_SET_FAILED")}
    }
    output(["ok":true,"data":["dispatched":true,"effect":"UNVERIFIED_RELOAD_REQUIRED"]])
}
main()
