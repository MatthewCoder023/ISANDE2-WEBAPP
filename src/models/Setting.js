const mongoose = require('mongoose');

/**
 * Singleton system configuration. `Setting.get()` upserts the one
 * document with defaults on first access, so no seeding is required.
 * These values drive real behavior: GCash payment instructions, the
 * online-ordering switch, and the default low-stock threshold.
 */
const settingSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'app', unique: true },
    shopName: { type: String, trim: true, maxlength: 80, default: 'Flavor & Color' },
    addressLine: {
      type: String,
      trim: true,
      maxlength: 160,
      default: 'Mindanao Ave. cor. Arty 2, Quezon City',
    },
    phone: { type: String, trim: true, maxlength: 30, default: '' },
    gcashNumber: { type: String, trim: true, maxlength: 30, default: '0917 555 0123' },
    gcashName: { type: String, trim: true, maxlength: 80, default: 'Vernici Artisan Corp.' },
    acceptOnlineOrders: { type: Boolean, default: true },
    defaultLowStockThreshold: { type: Number, min: 0, max: 999, default: 5 },
    /**
     * Custom-mix pricing. A mix is quoted as the base paint's price (or
     * customMixBasePrice when the customer let the mixer choose the base)
     * plus the surcharge for the hand-mixing labour. Staff may override the
     * quote when completing the job.
     */
    customMixBasePrice: { type: Number, min: 0, max: 100000, default: 750 },
    customMixSurcharge: { type: Number, min: 0, max: 100000, default: 150 },
  },
  { timestamps: true }
);

settingSchema.statics.get = function () {
  return this.findOneAndUpdate(
    { key: 'app' },
    { $setOnInsert: { key: 'app' } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

settingSchema.set('toJSON', {
  versionKey: false,
  transform: (_doc, ret) => {
    delete ret._id;
    delete ret.key;
    return ret;
  },
});

module.exports = mongoose.model('Setting', settingSchema);
