const mongoose = require('mongoose');
const { ORDER_STATUS, ORDER_TYPES, ONLINE_PAYMENT_METHODS } = require('../constants/orders');

/**
 * Line items snapshot name/sku/price at order time. Catalog edits must
 * never rewrite past orders, so nothing here is resolved via populate
 * for display purposes.
 */
const orderItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    name: { type: String, required: true },
    sku: { type: String, default: '' },
    price: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1 },
    lineTotal: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

/** One entry per status change — the source of truth for the tracker. */
const statusEventSchema = new mongoose.Schema(
  {
    status: { type: String, required: true },
    at: { type: Date, default: Date.now },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    note: { type: String, trim: true, maxlength: 300, default: '' },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    orderNumber: {
      type: String,
      required: true,
      unique: true,
    },
    type: {
      type: String,
      enum: Object.values(ORDER_TYPES),
      required: true,
    },
    status: {
      type: String,
      enum: Object.values(ORDER_STATUS),
      default: ORDER_STATUS.PENDING_PAYMENT,
      index: true,
    },
    statusHistory: {
      type: [statusEventSchema],
      default: [],
    },
    // Set for online orders; walk-in sales identify via customerName.
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
    items: {
      type: [orderItemSchema],
      validate: {
        validator: (items) => Array.isArray(items) && items.length > 0,
        message: 'An order must contain at least one item.',
      },
    },
    subtotal: { type: Number, required: true, min: 0 },
    total: { type: Number, required: true, min: 0 },
    notes: { type: String, trim: true, maxlength: 300, default: '' },
    /**
     * Online checkout payment state. The money itself is recorded as a
     * Transaction (at proof verification for GCash, at handover for
     * cash-on-pickup); this tracks the method choice and the proof.
     */
    payment: {
      method: {
        type: String,
        enum: [...ONLINE_PAYMENT_METHODS, ''],
        default: '',
      },
      proof: {
        filename: { type: String, default: '' }, // stored name under uploads/proofs
        originalName: { type: String, default: '' },
        mimeType: { type: String, default: '' },
        size: { type: Number, default: 0 },
        uploadedAt: { type: Date, default: null },
      },
      verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      verifiedAt: { type: Date, default: null },
      rejectedReason: { type: String, trim: true, maxlength: 200, default: '' },
    },
    placedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    readyAt: { type: Date, default: null },
    paidAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
  },
  { timestamps: true }
);

orderSchema.virtual('itemCount').get(function () {
  return this.items.reduce((sum, item) => sum + item.quantity, 0);
});

/** Human-friendly unique number like ORD-20260705-4821. */
orderSchema.statics.generateOrderNumber = async function () {
  const now = new Date();
  const ymd = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('');

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = `ORD-${ymd}-${Math.floor(1000 + Math.random() * 9000)}`;
    // eslint-disable-next-line no-await-in-loop
    const exists = await this.exists({ orderNumber: candidate });
    if (!exists) return candidate;
  }
  return `ORD-${ymd}-${Date.now().toString().slice(-6)}`;
};

orderSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    delete ret._id;
    // Storage details of the proof are server-side concerns.
    if (ret.payment?.proof) {
      ret.payment.proof = {
        uploaded: Boolean(ret.payment.proof.filename),
        originalName: ret.payment.proof.originalName,
        uploadedAt: ret.payment.proof.uploadedAt,
      };
    }
    return ret;
  },
});

module.exports = mongoose.model('Order', orderSchema);
