import Foundation
import AppKit
import ApplicationServices
import CryptoKit
import Darwin

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
    return ["kind":"text_digest","length":string.utf16.count,"sha256":sha(string),"has_value":true]
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
        let observed=value?["value"].map{String(describing:$0)} ?? value?["sha256"] as? String ?? ""
        return sha("\(path.map(String.init).joined(separator:"."))|\(role)|\(name)|\(active)|\(kind)|\(observed)")
    }
    var pressAvailable: Bool {
        var names: CFArray?
        guard AXUIElementCopyActionNames(item,&names) == .success else {return false}
        return (names as? [String] ?? []).contains(kAXPressAction)
    }
    var valueSettable:Bool {
        var result:DarwinBoolean=false
        return AXUIElementIsAttributeSettable(item,kAXValueAttribute as CFString,&result) == .success && result.boolValue
    }
    var record: [String:Any] {
        var result: [String:Any]=["path":path,"role":role,
            "name":name,"enabled":active,"fingerprint":fingerprint,"press_available":pressAvailable,"value_settable":valueSettable]
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
        if path.count>=30 {continue}
        for (index,child) in children(item).prefix(120).enumerated() {
            if queue.count>=1200 {break}
            queue.append((child,path+[index]))
        }
    }
    return rows
}
func freshForegroundProbe()->String{
    // A short-lived AppKit read has no stale resident NSWorkspace cache.
    // Fixed self executable/flag, no shell, Apple Events, activation or input.
    let task=Process();let output=Pipe()
    task.executableURL=URL(fileURLWithPath:CommandLine.arguments[0]);task.arguments=["--foreground"]
    task.standardOutput=output;task.standardError=FileHandle.nullDevice;task.standardInput=FileHandle.nullDevice
    do{try task.run()}catch{return "UNKNOWN"}
    let deadline=Date().addingTimeInterval(1)
    while task.isRunning && Date()<deadline{Thread.sleep(forTimeInterval:0.005)}
    if task.isRunning{task.terminate();return "UNKNOWN"}
    guard task.terminationStatus==0 else{return "UNKNOWN"}
    let bytes=output.fileHandleForReading.readDataToEndOfFile()
    guard bytes.count<=160,let raw=String(data:bytes,encoding:.utf8) else{return "UNKNOWN"}
    let bundle=raw.trimmingCharacters(in:.whitespacesAndNewlines)
    return bundle.range(of:"^[A-Za-z0-9][A-Za-z0-9.-]{1,140}$",options:.regularExpression) != nil ? bundle : "UNKNOWN"
}
func frontmost() -> String {
    let system=AXUIElementCreateSystemWide()
    AXUIElementSetMessagingTimeout(system,1)
    if let raw=ax(system,kAXFocusedApplicationAttribute),CFGetTypeID(raw)==AXUIElementGetTypeID(){
        let application=unsafeBitCast(raw,to:AXUIElement.self);var pid:pid_t=0
        if AXUIElementGetPid(application,&pid) == .success,
           let bundle=NSRunningApplication(processIdentifier:pid)?.bundleIdentifier{return bundle}
    }
    return freshForegroundProbe()
}

