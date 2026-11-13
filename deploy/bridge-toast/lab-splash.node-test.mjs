import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {URL} from 'node:url';
const swift=fs.readFileSync(new URL('./bridge-toast.swift',import.meta.url),'utf8');
test('portal is a local nonactivating native overlay with bounded lifetimes',()=>{
 for(const contract of ['import AppKit','.nonactivatingPanel','.accessory','connectionLifetime: TimeInterval = 5.0','delegatedLifetime: TimeInterval = 20.0','panel.ignoresMouseEvents = !(delegated || alerted)'])
  assert(swift.includes(contract),contract);
 assert.doesNotMatch(swift,/NSAlert|URLSession|NSApplication\.shared\.activate|--remote-debugging/);
});
test('green animated portal has reduced-motion support and no old mascot',()=>{
 for(const contract of ['class PortalView','portalVortex','organicRim','portalGlow','accessibilityDisplayShouldReduceMotion','if !reduced'])
  assert(swift.includes(contract),contract);
 assert.doesNotMatch(swift,/class AkiraMascot|class LabBurstView/);
});
test('native glass has an older SDK fallback and clear attributed copy',()=>{
 for(const contract of ['NSGlassEffectView','NSVisualEffectView','MATERIAL=NATIVE_LIQUID_GLASS','MATERIAL=LEGACY_SDK','WILLIAM SHAKESPEARE · LA TEMPESTAD','Estamos hechos de la materia de los sueños','Portal listo. Multiverso intacto.'])
  assert(swift.includes(contract),contract);
 assert(swift.includes('min(200, Int'));
 assert.doesNotMatch(swift,/acciones sin límite/);
});
test('dismissal is not revocation and diagnostics remain an explicit user click',()=>{
 assert(swift.includes('closing never revokes a session'));
 assert(swift.includes('close.setAccessibilityLabel("Cerrar aviso")'));
 assert(swift.includes('NSWorkspace.shared.open(folder)'));
 assert(swift.includes('NSButton(title: "Ver registros"'));
 assert(swift.includes('cacheDisplay(in: glass.bounds'));
});

test('portal sound is original, bounded, quiet and optionally silent',()=>{
 for(const contract of ['private func portalWhoosh()','0.64','NSSound(data: portalWhoosh())','portalSound?.volume = 0.22','arguments.contains("--silent")','SANDBOX_PORTAL_SOUND'])
  assert(swift.includes(contract),contract);
 assert.doesNotMatch(swift,/AVCapture|requestRecordPermission|URLSession/);
});

test('glass follows system appearance and uses adaptive text without an opaque black plate',()=>{
 assert(swift.includes('liquid.style = .regular'));
 assert(swift.includes('liquid.tintColor = nil'));
 assert(swift.includes('phrase.textColor = .labelColor'));
 assert(swift.includes('color: .secondaryLabelColor'));
 assert.doesNotMatch(swift,/let shade = CAGradientLayer|panel.appearance = NSAppearance\(named: .darkAqua\)/);
});
