const mongoose = require('mongoose');

/**
 * An in-app message for one person. Email reaches customers who aren't
 * looking at the app; this reaches whoever is — and gives staff a place to
 * see that work has arrived without watching a dashboard tile.
 *
 * One row per recipient, even for events that concern a whole role: read
 * state is personal, and a paint shop has a handful of staff, not thousands.
 * Entries expire after 90 days, matching the AuthEvent audit trail.
 */
const notificationSchema = new mongoose.Schema({
  recipient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  // Groups related messages and picks the icon in the UI.
  type: {
    type: String,
    required: true,
    trim: true,
    maxlength: 40,
  },
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 120,
  },
  body: {
    type: String,
    trim: true,
    maxlength: 300,
    default: '',
  },
  /** Where clicking should take the reader; relative to the app. */
  link: {
    type: String,
    trim: true,
    maxlength: 200,
    default: '',
  },
  readAt: {
    type: Date,
    default: null,
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 60 * 60 * 24 * 90, // 90 days
  },
});

// The bell asks one question constantly: my unread, newest first.
notificationSchema.index({ recipient: 1, createdAt: -1 });

notificationSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    delete ret._id;
    return ret;
  },
});

module.exports = mongoose.model('Notification', notificationSchema);