func execute(_ bytes:Data) throws -> [String:Any] {
    RunLoop.current.run(until:Date().addingTimeInterval(0.005))
    guard bytes.count>1 && bytes.count<=16_384,
       let request=(try? JSONSerialization.jsonObject(with:bytes)) as? [String:Any],
       let operation=request["operation"] as? String else {throw NativeFailure("INVALID_REQUEST")}
    if operation=="health" {
        return (["ok":true,"data":["ax_permission":AXIsProcessTrusted(),"post_event_access":CGPreflightPostEventAccess(),"resident":CommandLine.arguments.contains("--worker"),"worker_pid":getpid(),"worker_parent_pid":getppid(),
            "provider":"same_mac_background_ax",
            "global_input":false,"requires_foreground":false]])
    }
    guard AXIsProcessTrusted() else {throw NativeFailure("AX_PERMISSION_DENIED")}
    guard ["windows","identity","snapshot","validate_text","process_text","set_value","press"].contains(operation),
       let bundle=request["bundle_id"] as? String,
       bundle.count>=8 && bundle.count<=120 &&
       bundle.range(of:"^[A-Za-z0-9.-]+$",options:.regularExpression) != nil,
       let windowTitle=request["window_title"] as? String,
       !windowTitle.isEmpty && windowTitle.count<=120 else {throw NativeFailure("INVALID_TARGET")}
    let before=frontmost()
    guard before != "UNKNOWN" else{throw NativeFailure("FOREGROUND_IDENTITY_UNAVAILABLE")}
    guard before != bundle || operation != "process_text" else {throw NativeFailure("TARGET_IS_FRONTMOST_USE_FOREGROUND_MODE")}
    let apps=NSRunningApplication.runningApplications(withBundleIdentifier:bundle)
        .filter{!$0.isTerminated}
    guard apps.count==1,let app=apps.first else {throw NativeFailure("APP_INSTANCE_NOT_UNIQUE")}
    let root=AXUIElementCreateApplication(app.processIdentifier)
    AXUIElementSetMessagingTimeout(root,3)
    // Chromium exposes only partial native accessibility until an assistive
    // client requests complete mode. Browser chrome alone can look actionable
    // while web AXPress is missing. Never activate the app or use debug flags.
    if ["com.microsoft.edgemac","com.google.Chrome"].contains(bundle) &&
       (ax(root,"AXEnhancedUserInterface") as? NSNumber)?.boolValue != true {
        let requested=AXUIElementSetAttributeValue(root,"AXEnhancedUserInterface" as CFString,
                  kCFBooleanTrue)
        // Chromium may apply this attribute yet return attributeUnsupported.
        // Read back the actual transition rather than treating that reply as
        // proof of failure or of complete web-control support.
        Thread.sleep(forTimeInterval:3.2)
        guard requested == .success ||
            (ax(root,"AXEnhancedUserInterface") as? NSNumber)?.boolValue == true
            else {throw NativeFailure("BROWSER_COMPLETE_AX_UNAVAILABLE")}
        guard frontmost()==before else {throw NativeFailure("FOREGROUND_CHANGED_DURING_AX_READ")}
    }
    let windows=retainedWindows(root,bundle,app.processIdentifier)
    if operation=="windows" {
        guard frontmost()==before else {throw NativeFailure("FOREGROUND_CHANGED_DURING_AX_READ")}
        return (["ok":true,"data":["windows":windows.prefix(50).map{text($0,kAXTitleAttribute)},"frontmost_unchanged":true]])
    }
    let matches=windows.filter{text($0,kAXTitleAttribute)==windowTitle}
    guard matches.count==1,let window=matches.first else {
        throw NativeFailure("WINDOW_NOT_UNIQUE_OR_AX_UNAVAILABLE")
    }
    for index in windowLeases.indices where CFEqual(windowLeases[index].element,window){windowLeases[index].touched=Date()}
    let originalFocusedWindow=ax(root,kAXFocusedWindowAttribute)
    let entries=snapshot(window)
    if operation=="identity" {
        let documents=entries.filter{$0.role=="AXWebArea"}
        guard ["com.microsoft.edgemac","com.google.Chrome"].contains(bundle),
              let depth=documents.map({$0.path.count}).min()
              else {throw NativeFailure("BROWSER_DOCUMENT_IDENTITY_UNAVAILABLE")}
        let selected=documents.filter{$0.path.count==depth}
        guard selected.count==1,let web=selected.first
              else {throw NativeFailure("BROWSER_DOCUMENT_IDENTITY_UNAVAILABLE")}
        let raw=ax(web.item,"AXURL")
        var address=(raw as? URL)?.absoluteString ?? (raw as? String) ?? ""
        if address.isEmpty {
            // Exact browser toolbar field, outside the selected document.
            let bars=entries.filter{$0.role=="AXTextField" && $0.name=="Address and search bar" &&
                !$0.path.starts(with:web.path)}
            guard bars.count==1 else {throw NativeFailure("BROWSER_URL_IDENTITY_UNAVAILABLE")}
            address=text(bars[0].item,kAXValueAttribute)
        }
        guard var url=URLComponents(string:address),
              ["https","http"].contains(url.scheme?.lowercased() ?? ""),
              let host=url.host,!host.isEmpty,url.user==nil,url.password==nil
              else {throw NativeFailure("BROWSER_URL_IDENTITY_UNAVAILABLE")}
        url.query=nil;url.fragment=nil
        if url.path.isEmpty {url.path="/"}
        guard let safe=url.string,safe.utf8.count<=2048,
              frontmost()==before else {throw NativeFailure("BROWSER_URL_IDENTITY_UNAVAILABLE")}
        return (["ok":true,"data":["browser_url":safe,"document_title":label(web.item),"window_title":windowTitle,
            "frontmost_unchanged":true]])
    }
    let revision=sha(entries.map{$0.fingerprint}.joined(separator:"|"))
    guard frontmost()==before else {throw NativeFailure("FOREGROUND_CHANGED_DURING_AX_READ")}
    if operation=="snapshot" {
        return (["ok":true,"data":["provider":"same_mac_background_ax",
          "revision":revision,"window_title":windowTitle,
          "nodes":entries.map{$0.record},"frontmost_unchanged":true]])
    }
    guard let expected=request["expected_revision"] as? String,
        expected==revision,
        let targetPath=request["path"] as? [Int],
        targetPath.count<=30 &&
        targetPath.allSatisfy({$0>=0 && $0<120}),
        let fingerprint=request["fingerprint"] as? String,
        let target=entries.first(where:{$0.path==targetPath}),
        target.fingerprint==fingerprint,target.active,
        !isProtected(target.item) else {throw NativeFailure("AX_TARGET_STALE")}
    if operation=="validate_text" {return (["ok":true,"data":["validated":true,"frontmost_unchanged":true]])}
    if operation=="process_text" {
        guard bundle=="com.microsoft.edgemac",target.role=="AXTextArea",
              CGPreflightPostEventAccess() else {throw NativeFailure("PROCESS_INPUT_PERMISSION_REQUIRED")}
        return try certifiedProcessText(request,field:target.item,root:root,window:window,app:app,before:before)
    }
    if operation=="set_value" {
        guard ["AXTextField","AXTextArea","AXComboBox"].contains(target.role),
            let value=request["value"] as? String,
            value.count<=2000 else {throw NativeFailure("AX_VALUE_INVALID")}
        var writable: DarwinBoolean=false
        guard AXUIElementIsAttributeSettable(target.item,
            kAXValueAttribute as CFString,&writable) == .success &&
            writable.boolValue else {throw NativeFailure("AX_VALUE_NOT_SETTABLE")}
        if bundle=="com.microsoft.edgemac" && target.role=="AXTextArea" && target.name=="Type a message" {
            let previous=text(target.item,kAXValueAttribute)
            guard value.isEmpty || previous.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty || previous==target.name+"\n"
                else{throw NativeFailure("PROCESS_REPLACE_EXISTING_TEXT_UNSUPPORTED")}
        }
        if request["focus_element"] as? Bool == true {
            var focusWritable: DarwinBoolean=false
            guard AXUIElementIsAttributeSettable(target.item,kAXFocusedAttribute as CFString,&focusWritable) == .success && focusWritable.boolValue else {throw NativeFailure("AX_ELEMENT_FOCUS_UNSUPPORTED")}
            guard AXUIElementSetAttributeValue(target.item,kAXFocusedAttribute as CFString,kCFBooleanTrue) == .success else {throw NativeFailure("AX_ELEMENT_FOCUS_FAILED")}
            guard frontmost()==before else {throw NativeFailure("FOREGROUND_CHANGED_BY_TARGET_APP")}
        }
        if request["text_method"] as? String == "selected_text" {
            let count=value.isEmpty ? ((ax(target.item,kAXNumberOfCharactersAttribute) as? NSNumber)?.intValue ?? 0) : 0
            var range=CFRange(location:0,length:count)
            guard let rangeValue=AXValueCreate(.cfRange,&range),
                AXUIElementSetAttributeValue(target.item,kAXSelectedTextRangeAttribute as CFString,rangeValue) == .success else {throw NativeFailure("AX_SELECTION_UNSUPPORTED")}
            guard frontmost()==before else {throw NativeFailure("FOREGROUND_CHANGED_BY_TARGET_APP")}
            var selectionVerified=false
            for _ in 0..<10 {
                if let selected=ax(target.item,kAXSelectedTextRangeAttribute),CFGetTypeID(selected)==AXValueGetTypeID(){
                    var actual=CFRange()
                    if AXValueGetValue(unsafeBitCast(selected,to:AXValue.self),.cfRange,&actual) && actual.location==0 && actual.length==count {selectionVerified=true;break}
                }
                RunLoop.current.run(until:Date().addingTimeInterval(0.05))
            }
            guard selectionVerified else{throw NativeFailure("AX_SELECTION_NOT_VERIFIED")}
            guard AXUIElementSetAttributeValue(target.item,kAXSelectedTextAttribute as CFString,value as CFTypeRef) == .success else {throw NativeFailure("AX_REPLACE_TEXT_FAILED")}
        } else {
            guard AXUIElementSetAttributeValue(target.item,
                kAXValueAttribute as CFString,value as CFTypeRef) == .success
            else {throw NativeFailure("AX_SET_VALUE_FAILED")}
        }
    } else {
        guard request["allow_press"] as? Bool == true,
            ["AXButton","AXLink","AXCheckBox","AXRadioButton",
             "AXPopUpButton","AXMenuItem","AXRow"].contains(target.role) && target.pressAvailable
        else {throw NativeFailure("AX_PRESS_NOT_CERTIFIED")}
        guard AXUIElementPerformAction(target.item,kAXPressAction as CFString)
           == .success else {throw NativeFailure("AX_PRESS_FAILED")}
    }
    guard frontmost()==before else {
        throw NativeFailure("FOREGROUND_CHANGED_BY_TARGET_APP")
    }
    if before==bundle,let original=originalFocusedWindow,CFGetTypeID(original)==AXUIElementGetTypeID(){
        guard sameAX(ax(root,kAXFocusedWindowAttribute),unsafeBitCast(original,to:AXUIElement.self))
            else{throw NativeFailure("FOCUSED_WINDOW_CHANGED_BY_TARGET_APP")}
    }
    return (["ok":true,"data":["dispatched":true,
        "provider":"same_mac_background_ax","frontmost_unchanged":true,
        "business_effect":"UNVERIFIED_REQUIRE_READBACK"]])
}

