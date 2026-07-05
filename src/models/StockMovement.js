const mongoose = require('mongoose');
const { MOVEMENT_TYPES } = require('../constants/products');

/**
 * Append-only audit trail of every stock change. The current quantity on
 * Product is the fast read path; this collection is the source of truth
 * for how it got there (who, when, why).
 */
const stockMovementSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: Object.values(MOVEMENT_TYPES),
      required: true,
    },
    // Signed delta applied to stock (+ restock, − sale/adjustment down).
    quantity: {
      type: Number,
      required: true,
      validate: {
        validator: (value) => Number.isInteger(value) && value !== 0,
        message: 'Movement quantity must be a non-zero integer.',
      },
    },
    // Resulting quantity, denormalized so history reads don't need replay.
    quantityAfter: {
      type: Number,
      required: true,
      min: 0,
    },
    reason: {
      type: String,
      trim: true,
      maxlength: 200,
      default: '',
    },
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true }
);

stockMovementSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    delete ret._id;
    return ret;
  },
});

module.exports = mongoose.model('StockMovement', stockMovementSchema);
