const mongoose = require('mongoose');

/**
 * Security audit trail: who signed in (or tried to), and every change to
 * credentials, roles, and account status. Append-only; entries expire
 * after 90 days via the TTL index so the log cannot grow forever.
 */
const AUTH_EVENT_TYPES = [
  'login_success',
  'login_failed',
  'login_locked',
  'password_changed',
  'password_reset',
  'reset_requested',
  'role_changed',
  'account_deactivated',
  'account_reactivated',
  'account_created',
];

const authEventSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: AUTH_EVENT_TYPES,
    required: true,
  },
  // The account the event is about. A plain string (not a ref): the log
  // must stay readable even if the account is later deleted.
  email: {
    type: String,
    lowercase: true,
    trim: true,
    default: '',
  },
  // Who performed it — "themselves" for self-service, an admin's name for
  // management actions. Snapshotted as text so history never rewrites.
  actorName: {
    type: String,
    trim: true,
    default: '',
  },
  ip: {
    type: String,
    default: '',
  },
  note: {
    type: String,
    trim: true,
    default: '',
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 60 * 60 * 24 * 90, // 90 days
  },
});

authEventSchema.index({ createdAt: -1 });

authEventSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    delete ret._id;
    return ret;
  },
});

module.exports = mongoose.model('AuthEvent', authEventSchema);
module.exports.AUTH_EVENT_TYPES = AUTH_EVENT_TYPES;
