const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { ROLES, ALL_ROLES } = require('../constants/roles');

const BCRYPT_ROUNDS = 12;

const userSchema = new mongoose.Schema(
  {
    firstName: {
      type: String,
      required: [true, 'First name is required.'],
      trim: true,
      maxlength: [50, 'First name must be 50 characters or fewer.'],
    },
    lastName: {
      type: String,
      required: [true, 'Last name is required.'],
      trim: true,
      maxlength: [50, 'Last name must be 50 characters or fewer.'],
    },
    email: {
      type: String,
      required: [true, 'Email is required.'],
      unique: true,
      lowercase: true,
      trim: true,
    },
    phone: {
      type: String,
      trim: true,
      default: '',
    },
    // select: false keeps the hash out of every query unless explicitly requested.
    password: {
      type: String,
      required: [true, 'Password is required.'],
      select: false,
    },
    role: {
      type: String,
      enum: { values: ALL_ROLES, message: 'Invalid role.' },
      default: ROLES.CLIENT,
    },
    // Soft deactivation: disabled accounts keep their history but cannot log in.
    isActive: {
      type: Boolean,
      default: true,
    },
    // Bumped whenever the password changes: sessions carry the version they
    // were created with, so every *other* session dies instantly.
    sessionVersion: {
      type: Number,
      default: 0,
    },
    /**
     * When this customer finished or skipped the first-run walkthrough
     * (see public/js/client-tour.js). Null means it has not been shown yet.
     * Kept on the account rather than in the browser so signing in from a
     * second device does not replay a tour they have already been through.
     */
    clientTourSeenAt: {
      type: Date,
      default: null,
    },
    // Self-service reset: only the sha256 HASH of the emailed token is
    // stored, so a database leak cannot be turned into working reset links.
    resetPasswordToken: {
      type: String,
      default: '',
      select: false,
    },
    resetPasswordExpires: {
      type: Date,
      default: null,
      select: false,
    },
  },
  { timestamps: true }
);

userSchema.virtual('fullName').get(function () {
  return `${this.firstName} ${this.lastName}`;
});

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, BCRYPT_ROUNDS);
  next();
});

userSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

userSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    delete ret._id;
    delete ret.password;
    delete ret.sessionVersion; // internal bookkeeping, never part of the API
    return ret;
  },
});

module.exports = mongoose.model('User', userSchema);
