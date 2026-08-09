const Supplier = require('../models/Supplier');
const PurchaseOrder = require('../models/PurchaseOrder');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const escapeRegExp = require('../utils/escapeRegExp');

/** GET /api/suppliers — the directory, newest-relevant first (by name). */
const list = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.status === 'inactive') filter.isActive = false;
  else if (req.query.status !== 'all') filter.isActive = true;

  if (req.query.search) {
    const pattern = new RegExp(escapeRegExp(req.query.search.trim()), 'i');
    filter.$or = [{ name: pattern }, { contactPerson: pattern }, { email: pattern }];
  }

  const suppliers = await Supplier.find(filter).sort('name');

  // How much has been ordered from each — the one number that makes the
  // directory worth opening rather than a list of names.
  const counts = await PurchaseOrder.aggregate([
    { $group: { _id: '$supplier', orders: { $sum: 1 }, value: { $sum: '$total' } } },
  ]);
  const bySupplier = new Map(counts.map((row) => [String(row._id), row]));

  res.json({
    success: true,
    data: {
      suppliers: suppliers.map((supplier) => ({
        ...supplier.toJSON(),
        purchaseOrders: bySupplier.get(String(supplier._id))?.orders || 0,
        purchaseValue: bySupplier.get(String(supplier._id))?.value || 0,
      })),
    },
  });
});

const create = asyncHandler(async (req, res) => {
  const supplier = await Supplier.create(req.body);
  res.status(201).json({
    success: true,
    message: 'Supplier added.',
    data: { supplier: supplier.toJSON() },
  });
});

const update = asyncHandler(async (req, res) => {
  const supplier = await Supplier.findById(req.params.id);
  if (!supplier) throw new ApiError(404, 'Supplier not found.');

  Object.assign(supplier, req.body);
  await supplier.save();

  res.json({
    success: true,
    message: 'Supplier updated.',
    data: { supplier: supplier.toJSON() },
  });
});

/**
 * DELETE /api/suppliers/:id — deactivate, never remove. Purchase orders
 * point here, and deleting the row would leave that history half-anonymous.
 */
const deactivate = asyncHandler(async (req, res) => {
  const supplier = await Supplier.findById(req.params.id);
  if (!supplier) throw new ApiError(404, 'Supplier not found.');

  supplier.isActive = false;
  await supplier.save();

  res.json({
    success: true,
    message: `${supplier.name} archived. Their purchase orders are unaffected.`,
    data: { supplier: supplier.toJSON() },
  });
});

module.exports = { list, create, update, deactivate };
