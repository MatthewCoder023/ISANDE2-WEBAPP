const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const { DASHBOARD_PATHS, ROLES } = require('../constants/roles');

/**
 * Resolves the session to a live user document on every request.
 * Reading from the DB (rather than trusting data cached in the session)
 * means role changes and account deactivation take effect immediately.
 */
async function loadSessionUser(req) {
  if (!req.session || !req.session.userId) return null;
  const user = await User.findById(req.session.userId);
  if (!user || !user.isActive) return null;
  return user;
}

/** API guard: rejects unauthenticated requests with 401 JSON. */
function requireAuth(req, res, next) {
  loadSessionUser(req)
    .then((user) => {
      if (!user) return next(new ApiError(401, 'Authentication required. Please log in.'));
      req.user = user;
      next();
    })
    .catch(next);
}

/**
 * API guard: allows only the given roles. Must run after requireAuth.
 * Usage: router.get('/users', requireAuth, requireRole(ROLES.ADMIN), handler)
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(new ApiError(401, 'Authentication required. Please log in.'));
    if (!roles.includes(req.user.role)) {
      return next(new ApiError(403, 'You do not have permission to access this resource.'));
    }
    next();
  };
}

/**
 * Page guard: protects server-rendered HTML pages.
 * - Not logged in           -> redirect to the appropriate login page
 * - Logged in, wrong role   -> redirect to the user's own dashboard
 * - Called with no roles    -> any authenticated user passes
 */
function requirePageAuth(...roles) {
  return (req, res, next) => {
    loadSessionUser(req)
      .then((user) => {
        if (!user) {
          const loginPath = roles.includes(ROLES.CLIENT) ? '/login' : '/employee-login';
          return res.redirect(loginPath);
        }
        if (roles.length > 0 && !roles.includes(user.role)) {
          return res.redirect(DASHBOARD_PATHS[user.role]);
        }
        req.user = user;
        next();
      })
      .catch(next);
  };
}

module.exports = { requireAuth, requireRole, requirePageAuth };
