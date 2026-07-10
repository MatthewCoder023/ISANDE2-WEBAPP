const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { ROLES, DASHBOARD_PATHS } = require('../constants/roles');

/**
 * Regenerating the session ID on login prevents session fixation:
 * an attacker who planted a session ID before login cannot reuse it after.
 */
function establishSession(req, userId) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = userId;
      req.session.save((saveErr) => (saveErr ? reject(saveErr) : resolve()));
    });
  });
}

/** POST /api/auth/register — public self-registration, always creates a CLIENT. */
const register = asyncHandler(async (req, res) => {
  const { firstName, lastName, email, phone, password } = req.body;

  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) {
    throw new ApiError(409, 'An account with this email already exists.');
  }

  // Role is fixed server-side: self-registration can never create staff accounts.
  const user = await User.create({
    firstName,
    lastName,
    email,
    phone,
    password,
    role: ROLES.CLIENT,
  });

  await establishSession(req, user.id);

  res.status(201).json({
    success: true,
    message: 'Account created successfully.',
    data: { user: user.toJSON(), redirectTo: DASHBOARD_PATHS[user.role] },
  });
});

/** POST /api/auth/login — shared by the customer and employee portals. */
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email: email.toLowerCase() }).select('+password');

  // Same message for "no such user" and "wrong password" to avoid account enumeration.
  if (!user || !(await user.comparePassword(password))) {
    throw new ApiError(401, 'Invalid email or password.');
  }

  if (!user.isActive) {
    throw new ApiError(403, 'This account has been deactivated. Please contact the administrator.');
  }

  await establishSession(req, user.id);

  res.json({
    success: true,
    message: 'Logged in successfully.',
    data: { user: user.toJSON(), redirectTo: DASHBOARD_PATHS[user.role] },
  });
});

/** POST /api/auth/logout */
const logout = asyncHandler(async (req, res) => {
  await new Promise((resolve, reject) => {
    req.session.destroy((err) => (err ? reject(err) : resolve()));
  });
  res.clearCookie('fc.sid');
  res.json({ success: true, message: 'Logged out successfully.' });
});

/** GET /api/auth/me — current session's user (requires auth). */
const me = asyncHandler(async (req, res) => {
  res.json({ success: true, data: { user: req.user.toJSON() } });
});

/** PATCH /api/auth/profile — self-service details (email is immutable). */
const updateProfile = asyncHandler(async (req, res) => {
  const user = req.user; // fresh document loaded by requireAuth
  const { firstName, lastName, phone } = req.body;

  if (firstName !== undefined) user.firstName = firstName;
  if (lastName !== undefined) user.lastName = lastName;
  if (phone !== undefined) user.phone = phone;
  await user.save();

  res.json({
    success: true,
    message: 'Profile updated.',
    data: { user: user.toJSON() },
  });
});

/** POST /api/auth/change-password — verifies the current password first. */
const changePassword = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('+password');

  if (!(await user.comparePassword(req.body.currentPassword))) {
    throw new ApiError(400, 'Your current password is incorrect.');
  }

  user.password = req.body.newPassword; // hashed by the model's pre-save hook
  await user.save();

  res.json({ success: true, message: 'Password changed successfully.' });
});

module.exports = { register, login, logout, me, updateProfile, changePassword };
