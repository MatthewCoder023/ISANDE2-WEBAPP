const { validationResult } = require('express-validator');

/**
 * Runs after express-validator chains: converts any collected
 * validation errors into a consistent 422 response.
 */
function validate(req, res, next) {
  const result = validationResult(req);
  if (result.isEmpty()) return next();

  res.status(422).json({
    success: false,
    message: 'Validation failed.',
    errors: result.array({ onlyFirstError: true }).map((e) => ({
      field: e.path,
      message: e.msg,
    })),
  });
}

module.exports = validate;
