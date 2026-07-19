const User = require('../models/User');
const AuthEvent = require('../models/AuthEvent');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const escapeRegExp = require('../utils/escapeRegExp');
const audit = require('../services/audit.service');
const { AUTH_EVENT_TYPES } = AuthEvent;
const { ROLES, ALL_ROLES } = require('../constants/roles');

/**
 * Blocks changes that would lock administration out of the system:
 * admins cannot demote or deactivate themselves, and the last active
 * admin can never be demoted or deactivated.
 */
async function assertAdminSafety(target, changes, actingUser) {
  const demoting = changes.role !== undefined && changes.role !== ROLES.ADMIN;
  const deactivating = changes.isActive === false;

  if (target._id.equals(actingUser._id) && (demoting || deactivating || changes.role !== undefined)) {
    throw new ApiError(400, 'You cannot change your own role or deactivate your own account.');
  }

  if (target.role === ROLES.ADMIN && target.isActive && (demoting || deactivating)) {
    const activeAdmins = await User.countDocuments({ role: ROLES.ADMIN, isActive: true });
    if (activeAdmins <= 1) {
      throw new ApiError(400, 'This is the last active administrator — the system needs at least one.');
    }
  }
}

/** GET /api/users — admin directory with filters. */
const list = asyncHandler(async (req, res) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);

  const filter = {};
  if (ALL_ROLES.includes(req.query.role)) filter.role = req.query.role;
  if (req.query.status === 'active') filter.isActive = true;
  else if (req.query.status === 'inactive') filter.isActive = false;

  if (req.query.search) {
    const pattern = new RegExp(escapeRegExp(req.query.search.trim()), 'i');
    filter.$or = [{ firstName: pattern }, { lastName: pattern }, { email: pattern }];
  }

  const [users, total] = await Promise.all([
    User.find(filter)
      .sort('-createdAt')
      .skip((page - 1) * limit)
      .limit(limit),
    User.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: {
      users,
      pagination: { page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1) },
    },
  });
});

/** GET /api/users/stats — dashboard numbers. */
const stats = asyncHandler(async (req, res) => {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [total, clients, staff, newThisMonth] = await Promise.all([
    User.countDocuments({}),
    User.countDocuments({ role: ROLES.CLIENT }),
    User.countDocuments({ role: { $ne: ROLES.CLIENT } }),
    User.countDocuments({ createdAt: { $gte: monthStart } }),
  ]);

  res.json({ success: true, data: { stats: { total, clients, staff, newThisMonth } } });
});

/** POST /api/users — admin creates an account (typically an employee). */
const create = asyncHandler(async (req, res) => {
  const { firstName, lastName, email, phone, password, role } = req.body;

  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) {
    throw new ApiError(409, 'An account with this email already exists.');
  }

  const user = await User.create({ firstName, lastName, email, phone, password, role });
  audit.record('account_created', {
    email: user.email,
    actorName: req.user.fullName,
    ip: req.ip,
    note: `Created by an administrator with the ${role} role`,
  });

  res.status(201).json({
    success: true,
    message: `Account for ${user.fullName} created.`,
    data: { user: user.toJSON() },
  });
});

/** PATCH /api/users/:id — whitelisted fields; email is immutable. */
const update = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw new ApiError(404, 'User not found.');

  const { firstName, lastName, phone, role, isActive } = req.body;
  await assertAdminSafety(user, { role, isActive }, req.user);

  const previousRole = user.role;
  const wasActive = user.isActive;

  if (firstName !== undefined) user.firstName = firstName;
  if (lastName !== undefined) user.lastName = lastName;
  if (phone !== undefined) user.phone = phone;
  if (role !== undefined) user.role = role;
  if (isActive !== undefined) user.isActive = isActive;
  await user.save();

  const auditContext = { email: user.email, actorName: req.user.fullName, ip: req.ip };
  if (role !== undefined && role !== previousRole) {
    audit.record('role_changed', { ...auditContext, note: `${previousRole} to ${role}` });
  }
  if (isActive === false && wasActive) {
    audit.record('account_deactivated', auditContext);
  } else if (isActive === true && !wasActive) {
    audit.record('account_reactivated', auditContext);
  }

  const note = isActive === false ? ' Their session is no longer valid.' : '';
  res.json({
    success: true,
    message: `${user.fullName} updated.${note}`,
    data: { user: user.toJSON() },
  });
});

/** POST /api/users/:id/reset-password — admin sets a new password. */
const resetPassword = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw new ApiError(404, 'User not found.');

  user.password = req.body.password; // hashed by the model's pre-save hook
  // Kill any sessions the account still has — whoever knew the old
  // password must log in again with the new one.
  user.sessionVersion = (user.sessionVersion || 0) + 1;
  await user.save();

  audit.record('password_reset', {
    email: user.email,
    actorName: req.user.fullName,
    ip: req.ip,
    note: 'Reset by an administrator',
  });

  res.json({
    success: true,
    message: `Password for ${user.fullName} has been reset. Their existing sessions are signed out.`,
  });
});

/** GET /api/users/events — the security audit log (admin only). */
const events = asyncHandler(async (req, res) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 15, 1), 50);

  const filter = {};
  if (AUTH_EVENT_TYPES.includes(req.query.type)) filter.type = req.query.type;

  const [items, total] = await Promise.all([
    AuthEvent.find(filter)
      .sort('-createdAt')
      .skip((page - 1) * limit)
      .limit(limit),
    AuthEvent.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: {
      events: items,
      pagination: { page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1) },
    },
  });
});

module.exports = { list, stats, create, update, resetPassword, events };
