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
  },
  { timestamps: true }
);

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
