import Foundation
import AppKit
import ApplicationServices
import CryptoKit

// Dedicated macOS process, launched ONLY by the authorized Mac Bridge.
// Input is JSON over stdin; no passwords, URLs or text values in argv/logs.
// Rejects all non-frontmost applications, windows, duplicate/missing AXWebArea
// targets, stale trees, secure fields and unsupported actions.

func abort(_ code: String) -> Never {
    let result = ["ok": false, "error": code] as [String : Any]
    let data = (try? JSONSerialization.data(withJSONObject: result)) ?? Data()
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([10]))
    exit(2)
}

func encode(_ body: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: body),
          data.count < 130_000 else { abort("AX_OUTPUT_LIMIT") }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([10]))
}

func digest(_ text: String) -> String {
    SHA256.hash(data: Data(text.utf8)).map { String(format:"%02x", $0) }.joined()
}
func attr(_ element: AXUIElement, _ name: String) -> AnyObject? {
    var result: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, name as CFString, &result) == .success else { return nil }
    return result
}
func str(_ element: AXUIElement, _ name: String) -> String {
    guard let raw=attr(element,name) else { return "" }
    if let s=raw as? String { return s }
    if let u=raw as? URL { return u.absoluteString }
    return ""
}
func children(_ element: AXUIElement) -> [AXUIElement] {
    (attr(element, kAXChildrenAttribute) as? [AXUIElement]) ?? []
}
func enabled(_ element: AXUIElement) -> Bool {
    (attr(element, kAXEnabledAttribute) as? NSNumber)?.boolValue ?? false
}
func point(_ element: AXUIElement) -> CGPoint? {
    guard let raw=attr(element,kAXPositionAttribute) else { return nil }
    guard CFGetTypeID(raw)==AXValueGetTypeID() else { return nil }
    let value=raw as! AXValue
    guard AXValueGetType(value) == .cgPoint else { return nil }
    var result=CGPoint.zero
    return AXValueGetValue(value,.cgPoint,&result) ? result : nil
}
func size(_ element: AXUIElement) -> CGSize? {
    guard let raw=attr(element,kAXSizeAttribute) else { return nil }
    guard CFGetTypeID(raw)==AXValueGetTypeID() else { return nil }
    let value=raw as! AXValue
    guard AXValueGetType(value) == .cgSize else { return nil }
    var result=CGSize.zero
    return AXValueGetValue(value,.cgSize,&result) ? result : nil
}
func frame(_ element: AXUIElement) -> CGRect? {
    guard let p=point(element),let s=size(element),
          p.x.isFinite,p.y.isFinite,s.width.isFinite,s.height.isFinite,
          s.width>=0,s.height>=0 else { return nil }
    return CGRect(origin:p,size:s)
}
func windowRect(_ request: [String:Any]) -> CGRect {
    guard let bounds=request["bounds_points"] as? [String:Double],
          let x=bounds["x"],let y=bounds["y"],
          let w=bounds["width"],let h=bounds["height"],
          [x,y,w,h].allSatisfy({$0.isFinite}),w>0,h>0,w<=5000,h<=4000
    else { abort("AX_INVALID_WINDOW_BOUNDS") }
    return CGRect(x:x,y:y,width:w,height:h)
}
func sameFrame(_ a:CGRect,_ b:CGRect, tolerance:CGFloat=2) -> Bool {
    abs(a.minX-b.minX)<=tolerance && abs(a.minY-b.minY)<=tolerance &&
    abs(a.width-b.width)<=tolerance && abs(a.height-b.height)<=tolerance
}
func sanitizeURL(_ raw:String) -> String {
    guard var parts=URLComponents(string:raw),let scheme=parts.scheme,
          ["http","https"].contains(scheme.lowercased()),
          parts.host != nil, parts.user==nil,parts.password==nil
    else { return "" }
    parts.scheme=scheme.lowercased()
    parts.host=parts.host?.lowercased()
    parts.query=nil
    parts.fragment=nil
    if parts.path.isEmpty {parts.path="/"}
    return parts.string ?? ""
}
func isProtected(_ element: AXUIElement) -> Bool {
    let subrole=str(element,kAXSubroleAttribute).lowercased()
    if subrole.contains("secure") || subrole.contains("password") {return true}
    let title = [
        str(element, kAXTitleAttribute),
        str(element, kAXDescriptionAttribute),
        str(element, "AXPlaceholderValue")
    ].joined(separator: " ").lowercased()
    if ["password","passcode","verification code","security code","credit card","cvv","otp"].contains(where:{title.contains($0)}) {return true}
    if (attr(element,"AXProtectedContent") as? NSNumber)?.boolValue == true {return true}
    return false
}
func label(_ element:AXUIElement) -> String {
    let v=[str(element,kAXTitleAttribute),str(element,kAXDescriptionAttribute),
           str(element,"AXPlaceholderValue")].first(where:{$0.count>0}) ?? ""
    // Avoid returning text contents, long internal state, tokens or URLs.
    if v.contains("://") || v.count>120 || v.contains("@") {return ""}
    return v
}
func rectRecord(_ rect:CGRect?) -> [String:Double]? {
    guard let f=rect else {return nil}
    return ["x":Double(f.minX),"y":Double(f.minY),
            "width":Double(f.width),"height":Double(f.height)]
}
// Task-safe AXValue readback. The current active-desktop helper remains
// foreground-only; reading a value does NOT authorize an OS event.
// Return only small hour quantities on time-related fields, checkbox states,
// and emptiness. Do not expose arbitrary text, emails, secrets or passwords.
func observeValue(_ element: AXUIElement, role: String,
                  name: String, secure: Bool) -> [String: Any]? {
    guard !secure,
          ["AXTextField","AXTextArea","AXComboBox",
           "AXPopUpButton","AXCheckBox","AXRadioButton"].contains(role),
          let raw=attr(element,kAXValueAttribute)
    else { return nil }
    if ["AXCheckBox","AXRadioButton"].contains(role),
       let number=raw as? NSNumber {
        return ["kind":"boolean","value":number.boolValue]
    }
    guard let string=raw as? String else {
        return ["kind":"redacted","has_value":true]
    }
    let value=string.trimmingCharacters(in:.whitespacesAndNewlines)
    if value.isEmpty { return ["kind":"empty","has_value":false] }
    if value.count>1000 { return ["kind":"redacted","has_value":true] }
    let businessLabel=name.lowercased()
    let timeHints=["hour","time","duration","hours","lunes","martes",
      "miércoles","jueves","viernes","sábado","domingo","monday","tuesday",
      "wednesday","thursday","friday","saturday","sunday","mon ","tue ",
      "wed ","thu ","fri ","sat ","sun "]
    let timeField=timeHints.contains(where:{businessLabel.contains($0)})
    let numeric=value.range(of:"^[0-9]{1,3}(\\.[0-9]{1,2})?$",
        options:.regularExpression) != nil
    if timeField && numeric && value.count<=6,
       let number=Double(value), number<=168 {
        return ["kind":"hours_numeric","value":value,"has_value":true]
    }
    return ["kind":"redacted","has_value":true]
}
struct Record {
    let path:[Int], role:String, name:String, active:Bool,
        protected:Bool, rect:CGRect?, valueObservation:[String:Any]?
    var fingerprint:String {
        let f=rectRecord(rect) ?? [:]
        let coords=["x","y","width","height"].map{String(format:"%.1f",f[$0] ?? -1)}.joined(separator:",")
        let observed = valueObservation?["value"].map{String(describing:$0)} ?? ""
        let kind = valueObservation?["kind"] as? String ?? ""
        return digest("\(path.map(String.init).joined(separator:"."))|\(role)|\(name)|\(active)|\(protected)|\(coords)|\(kind)|\(observed)")
    }
    var json:[String:Any] {
        var result:[String:Any]=["path":path,"role":role,"name":name,
            "enabled":active,"fingerprint":fingerprint]
        if let bounds=rectRecord(rect){result["frame_points"]=bounds}
        if let observed=valueObservation {result["value_observation"]=observed}
        return result
    }
}
func inventory(_ root:AXUIElement,within:CGRect) -> [Record] {
    var pending:[(AXUIElement,[Int])]=[(root,[])]
    var records:[Record]=[]
    var cursor=0
    while cursor < pending.count && records.count < 450 {
        let (node,path)=pending[cursor]
        cursor+=1
        let role=str(node,kAXRoleAttribute)
        let secure=isProtected(node)
        let f=frame(node)
        let name=secure ? "" : label(node)
        let value = observeValue(node,role:role,name:name,secure:secure)
        records.append(Record(path:path,role:role,name:name,
                              active:!secure && enabled(node),
                              protected:secure,rect:f,valueObservation:value))
        if path.count>=12 {continue}
        let kids=children(node)
        for (index,child) in kids.prefix(200).enumerated() {
            if pending.count>=1800 {break}
            // No AX sibling outside this subtree can be selected.
            pending.append((child,path+[index]))
        }
    }
    return records
}
func targetNode(_ root: AXUIElement, path:[Int]) -> AXUIElement? {
    if path.count>12 || path.contains(where:{$0<0||$0>=200}) {return nil}
    var node=root
    for index in path {
        let next=children(node)
        guard next.count>index else {return nil}
        node=next[index]
    }
    return node
}
func snapshotRevision(_ rows:[Record]) -> String {
    digest(rows.map{$0.fingerprint}.joined(separator:";"))
}

