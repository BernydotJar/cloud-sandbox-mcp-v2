import crypto from 'node:crypto';

const MAX_IMAGE_DIMENSION=16384;
export const SCREENSHOT_TTL_MS=30000;
const MAX_REFERENCES=64;

// The PNG IHDR is the image's pixel dimensions, independent of macOS point
// bounds. On Retina this is commonly 2x; never assume one scale for both axes.
export function pngDimensions(base64) {
  if (typeof base64!=='string' || base64.length>12_000_000 ||
      !/^[A-Za-z0-9+/=]+$/.test(base64)) throw new Error('SCREENSHOT_GEOMETRY_UNAVAILABLE');
  const raw=Buffer.from(base64,'base64');
  const header=Buffer.from([137,80,78,71,13,10,26,10]);
  if(raw.length<33 || !raw.subarray(0,8).equals(header) ||
     raw.readUInt32BE(8)!==13 || raw.subarray(12,16).toString('ascii')!=='IHDR') {
    throw new Error('SCREENSHOT_GEOMETRY_UNAVAILABLE');
  }
  const width=raw.readUInt32BE(16),height=raw.readUInt32BE(20);
  if(width<1||height<1||width>MAX_IMAGE_DIMENSION||height>MAX_IMAGE_DIMENSION)
    throw new Error('SCREENSHOT_GEOMETRY_UNAVAILABLE');
  return {width,height};
}
function validBounds(b) {
  return b && [b.x,b.y,b.width,b.height].every(Number.isFinite) &&
    Number.isInteger(b.x) && Number.isInteger(b.y) &&
    Number.isInteger(b.width) && Number.isInteger(b.height) &&
    Math.abs(b.x)<=32768 && Math.abs(b.y)<=32768 &&
    b.width>0 && b.height>0 && b.width<=5000 && b.height<=4000;
}
export function geometryFromCapture(bounds,image) {
  if(!validBounds(bounds))throw new Error('INVALID_BOUNDS');
  const pixels=pngDimensions(image.base64);
  const scale={x:pixels.width/bounds.width,y:pixels.height/bounds.height};
  if(!Number.isFinite(scale.x)||!Number.isFinite(scale.y)||
     scale.x<0.5||scale.x>4||scale.y<0.5||scale.y>4)
    throw new Error('SCREENSHOT_SCALE_UNSUPPORTED');
  return {
    coordinate_contract:'mac-screen-points.v1',
    bounds_points:{x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height},
    image_pixels:pixels,
    scale,
    expires_in_ms:SCREENSHOT_TTL_MS
  };
}
export function sameWindowBounds(a,b) {
  if(!validBounds(a)||!validBounds(b))return false;
  return ['x','y','width','height'].every(key=>a[key]===b[key]);
}
export function checkedScreenPoint(x,y,geometry) {
  const b=geometry?.bounds_points;
  if(!validBounds(b) || ![x,y].every(Number.isInteger) ||
     x<b.x || y<b.y || x>=b.x+b.width || y>=b.y+b.height)
    throw new Error('COORDINATES_OUTSIDE_TARGET');
  return {x,y};
}
export function screenshotPixelToScreenPoint(x,y,geometry) {
  const b=geometry?.bounds_points,p=geometry?.image_pixels,s=geometry?.scale;
  if(!validBounds(b)||!p||!s||![x,y].every(Number.isInteger) ||
     x<0||y<0||x>=p.width||y>=p.height ||
     !Number.isFinite(s.x)||!Number.isFinite(s.y)||s.x<=0||s.y<=0)
    throw new Error('INVALID_SCREENSHOT_COORDINATES');
  // Center of selected pixel, not its top-left corner.
  const screenX=Math.floor(b.x+(x+0.5)/s.x);
  const screenY=Math.floor(b.y+(y+0.5)/s.y);
  return checkedScreenPoint(screenX,screenY,geometry);
}
export class ScreenshotReferences {
  #entries=new Map();
  #now;
  constructor(now=()=>Date.now()) { this.#now=now; }
  create(identity,geometry) {
    this.#prune();
    if(this.#entries.size>=MAX_REFERENCES)this.#entries.delete(this.#entries.keys().next().value);
    const ref=crypto.randomBytes(32).toString('hex');
    this.#entries.set(ref,{identity:{...identity},geometry,expires:this.#now()+SCREENSHOT_TTL_MS});
    return ref;
  }
  resolve(ref,identity,currentBounds) {
    if(typeof ref!=='string'||!/^[a-f0-9]{64}$/.test(ref))
      throw new Error('STALE_SCREENSHOT_REF');
    const entry=this.#entries.get(ref);
    if(!entry || this.#now()>entry.expires) {
      this.#entries.delete(ref);
      throw new Error('STALE_SCREENSHOT_REF');
    }
    if(['browser','expected_url','expected_title'].some(k=>entry.identity[k]!==identity[k]))
      throw new Error('SCREENSHOT_TARGET_MISMATCH');
    if(!sameWindowBounds(entry.geometry.bounds_points,currentBounds))
      throw new Error('STALE_SCREENSHOT_GEOMETRY');
    return entry.geometry;
  }
  revokeAll() { this.#entries.clear(); }
  #prune() {
    const now=this.#now();
    for(const [key,e] of this.#entries)if(now>e.expires)this.#entries.delete(key);
  }
}
