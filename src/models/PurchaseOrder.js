const mongoose = require('mongoose');
const { PO_STATUS, PO_STATUS_VALUES } = require('../constants/purchasing');

/**
 * One line of a purchase order.
 *
 * Product details are snapshotted the way order items are: a supplier's
 * paper says what it says, and a later catalogue rename or price change
 * must not rewrite a document that has already been sent out.
 */
const poItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    name: { type: String, required: true },
    sku: { type: String, required: true },
    // What the supplier charges, which is not what the shop sells it for.
    unitCost: { type: Number, required: true, min: 0 },
    quantityOrdered: {
      type: Number,
      required: true,
      min: [1, 'Order at least one unit.'],
      validate: {
        validator: Number.isInteger,
        message: 'Quantity ordered must be a whole number.',
      },
    },
    /**
     * What actually turned up. Stays null until the delivery is booked in,
     * because "not yet received" and "received none" are different facts.
     * Only this number ever moves stock.
     */
    quantityReceived: {
      type: Number,
      default: null,
      min: 0,
      validate: {
        validator: (value) => value === null || Number.isInteger(value),
        message: 'Quantity received must be a whole number.',
      },
    },
    lineTotal: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const purchaseOrderSchema = new mongoose.Schema(
  {
    poNumber: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },
    supplier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Supplier',
      required: true,
      index: true,
    },
    // Snapshotted alongside the reference for the same reason as the items:
    // the document must still read correctly if the supplier is renamed.
    supplierName: { type: String, required: true },

    items: {
      type: [poItemSchema],
      validate: {
        validator: (items) => items.length > 0,
        message: 'A purchase order needs at least one item.',
      },
    },

    subtotal: { type: Number, required: true, min: 0 },
    total: { type: Number, required: true, min: 0 },

    status: {
      type: String,
      enum: PO_STATUS_VALUES,
      default: PO_STATUS.DRAFT,
      index: true,
    },

    expectedDate: { type: Date, default: null },
    notes: { type: String, trim: true, maxlength: 500, default: '' },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    receivedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    receivedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    cancelledReason: { type: String, trim: true, maxlength: 200, default: '' },

    /** Every status change, in order — the same pattern the sales side uses. */
    statusHistory: [
      {
        status: { type: String, enum: PO_STATUS_VALUES, required: true },
        at: { type: Date, default: Date.now },
        by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        note: { type: String, trim: true, maxlength: 200, default: '' },
        _id: false,
      },
    ],
  },
  { timestamps: true }
);

// The list sorts newest-first and filters by status or supplier.
purchaseOrderSchema.index({ createdAt: -1 });
purchaseOrderSchema.index({ status: 1, createdAt: -1 });
purchaseOrderSchema.index({ supplier: 1, createdAt: -1 });

/** PO-YYYYMMDD-NNNN, mirroring order numbers so the two read as a pair. */
purchaseOrderSchema.statics.generatePoNumber = async function generatePoNumber() {
  const now = new Date();
  const ymd = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('');

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = `PO-${ymd}-${Math.floor(1000 + Math.random() * 9000)}`;
    // eslint-disable-next-line no-await-in-loop
    const exists = await this.exists({ poNumber: candidate });
    if (!exists) return candidate;
  }
  return `PO-${ymd}-${Date.now().toString().slice(-6)}`;
};

purchaseOrderSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    delete ret._id;
    return ret;
  },
});

module.exports = mongoose.model('PurchaseOrder', purchaseOrderSchema);
