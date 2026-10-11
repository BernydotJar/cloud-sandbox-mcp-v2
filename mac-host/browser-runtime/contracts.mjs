import crypto from 'node:crypto';

export class RuntimeFault extends Error {
  constructor(code) { super(code); this.name = 'RuntimeFault'; }
}
export const fail = code => { throw new RuntimeFault(code); };
export const digest = value => crypto.createHash('sha256').update(String(value)).digest('hex');
export const browserName = value => {
  if (!['chrome', 'edge'].includes(value)) fail('INVALID_BROWSER');
  return value;
};
export function webUrl(value) {
  try {
    const u = new URL(value);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) return '';
    return (u.origin + u.pathname).slice(0, 2048);
  } catch { return ''; }
}
export function object(value, allowed, required = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(k => !allowed.includes(k)) || required.some(k => !(k in value))) {
    fail('INVALID_RUNTIME_REQUEST');
  }
}
export function boundedText(value, max = 300, allowEmpty = false) {
  if (typeof value !== 'string' || (!allowEmpty && !value.length) || value.length > max) {
    fail('INVALID_RUNTIME_REQUEST');
  }
  return value;
}
export function targetRequest(input, extra = []) {
  object(input, ['browser', 'tab_ref', ...extra], ['browser', 'tab_ref']);
  browserName(input.browser);
  if (!/^tab_[a-f0-9]{32}$/.test(input.tab_ref)) fail('INVALID_TAB_REFERENCE');
}
export function validateAction(input) {
  targetRequest(input, ['session_id', 'request_id', 'expected_revision', 'action', 'locator', 'value', 'key']);
  if (!/^[a-f0-9]{48}$/.test(input.session_id || '') ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{15,79}$/.test(input.request_id || '') ||
      !Number.isSafeInteger(input.expected_revision) || input.expected_revision < 1) {
    fail('INVALID_RUNTIME_REQUEST');
  }
  if (!['click', 'fill', 'press', 'select'].includes(input.action)) fail('UNSUPPORTED_ACTION');
  const l = input.locator;
  object(l, ['by', 'name', 'role'], ['by', 'name']);
  boundedText(l.name, 200);
  if (!['role', 'label', 'test_id'].includes(l.by)) fail('UNSUPPORTED_LOCATOR');
  if (l.by === 'role' && !['button', 'link', 'textbox', 'combobox', 'checkbox', 'radio', 'tab', 'menuitem', 'switch'].includes(l.role)) fail('UNSUPPORTED_LOCATOR');
  if (l.by !== 'role' && l.role !== undefined) fail('UNSUPPORTED_LOCATOR');
  if (['fill', 'select'].includes(input.action)) boundedText(input.value, 2000, true);
  else if (input.value !== undefined) fail('INVALID_RUNTIME_REQUEST');
  if (input.action === 'press') {
    if (!['Enter', 'Tab', 'Escape', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(input.key)) fail('UNSUPPORTED_KEY');
  } else if (input.key !== undefined) fail('INVALID_RUNTIME_REQUEST');
}
export function sanitizedError(error) {
  // OS, page and Playwright errors routinely contain private URLs and input text.
  return error instanceof RuntimeFault ? error.message : 'BROWSER_OPERATION_FAILED';
}
export function scrubContent(text) {
  // Playwright ARIA snapshots can expose even password input values. Remove
  // textbox/searchbox/spinbutton values and their child subtrees, not just tokens.
  const output = [];
  let skipIndent = null;
  for (const line of String(text).split('\n')) {
    const indent = line.length - line.trimStart().length;
    if (skipIndent !== null && indent > skipIndent) continue;
    skipIndent = null;
    if (/^\s*- (?:textbox|searchbox|spinbutton)\b/.test(line)) {
      let quoted = false, escaped = false, cut = line.length;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (escaped) { escaped = false; continue; }
        if (c === '\\' && quoted) { escaped = true; continue; }
        if (c === '"') quoted = !quoted;
        if (c === ':' && !quoted) { cut = i; break; }
      }
      output.push(line.slice(0, cut) + ': [REDACTED_FIELD_VALUE]');
      skipIndent = indent;
    } else output.push(line);
  }
  // Other page text can still contain PII. Never claim comprehensive redaction.
  return output.join('\n').replace(/(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-proj-[A-Za-z0-9_-]{20,})/g, '[REDACTED_TOKEN]')
    .replace(/https?:\/\/[^\s"<>]+/g, s => webUrl(s) || '[REDACTED_URL]');
}
