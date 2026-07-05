/**
 * Thin fetch wrapper for the JSON API.
 * Throws an Error with .status and .errors on any non-2xx response,
 * so page scripts handle failures in a single catch block.
 */
export async function api(path, { method = 'GET', body } = {}) {
  const options = { method, headers: {} };

  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  const response = await fetch(path, options);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(payload.message || 'Something went wrong. Please try again.');
    error.status = response.status;
    error.errors = payload.errors;
    throw error;
  }

  return payload;
}
