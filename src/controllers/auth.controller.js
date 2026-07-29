const crypto = require('crypto');

const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const lockout = require('../utils/loginLockout');
const audit = require('../services/audit.service');
const { sendMail } = require('../services/mail.service');
const { ROLES, DASHBOARD_PATHS } = require('../constants/roles');

const RESET_TOKEN_MINUTES = 30;
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

/**
 * Regenerating the session ID on login prevents session fixation:
 * an attacker who planted a session ID before login cannot reuse it after.
 */
function establishSession(req, user) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = user.id;
      // Stamped at login and checked on every request: bumping the user's
      // sessionVersion (password change/reset) invalidates this session.
      req.session.sessionVersion = user.sessionVersion || 0;
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

  await establishSession(req, user);
  audit.record('account_created', {
    email: user.email,
    actorName: user.fullName,
    ip: req.ip,
    note: 'Self-registration',
  });

  res.status(201).json({
    success: true,
    message: 'Account created successfully.',
    data: { user: user.toJSON(), redirectTo: DASHBOARD_PATHS[user.role] },
  });
});

/** POST /api/auth/login — every role signs in here; the reply carries their dashboard. */
const login = asyncHandler(async (req, res) => {
  const { password } = req.body;
  const email = req.body.email.toLowerCase();

  // Per-account lockout: five failed attempts in 15 minutes locks the
  // account briefly, whatever IPs the attempts came from.
  const lock = lockout.status(email);
  if (lock.locked) {
    audit.record('login_locked', { email, ip: req.ip });
    throw new ApiError(
      429,
      `Too many failed attempts for this account. Please try again in ${lock.minutesLeft} minute(s).`
    );
  }

  const user = await User.findOne({ email }).select('+password');

  // Same message for "no such user" and "wrong password" to avoid account enumeration.
  if (!user || !(await user.comparePassword(password))) {
    lockout.recordFailure(email);
    audit.record('login_failed', { email, ip: req.ip });
    throw new ApiError(401, 'Invalid email or password.');
  }

  if (!user.isActive) {
    throw new ApiError(403, 'This account has been deactivated. Please contact the administrator.');
  }

  lockout.clear(email);
  await establishSession(req, user);
  audit.record('login_success', { email, actorName: user.fullName, ip: req.ip });

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
  user.sessionVersion = (user.sessionVersion || 0) + 1;
  await user.save();

  // Every other session for this account is now invalid; keep this one
  // alive by moving it to the new version.
  req.session.sessionVersion = user.sessionVersion;
  await new Promise((resolve, reject) => {
    req.session.save((err) => (err ? reject(err) : resolve()));
  });

  audit.record('password_changed', {
    email: user.email,
    actorName: req.user.fullName,
    ip: req.ip,
    note: 'Changed by the account owner',
  });

  res.json({ success: true, message: 'Password changed successfully.' });
});

/**
 * POST /api/auth/forgot-password — emails a reset link. The response is
 * identical whether or not the email has an account (no enumeration).
 */
const forgotPassword = asyncHandler(async (req, res) => {
  const email = req.body.email.toLowerCase();
  const user = await User.findOne({ email });

  if (user && user.isActive) {
    const token = crypto.randomBytes(32).toString('hex');
    user.resetPasswordToken = hashToken(token);
    user.resetPasswordExpires = new Date(Date.now() + RESET_TOKEN_MINUTES * 60 * 1000);
    await user.save();

    const appUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    sendMail({
      to: user.email,
      subject: 'Reset your Flavor & Color password',
      text:
        `Hi ${user.firstName},\n\n` +
        `Someone (hopefully you) asked to reset the password for this account. ` +
        `The link below works once and expires in ${RESET_TOKEN_MINUTES} minutes:\n\n` +
        `${appUrl}/reset-password?token=${token}\n\n` +
        `If this wasn't you, you can ignore this email — your password is unchanged.\n\n` +
        `— Flavor & Color`,
    });
    audit.record('reset_requested', { email: user.email, ip: req.ip });
  }

  res.json({
    success: true,
    message: "If that email has an account, we've sent a reset link. Check your inbox.",
  });
});

/** POST /api/auth/reset-password — consumes an emailed token. */
const resetPassword = asyncHandler(async (req, res) => {
  const user = await User.findOne({
    resetPasswordToken: hashToken(req.body.token),
    resetPasswordExpires: { $gt: new Date() },
  }).select('+resetPasswordToken +resetPasswordExpires');

  if (!user) {
    throw new ApiError(400, 'This reset link is invalid or has expired. Please request a new one.');
  }

  user.password = req.body.newPassword; // hashed by the model's pre-save hook
  user.resetPasswordToken = '';
  user.resetPasswordExpires = null;
  // Whoever knew the old password — or holds a stolen session — is out.
  user.sessionVersion = (user.sessionVersion || 0) + 1;
  await user.save();

  audit.record('password_reset', {
    email: user.email,
    actorName: user.fullName,
    ip: req.ip,
    note: 'Via emailed reset link',
  });

  res.json({ success: true, message: 'Password reset. You can now sign in with your new password.' });
});

module.exports = {
  register,
  login,
  logout,
  me,
  updateProfile,
  changePassword,
  forgotPassword,
  resetPassword,
};