func entry() {
    if !AXIsProcessTrusted() {abort("AX_PERMISSION_DENIED")}
    let raw=FileHandle.standardInput.readDataToEndOfFile()
    guard raw.count<16_384,
          let request=(try? JSONSerialization.jsonObject(with:raw)) as? [String:Any],
          let mode=request["mode"] as? String,
          let browser=request["browser"] as? String,
          let expected=request["expected_url"] as? String,
          expected==sanitizeURL(expected),
          let bundle=["chrome":"com.google.Chrome","edge":"com.microsoft.edgemac"][browser],
          let app=NSWorkspace.shared.frontmostApplication,
          app.bundleIdentifier==bundle else {abort("AX_INVALID_TARGET")}

    let root=AXUIElementCreateApplication(app.processIdentifier)
    guard let focused=attr(root,kAXFocusedWindowAttribute) else {abort("AX_NO_FOCUSED_WINDOW")}
    guard CFGetTypeID(focused)==AXUIElementGetTypeID() else {abort("AX_NO_FOCUSED_WINDOW")}
    let window=focused as! AXUIElement
    guard let w=frame(window),sameFrame(w,windowRect(request)) else {abort("AX_WINDOW_CHANGED")}

    // Locate a single URL-bound web content subtree; browser toolbar and
    // unrelated windows must never become selectable nodes.
    var candidates:[AXUIElement]=[]
    var stack:[(AXUIElement,Int)]=[(window,0)]
    var scanned=0
    while let (node,depth)=stack.popLast(), scanned<1600 {
        scanned+=1
        if str(node,kAXRoleAttribute)=="AXWebArea" {
            let url=[str(node,"AXURL"),str(node,"AXDocument")].first(where:{!$0.isEmpty}) ?? ""
            if sanitizeURL(url)==expected {candidates.append(node)}
        }
        if depth<10 {
            for child in children(node).prefix(200).reversed() {stack.append((child,depth+1))}
        }
    }
    guard candidates.count==1 else {abort(candidates.isEmpty ?
        "AX_WEB_AREA_UNAVAILABLE":"AX_WEB_AREA_AMBIGUOUS")}
    let area=candidates[0]
    let areaFrame=frame(area) ?? w
    guard w.intersects(areaFrame) else {abort("AX_WEB_AREA_OUTSIDE_WINDOW")}
    let nodes=inventory(area,within:w)
    let revision=snapshotRevision(nodes)

    if mode=="snapshot" {
        // Expose only guarded numeric hours/boolean/emptiness observations;
        // no arbitrary AXValue text, URLs or secure controls.
        encode(["ok":true,"data":["provider":"native_ax","revision":revision,
            "nodes":nodes.filter{!$0.protected}.map{$0.json}]]);return
    }
    guard mode=="action",
          let requestRevision=request["expected_revision"] as? String,
          requestRevision==revision,
          let path=request["path"] as? [Int],path.count<=12,
          let fingerprint=request["fingerprint"] as? String,
          let action=request["action"] as? String,
          let element=targetNode(area,path: path),
          let node=nodes.first(where:{$0.path==path}),
          node.fingerprint==fingerprint,
          !node.protected,node.active,
          let f=node.rect,f.width>0,f.height>0,
          w.intersects(f),areaFrame.intersects(f) else {abort("AX_NODE_STALE_OR_UNSAFE")}

    if action=="press" {
        guard ["AXButton","AXLink","AXCheckBox","AXRadioButton",
               "AXPopUpButton","AXMenuItem"].contains(node.role)
        else {abort("AX_ACTION_NOT_SUPPORTED")}
        guard AXUIElementPerformAction(element,kAXPressAction as CFString) == .success
        else {abort("AX_ACTION_FAILED")}
    } else if action=="set_value" {
        guard ["AXTextField","AXTextArea","AXComboBox"].contains(node.role),
              let value=request["value"] as? String,
              !value.isEmpty,value.count<=2000 else {abort("AX_INPUT_NOT_SUPPORTED")}
        guard AXUIElementSetAttributeValue(element,kAXValueAttribute as CFString,value as CFTypeRef) == .success
        else {abort("AX_ACTION_FAILED")}
    } else {abort("AX_ACTION_NOT_SUPPORTED")}
    encode(["ok":true,"data":["performed":true,"provider":"native_ax","action":action]])
}
entry()
