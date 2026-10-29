import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const s=fs.readFileSync(new URL('./BackgroundProcessText.swift',import.meta.url),'utf8');
test('process input has exact PID, window, field and content guards before dispatch',()=>{
 for(const guard of ['expected_text','TEXT_CONTENT_OR_FOREGROUND_CHANGED','PROCESS_INPUT_FOCUS_NOT_VERIFIED','PROCESS_INPUT_TARGET_CHANGED_BEFORE_DISPATCH','event.postToPid(app.processIdentifier)','matchesValue()','CFEqual(a,b)','AXIsProcessTrusted()','CGPreflightPostEventAccess()'])assert(s.includes(guard),guard);
 for(const forbidden of ['CGEventPost(','post(tap:','.activate(','NSPasteboard','virtualKey:36','virtualKey: 36'])assert(!s.includes(forbidden),forbidden);
});
test('clear requires verified full text selection, rather than a flood of key events',()=>{
 for(const guard of ['PROCESS_CLEAR_SELECTION_NOT_VERIFIED','actual.location==0 && actual.length==count','PROCESS_REPLACE_EXISTING_TEXT_UNSUPPORTED'])assert(s.includes(guard),guard);
 assert(!s.includes('for _ in 0..<previous.count'));assert(!s.includes('.maskCommand'));
});
