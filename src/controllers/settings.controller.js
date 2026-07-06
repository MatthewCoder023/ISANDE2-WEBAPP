const Setting = require('../models/Setting');
const asyncHandler = require('../utils/asyncHandler');

/**
 * GET /api/settings — any authenticated user. Nothing here is secret
 * (the payment page shows the GCash details to customers), and admin
 * pages read the same shape.
 */
const get = asyncHandler(async (req, res) => {
  const settings = await Setting.get();
  res.json({ success: true, data: { settings: settings.toJSON() } });
});

/** PATCH /api/settings — admin only, whitelisted fields. */
const update = asyncHandler(async (req, res) => {
  const settings = await Setting.get();

  const fields = [
    'shopName',
    'addressLine',
    'phone',
    'gcashNumber',
    'gcashName',
    'acceptOnlineOrders',
    'defaultLowStockThreshold',
  ];
  for (const field of fields) {
    if (req.body[field] !== undefined) settings[field] = req.body[field];
  }
  await settings.save();

  res.json({
    success: true,
    message: 'Settings saved.',
    data: { settings: settings.toJSON() },
  });
});

module.exports = { get, update };
