const mongoose = require('mongoose');
const { PAYMENT_METHODS } = require('../constants/orders');

/**
 * One payment record per completed order. Kept as its own collection
 * (rather than embedded on Order) so the cashier's transaction log and
 * financial reports can query payments directly.
 */
const transactionSchema = new mongoose.Schema(
  {
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
      index: true,
    },
    // Denormalized for display and search without a join.
    orderNumber: {
      type: String,
      required: true,
    },
    amount: { type: Number, required: true, min: 0 },
    method: {
      type: String,
      enum: PAYMENT_METHODS,
      required: true,
    },
    amountTendered: { type: Number, required: true, min: 0 },
    change: { type: Number, required: true, min: 0 },
    receivedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    /**
     * The receipt's identity, assigned once when the payment is recorded.
     *
     * Only the identity is stored; the PDF itself is rendered on demand from
     * this record, which never changes after the sale. That is what makes
     * the admin's copy and the cashier's copy the same document rather than
     * two versions of one — there is nothing to drift, nothing to keep in
     * sync, and no file to lose.
     */
    receiptNumber: {
      type: String,
      uppercase: true,
      trim: true,
      // Sparse: transactions recorded before receipts existed have no number
      // yet, and without this a unique index would treat every one of those
      // missing values as a duplicate null and refuse to build.
      unique: true,
      sparse: true,
    },
    receiptIssuedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

/**
 * Assigned here rather than at each call site so no payment path can create
 * a transaction without a receipt, and so a receipt number is never reissued
 * for a transaction that already has one.
 */
transactionSchema.pre('validate', async function assignReceiptNumber(next) {
  if (this.receiptNumber) return next();
  try {
    this.receiptNumber = await this.constructor.generateReceiptNumber();
    next();
  } catch (err) {
    next(err);
  }
});

/**
 * Gives a transaction its receipt number if it does not have one, and
 * remembers it. Transactions recorded before receipts existed get theirs the
 * first time somebody asks for the document — assigned once and persisted,
 * so it is the same number on every later visit rather than a fresh one.
 */
transactionSchema.methods.ensureReceiptNumber = async function ensureReceiptNumber() {
  if (this.receiptNumber) return this.receiptNumber;
  this.receiptNumber = await this.constructor.generateReceiptNumber();
  if (!this.receiptIssuedAt) this.receiptIssuedAt = this.createdAt || new Date();
  await this.save();
  return this.receiptNumber;
};

/** OR-YYYYMMDD-NNNN — "official receipt", the term the counter already uses. */
transactionSchema.statics.generateReceiptNumber = async function generateReceiptNumber() {
  const now = new Date();
  const ymd = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('');

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = `OR-${ymd}-${Math.floor(1000 + Math.random() * 9000)}`;
    // eslint-disable-next-line no-await-in-loop
    const exists = await this.exists({ receiptNumber: candidate });
    if (!exists) return candidate;
  }
  return `OR-${ymd}-${Date.now().toString().slice(-6)}`;
};

// The cashier log sorts newest-first (optionally filtered by method), and
// sales reports aggregate over createdAt ranges — both index-served.
transactionSchema.index({ createdAt: -1 });
transactionSchema.index({ method: 1, createdAt: -1 });

transactionSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    delete ret._id;
    return ret;
  },
});

module.exports = mongoose.model('Transaction', transactionSchema);
