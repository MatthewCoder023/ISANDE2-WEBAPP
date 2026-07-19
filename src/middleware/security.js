/**
 * Cross-cutting request hardening. Both middlewares are defense-in-depth:
 * the primary protections (sameSite cookies, express-validator rules) exist
 * elsewhere — these make the guarantees structural instead of per-handler.
 */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF backstop. Browsers attach an Origin header to cross-site
 * state-changing requests; if it is present and does not match the host
 * we are serving, reject. Same-origin requests match, and non-browser
 * clients (curl, tests) send no Origin at all and pass through — the
 * session cookie's sameSite=lax does the heavy lifting for those.
 */
function originCheck(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  const origin = req.get('origin');
  if (!origin) return next();

  let originHost = null;
  try {
    originHost = new URL(origin).host;
  } catch {
    // Malformed or opaque ("null") origin — treat as foreign.
  }

  if (originHost !== req.get('host')) {
    return res.status(403).json({ success: false, message: 'Cross-origin request blocked.' });
  }
  next();
}

/**
 * NoSQL-injection backstop: no $-prefixed or dotted key from the outside
 * world may reach a Mongo query. Legitimate input never uses such keys.
 * A param that collapses to an empty object (?q[$gt]=x) is removed
 * entirely so handlers see it as simply absent.
 */
function stripUnsafeKeys(value) {
  if (!value || typeof value !== 'object') return;
  for (const key of Object.keys(value)) {
    if (key.startsWith('$') || key.includes('.')) {
      delete value[key];
    } else {
      const child = value[key];
      stripUnsafeKeys(child);
      if (
        child &&
        typeof child === 'object' &&
        !Array.isArray(child) &&
        Object.keys(child).length === 0
      ) {
        delete value[key];
      }
    }
  }
}

function sanitizeInput(req, res, next) {
  stripUnsafeKeys(req.body);
  stripUnsafeKeys(req.query);
  next();
}

module.exports = { originCheck, sanitizeInput };
