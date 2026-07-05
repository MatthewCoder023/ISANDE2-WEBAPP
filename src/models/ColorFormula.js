const mongoose = require('mongoose');
const { FORMULA_UNITS } = require('../constants/mixing');

const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;

const componentSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Component name is required.'],
      trim: true,
      maxlength: 50,
    },
    amount: {
      type: Number,
      required: [true, 'Component amount is required.'],
      min: [0.01, 'Component amount must be greater than zero.'],
    },
    unit: {
      type: String,
      enum: FORMULA_UNITS,
      default: 'mL',
    },
  },
  { _id: false }
);

/**
 * A saved mixing recipe: which pigments/tints, and how much of each,
 * produce a given color. The mixer's institutional knowledge, kept.
 */
const colorFormulaSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Formula name is required.'],
      trim: true,
      maxlength: 80,
    },
    colorHex: {
      type: String,
      required: [true, 'Formula color is required.'],
      match: [HEX_COLOR_REGEX, 'Color must be a hex value like #A1B2C3.'],
    },
    components: {
      type: [componentSchema],
      validate: {
        validator: (items) => Array.isArray(items) && items.length > 0,
        message: 'A formula needs at least one component.',
      },
    },
    notes: { type: String, trim: true, maxlength: 300, default: '' },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    timesUsed: { type: Number, default: 0, min: 0 },
    // Soft delete: archived formulas stay referenced by past mixes.
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

colorFormulaSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    delete ret._id;
    return ret;
  },
});

module.exports = mongoose.model('ColorFormula', colorFormulaSchema);
