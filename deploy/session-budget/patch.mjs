/** Surgical compatibility patch. Never overwrites unrelated Mac Bridge edits. */
const storeEdits=[
 ['(!active.unlimited_actions && active.remaining_actions <= 0)','active.remaining_actions <= 0'],
 ["typeof unlimited_actions !== 'boolean' ||","unlimited_actions !== false ||"],
 ['id,scope,remaining_actions:unlimited_actions?null:max_actions,unlimited_actions,',
  'id,scope,remaining_actions:max_actions,unlimited_actions:false,'],
 ['if(consume && !s.unlimited_actions) s.remaining_actions--;','if(consume) s.remaining_actions--;']
];
const bridgeEdits=[
 ["max_minutes:30,max_actions:null,unlimited_actions:true,scope:'single_browser'",
  "max_minutes:30,max_actions:200,unlimited_actions:false,scope:'single_browser'"],
 ['duration_minutes:input.duration_minutes,unlimited_actions:true});',
  'duration_minutes:input.duration_minutes,max_actions:input.max_actions,unlimited_actions:false});'],
 ['const session=sessionStore.begin(trusted\n            ? {...input,unlimited_actions:true}\n            : input);',
  'const session=sessionStore.begin(input);'],
 ['max_actions:trusted?null:input.max_actions,\n            unlimited_actions:trusted',
  'max_actions:input.max_actions,\n            unlimited_actions:false'],
 ['scope:input.scope,duration_minutes:input.duration_minutes,\n              max_actions:null})).catch(()=>{});',
  'scope:input.scope,duration_minutes:input.duration_minutes,\n              max_actions:input.max_actions})).catch(()=>{});']
];
function once(source,find){
 const parts=source.split(find);
 return parts.length===2;
}
export function applyBudgetEdits(source,kind){
 if(typeof source!=='string')throw Error('INVALID_SOURCE');
 const edits=kind==='store'?storeEdits:kind==='bridge'?bridgeEdits:null;
 if(!edits)throw Error('UNKNOWN_BUDGET_COMPONENT');
 let patched=source,editsApplied=0;
 for(const [before,after] of edits){
   if(once(patched,before)){patched=patched.replace(before,after);editsApplied++;continue;}
   if(once(patched,after))continue; // idempotent release
   throw Error('UNKNOWN_MAC_BRIDGE_BASELINE');
 }
 return {source:patched,editsApplied};
}
