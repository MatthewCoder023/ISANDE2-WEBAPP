const mongoose = require('mongoose');
const { CATEGORY_VALUES, FINISHES, SIZES, SKU_PREFIXES } = require('../constants/products');

const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Product name is required.'],
      trim: true,
      maxlength: [100, 'Product name must be 100 characters or fewer.'],
    },
    sku: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      maxlength: [500, 'Description must be 500 characters or fewer.'],
      default: '',
    },
    category: {
      type: String,
      required: [true, 'Category is required.'],
      enum: { values: CATEGORY_VALUES, message: 'Invalid category.' },
      index: true,
    },
    // finish/size are optional: tools & supplies have neither.
    finish: {
      type: String,
      enum: { values: [...FINISHES, ''], message: 'Invalid finish.' },
      default: '',
    },
    size: {
      type: String,
      enum: { values: [...SIZES, ''], message: 'Invalid size.' },
      default: '',
    },
    color: {
      name: { type: String, trim: true, maxlength: 50, default: '' },
      hex: {
        type: String,
        trim: true,
        default: '',
        validate: {
          validator: (value) => !value || HEX_COLOR_REGEX.test(value),
          message: 'Color must be a hex value like #A1B2C3.',
        },
      },
    },
    price: {
      type: Number,
      required: [true, 'Price is required.'],
      min: [0, 'Price cannot be negative.'],
    },
    /**
     * quantity is only ever changed through the inventory service
     * (atomic $inc + StockMovement audit entry) — never assigned directly.
     */
    stock: {
      quantity: { type: Number, min: 0, default: 0 },
      lowStockThreshold: { type: Number, min: 0, default: 5 },
    },
    // Soft delete: archived products keep their history and can be restored.
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  { timestamps: true }
);

productSchema.virtual('availability').get(function () {
  if (this.stock.quantity <= 0) return 'out_of_stock';
  if (this.stock.quantity <= this.stock.lowStockThreshold) return 'low_stock';
  return 'in_stock';
});

/** Generates a unique SKU like FC-INT-4821 when the admin leaves it blank. */
productSchema.statics.generateSku = async function (category) {
  const prefix = SKU_PREFIXES[category] || 'GEN';
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = `FC-${prefix}-${Math.floor(1000 + Math.random() * 9000)}`;
    // eslint-disable-next-line no-await-in-loop
    const exists = await this.exists({ sku: candidate });
    if (!exists) return candidate;
  }
  return `FC-${prefix}-${Date.now()}`;
};

productSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    delete ret._id;
    return ret;
  },
});

module.exports = mongoose.model('Product', productSchema);
