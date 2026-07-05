/**
 * Operational error with an HTTP status code, safe to expose to clients.
 * Anything that is NOT an ApiError is treated as an unexpected server error.
 */
class ApiError extends Error {
  constructor(statusCode, message, errors = undefined) {
    super(message);
    this.statusCode = statusCode;
    this.errors = errors;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = ApiError;