func sameAX(_ a:AnyObject?,_ b:AXUIElement)->Bool{
    guard let a=a,CFGetTypeID(a)==AXUIElementGetTypeID() else{return false}
    return CFEqual(a,b)
}
func certifiedProcessText(_ request:[String:Any],field:AXUIElement,root:AXUIElement,
    window:AXUIElement,app:NSRunningApplication,before:String) throws -> [String:Any]{
    guard let value=request["value"] as? String,value.utf16.count<=2000,
          let expected=request["expected_text"] as? [String:Any] else{throw NativeFailure("PROCESS_INPUT_TARGET_INVALID")}
    func matchesValue() -> Bool {
        let raw=text(field,kAXValueAttribute)
        if expected["kind"] as? String == "empty" {return raw.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty}
        guard expected["kind"] as? String == "text_digest",let hash=expected["sha256"] as? String else {return false}
        return sha(raw)==hash
    }
    guard matchesValue(),frontmost()==before else {throw NativeFailure("TEXT_CONTENT_OR_FOREGROUND_CHANGED")}
    guard AXUIElementSetAttributeValue(field,kAXFocusedAttribute as CFString,kCFBooleanTrue) == .success else {throw NativeFailure("ELEMENT_FOCUS_UNSUPPORTED")}
    var focused=false
    for _ in 0..<20 {
        guard frontmost()==before else {throw NativeFailure("FOREGROUND_CHANGED_DURING_FOCUS")}
        if sameAX(ax(root,kAXFocusedUIElementAttribute),field) {focused=true;break}
        RunLoop.current.run(until:Date().addingTimeInterval(0.05))
    }
    guard focused,sameAX(ax(root,kAXFocusedWindowAttribute),window),matchesValue(),frontmost()==before else {throw NativeFailure("PROCESS_INPUT_FOCUS_NOT_VERIFIED")}
    let source:CGEventSource?=nil
    func pair(_ key:CGKeyCode,_ flags:CGEventFlags,_ unicode:[UniChar]?=nil) throws -> [CGEvent] {
        guard let down=CGEvent(keyboardEventSource:source,virtualKey:key,keyDown:true),
              let up=CGEvent(keyboardEventSource:source,virtualKey:key,keyDown:false) else {throw NativeFailure("PROCESS_EVENT_CREATE_FAILED")}
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
    guard value.isEmpty || isEmpty else {throw NativeFailure("PROCESS_REPLACE_EXISTING_TEXT_UNSUPPORTED")}
    var events:[CGEvent]=[]
    if value.isEmpty && !isEmpty {
        let count=(ax(field,kAXNumberOfCharactersAttribute) as? NSNumber)?.intValue ?? previous.utf16.count
        guard count>0 && count<=2000 else {throw NativeFailure("PROCESS_CLEAR_LENGTH_UNSUPPORTED")}
        var range=CFRange(location:0,length:count)
        guard let selection=AXValueCreate(.cfRange,&range),AXUIElementSetAttributeValue(field,kAXSelectedTextRangeAttribute as CFString,selection) == .success else {throw NativeFailure("PROCESS_CLEAR_SELECTION_UNSUPPORTED")}
        var selected=false
        for _ in 0..<20 {
            guard frontmost()==before && matchesValue() else {throw NativeFailure("PROCESS_CLEAR_TARGET_CHANGED")}
            if let v=ax(field,kAXSelectedTextRangeAttribute),CFGetTypeID(v)==AXValueGetTypeID() {
                let selectedValue=unsafeBitCast(v,to:AXValue.self);var actual=CFRange()
                if AXValueGetValue(selectedValue,.cfRange,&actual) && actual.location==0 && actual.length==count {selected=true;break}
            }
            RunLoop.current.run(until:Date().addingTimeInterval(0.05))
        }
        guard selected else {throw NativeFailure("PROCESS_CLEAR_SELECTION_NOT_VERIFIED")}
        events += try pair(51,[])
    }
    else {
        let units=Array(value.utf16);var index=0
        while index<units.count {
            var end=min(index+20,units.count)
            if end<units.count && units[end-1]>=0xD800 && units[end-1]<=0xDBFF {end-=1}
            events += try pair(0,[],Array(units[index..<end]));index=end
        }
    }
    guard sameAX(ax(root,kAXFocusedUIElementAttribute),field),sameAX(ax(root,kAXFocusedWindowAttribute),window),matchesValue(),frontmost()==before else {throw NativeFailure("PROCESS_INPUT_TARGET_CHANGED_BEFORE_DISPATCH")}
    for event in events {event.postToPid(app.processIdentifier)}
    guard frontmost()==before else {throw NativeFailure("FOREGROUND_CHANGED_BY_TARGET_APP")}
    return (["ok":true,"data":["dispatched":true,"frontmost_unchanged":true,"input_backend":"process_unicode","global_event_posts":0,"pointer_events":0,"activation_calls":0,"replacement_scope":"empty_field_or_clear","persistence":"UNVERIFIED_REQUIRE_READBACK"]])
}

struct NativeFailure: Error {let code:String;init(_ code:String){self.code=code}}
struct WindowLease {let bundle:String;let pid:pid_t;let element:AXUIElement;var touched:Date}
var windowLeases:[WindowLease]=[]
func retainedWindows(_ root:AXUIElement,_ bundle:String,_ pid:pid_t)->[AXUIElement]{
    let now=Date()
    windowLeases=windowLeases.filter{now.timeIntervalSince($0.touched)<900 &&
        ($0.bundle != bundle || $0.pid==pid) && text($0.element,kAXRoleAttribute)=="AXWindow"}
    var current=(ax(root,kAXWindowsAttribute) as? [AXUIElement]) ?? []
    current += children(root).filter{text($0,kAXRoleAttribute)=="AXWindow"}
    for key in [kAXMainWindowAttribute,kAXFocusedWindowAttribute]{
        if let value=ax(root,key),CFGetTypeID(value)==AXUIElementGetTypeID(){
            current.append(unsafeBitCast(value,to:AXUIElement.self))
        }
    }
    var unique:[AXUIElement]=[]
    for item in current where !unique.contains(where:{CFEqual($0,item)}){unique.append(item)}
    current=unique
    for item in current {
        if let index=windowLeases.firstIndex(where:{$0.pid==pid && CFEqual($0.element,item)}){
            windowLeases[index].touched=now
        }else if windowLeases.count<100{
            windowLeases.append(WindowLease(bundle:bundle,pid:pid,element:item,touched:now))
        }
    }
    return windowLeases.filter{$0.bundle==bundle && $0.pid==pid}.map{$0.element}
}
func replyFor(_ bytes:Data)->[String:Any]{
    do{return try execute(bytes)}catch let error as NativeFailure{return ["ok":false,"error":error.code]}
    catch{return ["ok":false,"error":"INVALID_REQUEST"]}
}
func encoded(_ reply:[String:Any])->Data{
    guard let bytes=try? JSONSerialization.data(withJSONObject:reply),bytes.count<140000 else{
        return Data("{\"ok\":false,\"error\":\"OUTPUT_LIMIT\"}\n".utf8)
    }
    return bytes+Data([10])
}
let socketPath=FileManager.default.homeDirectoryForCurrentUser.path + "/Library/Application Support/LCH/SameMacBackgroundAX/native.sock"
func address()->sockaddr_un{
    var result=sockaddr_un();result.sun_family=sa_family_t(AF_UNIX)
    let bytes=Array(socketPath.utf8)+[UInt8(0)]
    guard bytes.count<=MemoryLayout.size(ofValue:result.sun_path) else{respond(["ok":false,"error":"SOCKET_PATH_INVALID"],2)}
    withUnsafeMutableBytes(of:&result.sun_path){$0.copyBytes(from:bytes)}
    return result
}
func connection(_ fd:Int32,_ call:(Int32,UnsafePointer<sockaddr>,socklen_t)->Int32)->Int32{
    var target=address()
    return withUnsafePointer(to:&target){pointer in
        pointer.withMemoryRebound(to:sockaddr.self,capacity:1){call(fd,$0,socklen_t(MemoryLayout<sockaddr_un>.size))}
    }
}
func configure(_ fd:Int32){
    var timeout=timeval(tv_sec:12,tv_usec:0)
    setsockopt(fd,SOL_SOCKET,SO_RCVTIMEO,&timeout,socklen_t(MemoryLayout<timeval>.size))
    setsockopt(fd,SOL_SOCKET,SO_SNDTIMEO,&timeout,socklen_t(MemoryLayout<timeval>.size))
}
func receive(_ fd:Int32,_ limit:Int)->Data?{
    var result=Data();var buffer=[UInt8](repeating:0,count:8192)
    while result.count<limit {
        let n=Darwin.read(fd,&buffer,min(buffer.count,limit-result.count))
        if n<=0{return nil}
        result.append(contentsOf:buffer.prefix(n))
        if result.last==10{return result}
    }
    return nil
}
func send(_ fd:Int32,_ bytes:Data)->Bool{
    bytes.withUnsafeBytes{raw in
        guard let base=raw.baseAddress else{return false};var sent=0
        while sent<bytes.count{
            let n=Darwin.write(fd,base.advanced(by:sent),bytes.count-sent)
            if n<=0{return false};sent+=n
        }
        return true
    }
}
func client(){
    var state=stat()
    guard lstat(socketPath,&state)==0,state.st_uid==getuid(),
          (state.st_mode&S_IFMT)==S_IFSOCK,(state.st_mode&0o077)==0
          else{respond(["ok":false,"error":"WORKER_SOCKET_UNTRUSTED"],2)}
    let input=FileHandle.standardInput.readDataToEndOfFile()
    guard input.count<=16384 else{respond(["ok":false,"error":"INVALID_REQUEST"],2)}
    let fd=Darwin.socket(AF_UNIX,SOCK_STREAM,0);guard fd>=0 else{respond(["ok":false,"error":"WORKER_UNAVAILABLE"],2)}
    configure(fd);defer{Darwin.close(fd)}
    guard connection(fd,Darwin.connect)==0,send(fd,input+Data([10])),
          let output=receive(fd,140000) else{respond(["ok":false,"error":"WORKER_UNAVAILABLE"],2)}
    FileHandle.standardOutput.write(output)
}
func residentWorker(){
    let parent=getppid();let fd=Darwin.socket(AF_UNIX,SOCK_STREAM,0)
    guard fd>=0 else{respond(["ok":false,"error":"WORKER_SOCKET_FAILED"],2)}
    var existing=stat()
    if lstat(socketPath,&existing)==0{
        guard existing.st_uid==getuid(),(existing.st_mode&S_IFMT)==S_IFSOCK else{respond(["ok":false,"error":"WORKER_SOCKET_UNTRUSTED"],2)}
        let check=Darwin.socket(AF_UNIX,SOCK_STREAM,0)
        let live=connection(check,Darwin.connect)==0;Darwin.close(check)
        guard !live else{respond(["ok":false,"error":"WORKER_ALREADY_RUNNING"],2)}
        Darwin.unlink(socketPath)
    }
    guard connection(fd,Darwin.bind)==0,chmod(socketPath,0o600)==0,Darwin.listen(fd,8)==0
        else{respond(["ok":false,"error":"WORKER_SOCKET_FAILED"],2)}
    defer{Darwin.close(fd);Darwin.unlink(socketPath)}
    // Keep real AXUIElement references across calls and Space/window reordering.
    // A dead/replaced parent revokes this worker; there is no orphan service.
    while getppid()==parent{
        RunLoop.current.run(until:Date().addingTimeInterval(0.005))
        var pending=pollfd(fd:fd,events:Int16(POLLIN),revents:0)
        if Darwin.poll(&pending,1,1000)<=0{continue}
        let peer=Darwin.accept(fd,nil,nil);if peer<0{continue}
        configure(peer)
        if let input=receive(peer,16385){_ = send(peer,encoded(replyFor(input)))}
        Darwin.close(peer)
    }
}
signal(SIGPIPE,SIG_IGN)
switch Array(CommandLine.arguments.dropFirst()){
case ["--foreground"]:
    let bundle=NSWorkspace.shared.frontmostApplication?.bundleIdentifier ?? "UNKNOWN"
    FileHandle.standardOutput.write(Data(bundle.utf8))
case ["--worker"]:residentWorker()
case ["--client"]:client()
case []:FileHandle.standardOutput.write(encoded(replyFor(FileHandle.standardInput.readDataToEndOfFile())))
default:respond(["ok":false,"error":"INVALID_REQUEST"],2)
}
