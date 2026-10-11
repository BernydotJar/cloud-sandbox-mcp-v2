import crypto from 'node:crypto';

const scopes = new Set(['chrome','edge','both']);
export const MAX_SESSION_MINUTES = 30;
export const MAX_SESSION_ACTIONS = 200;

function validRange(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

/**
 * A single memory-only, expiring Computer Use delegation.
 * This is a capability grant: only the caller holding its random session_id
 * can use it. Restarting the Mac bridge revokes the capability.
 */
export function createSessionStore({now = () => Date.now(), randomId = () => crypto.randomBytes(24).toString('hex')} = {}) {
  let active = null;
  function current() {
    if (active && (now() >= active.expires_at_ms || active.remaining_actions <= 0)) active = null;
    return active;
  }
  function publicStatus() {
    const s=current();
    return s ? {
      active:true,
      scope:s.scope,
      expires_at:new Date(s.expires_at_ms).toISOString(),
      remaining_actions:s.remaining_actions
    } : {active:false};
  }
  function begin({scope, duration_minutes = 20, max_actions = 120, purpose}) {
    if (current()) throw new Error('SESSION_ALREADY_ACTIVE');
    if (!scopes.has(scope) || !validRange(duration_minutes,1,MAX_SESSION_MINUTES) ||
        !validRange(max_actions,1,MAX_SESSION_ACTIONS) ||
        typeof purpose!=='string' || purpose.length < 10 || purpose.length > 300) {
      throw new Error('INVALID_SESSION_REQUEST');
    }
    const id=randomId();
    if (typeof id !== 'string' || !/^[a-f0-9]{32,128}$/.test(id)) throw new Error('INVALID_SESSION_ID');
    active={
      id,scope,remaining_actions:max_actions,
      expires_at_ms:now()+duration_minutes*60_000,
      purpose
    };
    return {
      session_id:id,
      scope,
      expires_at:new Date(active.expires_at_ms).toISOString(),
      remaining_actions:active.remaining_actions
    };
  }
  function authorize(sessionId,browser,{consume=false}={}) {
    if (typeof sessionId !== 'string' || !/^[a-f0-9]{32,128}$/.test(sessionId)) {
      throw new Error('SESSION_NOT_ACTIVE');
    }
    const s=current();
    if (!s) throw new Error('SESSION_NOT_ACTIVE');
    const candidate=Buffer.from(sessionId,'utf8');
    const expected=Buffer.from(s.id,'utf8');
    if (candidate.length!==expected.length || !crypto.timingSafeEqual(candidate,expected)) {
      throw new Error('SESSION_NOT_ACTIVE');
    }
    if (s.scope!=='both' && s.scope!==browser) throw new Error('SESSION_SCOPE_MISMATCH');
    if(consume) s.remaining_actions--;
    return {
      scope:s.scope,
      remaining_actions:s.remaining_actions,
      expires_at:new Date(s.expires_at_ms).toISOString()
    };
  }
  function end(sessionId) {
    if (!active) return {revoked:false};
    // No token means the authenticated local owner is revoking all sessions.
    if (sessionId !== undefined && active.id!==sessionId) throw new Error('SESSION_NOT_ACTIVE');
    active=null;
    return {revoked:true};
  }
  return {begin,authorize,end,status:publicStatus};
}
