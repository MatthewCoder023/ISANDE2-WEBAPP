const path = require('path');
const ApiError = require('../utils/ApiError');

function notFound(req, res, next) {
  if (req.originalUrl.startsWith('/api/')) {
    return next(new ApiError(404, `Route not found: ${req.method} ${req.originalUrl}`));
  }
  res.status(404).sendFile(path.join(__dirname, '..', '..', 'public', '404.html'));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Something went wrong.';
  let errors = err.errors;

  // Malformed MongoDB ObjectId in a route param -> 400, not a server error.
  if (err.name === 'CastError') {
    statusCode = 400;
    message = 'Invalid identifier format.';
  }

  // Mongoose schema validation errors -> 422 with field details.
  if (err.name === 'ValidationError' && err.errors) {
    statusCode = 422;
    message = 'Validation failed.';
    errors = Object.values(err.errors).map((e) => ({ field: e.path, message: e.message }));
  }

  // MongoDB duplicate key -> 409.
  if (err.code === 11000) {
    statusCode = 409;
    const field = Object.keys(err.keyValue || {})[0] || 'value';
    message = `That ${field} is already in use.`;
    errors = undefined;
  }

  // Never leak internals for unexpected errors.
  if (statusCode >= 500) {
    console.error(err);
    if (process.env.NODE_ENV === 'production') {
      message = 'Internal server error.';
    }
  }

  res.status(statusCode).json({
    success: false,
    message,
    ...(errors && { errors }),
  });
}

module.exports = { notFound, errorHandler };
