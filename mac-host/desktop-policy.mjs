import crypto from 'node:crypto';

const bundlePattern = /^[A-Za-z0-9][A-Za-z0-9-]*(?:\.[A-Za-z0-9][A-Za-z0-9-]*)+$/;
const sessionPattern = /^[a-f0-9]{48}$/;
const requestPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{15,79}$/;
const elementPathPattern = /^0(?:\.(?:0|[1-9]\d?)){1,5}$/;
const keys = new Set(['tab','escape','enter','space','backspace','up','down','left','right','pageup','pagedown']);
const actions = new Set(['click','type_text','press_key','scroll']);
const limited = (x, max) => typeof x === 'string' && x.length > 0 && x.length <= max &&
  !Array.from(x).some(ch => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127);

export function parseAllowedBundles(value) {
  if (typeof value !== 'string' || !value.trim()) return new Set();
  const list = value.split(',').map(v => v.trim());
  if (list.length > 40 || list.some(v => !bundlePattern.test(v)) || new Set(list).size !== list.length)
    throw new Error('INVALID_MAC_ALLOWLIST');
  return new Set(list);
}

export function validateDesktopConfig({enabled, allowedBundles}) {
  if (typeof enabled !== 'boolean' || !(allowedBundles instanceof Set)) throw new Error('INVALID_MAC_CONFIG');
  if (enabled && (allowedBundles.size === 0 || allowedBundles.size > 40 ||
    [...allowedBundles].some(v => !bundlePattern.test(v)))) throw new Error('INVALID_MAC_ALLOWLIST');
}

export function requireAllowedBundle(bundleId, allowedBundles) {
  if (!bundlePattern.test(String(bundleId || '')) || !allowedBundles.has(bundleId))
    throw new Error('MAC_APP_NOT_ALLOWED');
  return bundleId;
}

export function validateDesktopTarget(input, allowedBundles) {
  requireAllowedBundle(input?.bundle_id, allowedBundles);
  if (!Number.isSafeInteger(input.pid) || input.pid < 1 ||
      !Number.isSafeInteger(input.window_index) || input.window_index < 1 ||
      input.window_index > 128 || !limited(input.expected_title, 300))
    throw new Error('INVALID_MAC_TARGET');
  return [input.bundle_id, String(input.pid), String(input.window_index), input.expected_title];
}

export function requireDesktopSession(input) {
  if (!input || !sessionPattern.test(String(input.session_id || ''))) throw new Error('SESSION_NOT_ACTIVE');
  return input.session_id;
}

export function validateMutation(input, allowedBundles) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      !requestPattern.test(String(input.request_id || '')) ||
      !limited(input.reason, 300) || input.reason.length < 10) throw new Error('INVALID_MAC_ACTION');
  requireDesktopSession(input);
  requireAllowedBundle(input.bundle_id, allowedBundles);
  if (input.action === undefined) {
    if (input.pid !== undefined || input.window_index !== undefined || input.expected_title !== undefined)
      validateDesktopTarget(input, allowedBundles);
    return [];
  }
  if (!actions.has(input.action)) throw new Error('INVALID_MAC_ACTION');
  const target = validateDesktopTarget(input, allowedBundles);
  if (input.action === 'click' || input.action === 'type_text') {
    if (!elementPathPattern.test(String(input.element_path || '')) ||
        !limited(input.expected_role, 100) || !limited(input.expected_name, 200))
      throw new Error('INVALID_MAC_ELEMENT');
    if (input.action === 'type_text' && !limited(input.text, 2000))
      throw new Error('INVALID_MAC_TEXT');
    return [...target, input.action, input.element_path, input.expected_role, input.expected_name,
      input.action === 'type_text' ? input.text : ''];
  }
  if (input.action === 'press_key') {
    if (!keys.has(input.key)) throw new Error('INVALID_MAC_KEY');
    return [...target, input.action, '', '', '', input.key];
  }
  if (!['up','down'].includes(input.direction) ||
      !Number.isInteger(input.steps) || input.steps < 1 || input.steps > 8)
    throw new Error('INVALID_MAC_SCROLL');
  return [...target, input.action, '', '', '', input.direction, String(input.steps)];
}

// Replay suppression is deliberately conservative: a repeated ID never replays an
// OS event. The client must inspect actual state after an uncertain outcome.
export function createDesktopRequestGate({maxEntries = 500} = {}) {
  const used = new Set();
  return {
    claim(id) {
      if (!requestPattern.test(String(id || ''))) throw new Error('INVALID_MAC_ACTION');
      if (used.has(id)) throw new Error('MAC_REQUEST_ALREADY_DISPATCHED');
      if (used.size >= maxEntries) throw new Error('MAC_REQUEST_GATE_FULL');
      used.add(id);
    },
    size() { return used.size; }
  };
}

// Content-free audit metadata: never include input text, UI labels or window titles.
export function desktopAudit(input, outcome) {
  return {category:'mac_desktop', action:input.action || 'open_or_focus',
    bundle_hash:crypto.createHash('sha256').update(input.bundle_id).digest('hex').slice(0,16),
    request_id:input.request_id, outcome};
}
