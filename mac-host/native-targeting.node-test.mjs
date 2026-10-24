import {test} from 'node:test';
import assert from 'node:assert/strict';
import {geometryFromCapture,pngDimensions,checkedScreenPoint,
  screenshotPixelToScreenPoint, ScreenshotReferences,sameWindowBounds} from './native-targeting.mjs';

function fakePNG(width,height) {
  const png=Buffer.alloc(33);
  Buffer.from([137,80,78,71,13,10,26,10]).copy(png,0);
  png.writeUInt32BE(13,8);
  png.write('IHDR',12,'ascii');
  png.writeUInt32BE(width,16);
  png.writeUInt32BE(height,20);
  png[24]=8; png[25]=6;
  return {mime_type:'image/png',base64:png.toString('base64')};
}
const identity={browser:'edge',expected_title:'HCL iTime',expected_url:'https://example.test/week'};
const b={x:100,y:80,width:600,height:400};
const geo=()=>geometryFromCapture(b,fakePNG(1200,800));
test('Retina PNG dimensions are decoded from IHDR, not assumed device scaling',()=>{
  assert.deepEqual(pngDimensions(fakePNG(1200,800).base64),{width:1200,height:800});
  assert.deepEqual(geo().scale,{x:2,y:2});
  assert.deepEqual(screenshotPixelToScreenPoint(200,100,geo()),{x:200,y:130});
});
test('non-Retina scale is 1x',()=>{
  const g=geometryFromCapture(b,fakePNG(600,400));
  assert.deepEqual(g.scale,{x:1,y:1});
  assert.deepEqual(screenshotPixelToScreenPoint(20,30,g),{x:120,y:110});
});
test('different Retina scales are calculated per axis',()=>{
  const g=geometryFromCapture(b,fakePNG(1200,400));
  assert.deepEqual(g.scale,{x:2,y:1});
  assert.deepEqual(screenshotPixelToScreenPoint(300,100,g),{x:250,y:180});
});
test('image coordinates cannot escape the requested screenshot',()=>{
  for(const [x,y] of [[-1,10],[1200,100],[120,800],[20,-1],[1.2,20]]) {
    assert.throws(()=>screenshotPixelToScreenPoint(x,y,geo()),/INVALID_SCREENSHOT_COORDINATES/);
  }
});
test('legacy global points are bounded by the target window, including offset origins',()=>{
  assert.deepEqual(checkedScreenPoint(101,81,{bounds_points:b}),{x:101,y:81});
  for(const [x,y] of [[99,81],[101,79],[700,120],[400,480]])
    assert.throws(()=>checkedScreenPoint(x,y,{bounds_points:b}),/COORDINATES_OUTSIDE_TARGET/);
});
test('multi-monitor negative global coordinates are supported when inside window',()=>{
  const g=geometryFromCapture({x:-900,y:80,width:600,height:400},fakePNG(1200,800));
  assert.deepEqual(screenshotPixelToScreenPoint(200,100,g),{x:-800,y:130});
});
test('rejects malformed or non-PNG evidence',()=>{
  for(const v of ['junk',Buffer.alloc(32).toString('base64'),Buffer.alloc(300).toString('base64')])
    assert.throws(()=>pngDimensions(v),/SCREENSHOT_GEOMETRY_UNAVAILABLE/);
});
test('oversized, zero and unreasonable scales are not accepted',()=>{
  assert.throws(()=>geometryFromCapture(b,fakePNG(16385,800)),/SCREENSHOT_GEOMETRY_UNAVAILABLE/);
  assert.throws(()=>geometryFromCapture(b,fakePNG(200,800)),/SCREENSHOT_SCALE_UNSUPPORTED/);
  assert.throws(()=>geometryFromCapture({x:1,y:1,width:0,height:500},fakePNG(200,800)),/INVALID_BOUNDS/);
});
test('bounds identity rejects move and resize',()=>{
  assert.equal(sameWindowBounds(b,{...b}),true);
  assert.equal(sameWindowBounds(b,{...b,y:81}),false);
  assert.equal(sameWindowBounds(b,{...b,width:601}),false);
});
test('ref resolves only for same title, URL and browser with unchanged bounds',()=>{
  let now=10000;
  const refs=new ScreenshotReferences(()=>now);
  const ref=refs.create(identity,geo());
  assert.match(ref,/^[a-f0-9]{64}$/);
  assert.deepEqual(refs.resolve(ref,identity,b).scale,{x:2,y:2});
  for(const variant of [
    {...identity,browser:'chrome'},
    {...identity,expected_title:'Other HCL'},
    {...identity,expected_url:'https://example.test/another'}
  ])assert.throws(()=>refs.resolve(ref,variant,b),/SCREENSHOT_TARGET_MISMATCH/);
  assert.throws(()=>refs.resolve(ref,identity,{...b,y:b.y+1}),/STALE_SCREENSHOT_GEOMETRY/);
  now+=30001;
  assert.throws(()=>refs.resolve(ref,identity,b),/STALE_SCREENSHOT_REF/);
});
test('ref expiry and explicit session revocation fail closed',()=>{
  const refs=new ScreenshotReferences();
  const ref=refs.create(identity,geo());
  refs.revokeAll();
  assert.throws(()=>refs.resolve(ref,identity,b),/STALE_SCREENSHOT_REF/);
  assert.throws(()=>refs.resolve('hello',identity,b),/STALE_SCREENSHOT_REF/);
});
