import { api } from '/js/api.js';

let userPromise = null;

/**
 * Memoized current-user lookup: every module on a page shares one
 * /api/auth/me request. ES modules are singletons per page load.
 */
export function getCurrentUser() {
  if (!userPromise) {
    userPromise = api('/api/auth/me').then((response) => response.data.user);
  }
  return userPromise;
}
