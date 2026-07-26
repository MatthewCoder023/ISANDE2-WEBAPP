const mongoose = require('mongoose');
const { MIX_STATUS } = require('../constants/mixing');

const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;

/**
 * A custom paint-mixing job. Created by customers (via the Color Studio)
 * or staff, then worked by the paint mixer:
 * queued -> mixing -> completed (cancellable before completion).
 * Completed/cancelled requests double as the production log.
 */
const mixRequestSchema = new mongoose.Schema(
  {
    requestNumber: {
      type: String,
      required: true,
      unique: true,
    },
    // Set for customer requests; staff-created requests identify by name.
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    customerName: {
      type: String,
      trim: true,
      maxlength: 80,
      default: '',
    },
    targetColor: {
      hex: {
        type: String,
        required: [true, 'Target color is required.'],
        match: [HEX_COLOR_REGEX, 'Target color must be a hex value like #A1B2C3.'],
      },
      name: { type: String, trim: true, maxlength: 50, default: '' },
    },
    // Optional base paint from the catalog (e.g. which line/size to tint).
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      default: null,
    },
    quantity: {
      type: Number,
      min: 1,
      max: 99,
      default: 1,
    },
    notes: { type: String, trim: true, maxlength: 300, default: '' },
    mixerNotes: { type: String, trim: true, maxlength: 300, default: '' },
    status: {
      type: String,
      enum: Object.values(MIX_STATUS),
      default: MIX_STATUS.QUEUED,
      index: true,
    },
    formula: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ColorFormula',
      default: null,
    },
    placedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    /**
     * Commercial side of the job, filled in when the mixer completes it.
     * `unitPrice` is the agreed price per unit (quantity lives above), and
     * `readyProduct` is the catalogue entry published so the customer can
     * buy this mix through the normal cart. `addedToCartAt` records the one
     * time it was auto-added, so removing it from the cart sticks.
     */
    unitPrice: { type: Number, min: 0, default: null },
    pricedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    readyProduct: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      default: null,
    },
    addedToCartAt: { type: Date, default: null },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
  },
  { timestamps: true }
);

/** Human-friendly unique number like MIX-20260705-4821. */
mixRequestSchema.statics.generateRequestNumber = async function () {
  const now = new Date();
  const ymd = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('');

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = `MIX-${ymd}-${Math.floor(1000 + Math.random() * 9000)}`;
    // eslint-disable-next-line no-await-in-loop
    const exists = await this.exists({ requestNumber: candidate });
    if (!exists) return candidate;
  }
  return `MIX-${ymd}-${Date.now().toString().slice(-6)}`;
};

mixRequestSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    delete ret._id;
    return ret;
  },
});

module.exports = mongoose.model('MixRequest', mixRequestSchema);
