const mongoose = require('mongoose');

/**
 * Who the shop buys from.
 *
 * Kept as its own collection rather than a name typed onto each purchase
 * order, so "everything we have ordered from this supplier" is a real
 * query and contact details live in one place instead of being re-entered
 * per order.
 */
const supplierSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Supplier name is required.'],
      trim: true,
      maxlength: [100, 'Supplier name must be 100 characters or fewer.'],
    },
    contactPerson: { type: String, trim: true, maxlength: 100, default: '' },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 120,
      default: '',
    },
    phone: { type: String, trim: true, maxlength: 30, default: '' },
    address: { type: String, trim: true, maxlength: 200, default: '' },
    // Free text on purpose: "30 days", "COD", "50% on order" are all real
    // answers and none of them are an enum worth defending.
    paymentTerms: { type: String, trim: true, maxlength: 80, default: '' },
    notes: { type: String, trim: true, maxlength: 300, default: '' },

    /**
     * Soft delete, matching Product. A supplier with purchase orders behind
     * it must never actually disappear, or that history loses its other end.
     */
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

supplierSchema.index({ name: 1 });
supplierSchema.index({ isActive: 1, name: 1 });

supplierSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    delete ret._id;
    return ret;
  },
});

module.exports = mongoose.model('Supplier', supplierSchema);
