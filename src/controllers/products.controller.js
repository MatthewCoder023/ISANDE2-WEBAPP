const Product = require('../models/Product');
const StockMovement = require('../models/StockMovement');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const escapeRegExp = require('../utils/escapeRegExp');
const { ROLES } = require('../constants/roles');
const { CATEGORY_VALUES, MOVEMENT_TYPES } = require('../constants/products');

/**
 * Customers get a catalog view: availability status but no raw stock
 * counts, thresholds, or archival state. Staff see everything.
 */
function shapeForRole(product, role) {
  const json = product.toJSON();
  if (role === ROLES.CLIENT) {
    const { stock, isActive, updatedAt, ...publicFields } = json;
    return publicFields;
  }
  return json;
}

function parsePagination(query, defaultLimit = 12) {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || defaultLimit, 1), 50);
  return { page, limit, skip: (page - 1) * limit };
}

const LOW_STOCK_FILTER = {
  'stock.quantity': { $gt: 0 },
  $expr: { $lte: ['$stock.quantity', '$stock.lowStockThreshold'] },
};

/** GET /api/products — all roles; clients only ever see active products. */
const list = asyncHandler(async (req, res) => {
  const isClient = req.user.role === ROLES.CLIENT;
  const { page, limit, skip } = parsePagination(req.query);

  const filter = {};

  const status = isClient ? 'active' : req.query.status || 'active';
  if (status === 'active') filter.isActive = true;
  else if (status === 'archived') filter.isActive = false;
  // status === 'all' -> no isActive filter (staff only)

  if (CATEGORY_VALUES.includes(req.query.category)) {
    filter.category = req.query.category;
  }

  if (req.query.search) {
    const pattern = new RegExp(escapeRegExp(req.query.search.trim()), 'i');
    filter.$or = [{ name: pattern }, { sku: pattern }, { 'color.name': pattern }];
  }

  if (!isClient) {
    if (req.query.stock === 'low') Object.assign(filter, LOW_STOCK_FILTER);
    else if (req.query.stock === 'out') filter['stock.quantity'] = 0;
  }

  const sortMap = {
    newest: '-createdAt',
    name: 'name',
    price_asc: 'price',
    price_desc: '-price',
  };
  const sort = sortMap[req.query.sort] || 'name';

  const [products, total] = await Promise.all([
    Product.find(filter).sort(sort).skip(skip).limit(limit),
    Product.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: {
      products: products.map((p) => shapeForRole(p, req.user.role)),
      pagination: { page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1) },
    },
  });
});

/** GET /api/products/stats — admin dashboard summary. */
const stats = asyncHandler(async (req, res) => {
  const [totalActive, lowStock, outOfStock, valueAgg] = await Promise.all([
    Product.countDocuments({ isActive: true }),
    Product.countDocuments({ isActive: true, ...LOW_STOCK_FILTER }),
    Product.countDocuments({ isActive: true, 'stock.quantity': 0 }),
    Product.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: null, total: { $sum: { $multiply: ['$price', '$stock.quantity'] } } } },
    ]),
  ]);

  res.json({
    success: true,
    data: {
      stats: {
        totalActive,
        lowStock,
        outOfStock,
        inventoryValue: valueAgg[0]?.total || 0,
      },
    },
  });
});

/** GET /api/products/:id */
const getById = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);
  const isClient = req.user.role === ROLES.CLIENT;

  // Archived products don't exist as far as customers are concerned.
  if (!product || (isClient && !product.isActive)) {
    throw new ApiError(404, 'Product not found.');
  }

  res.json({ success: true, data: { product: shapeForRole(product, req.user.role) } });
});

/** POST /api/products — admin only. */
const create = asyncHandler(async (req, res) => {
  const { name, sku, description, category, finish, size, color, price, stock } = req.body;
  const initialQuantity = stock?.quantity ?? 0;

  const product = await Product.create({
    name,
    sku: sku || (await Product.generateSku(category)),
    description,
    category,
    finish,
    size,
    color: { name: color?.name || '', hex: color?.hex || '' },
    price,
    stock: {
      quantity: initialQuantity,
      lowStockThreshold: stock?.lowStockThreshold ?? 5,
    },
  });

  // Starting quantity enters the audit trail like any other stock change.
  if (initialQuantity > 0) {
    await StockMovement.create({
      product: product._id,
      type: MOVEMENT_TYPES.INITIAL,
      quantity: initialQuantity,
      quantityAfter: initialQuantity,
      reason: 'Initial stock at product creation',
      performedBy: req.user._id,
    });
  }

  res.status(201).json({
    success: true,
    message: 'Product created successfully.',
    data: { product: product.toJSON() },
  });
});

/**
 * PATCH /api/products/:id — admin only.
 * Whitelisted fields only; sku and stock.quantity are intentionally
 * not updatable here (see products.validators.js).
 */
const update = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) throw new ApiError(404, 'Product not found.');

  const { name, description, category, finish, size, color, price, isActive, stock } = req.body;

  if (name !== undefined) product.name = name;
  if (description !== undefined) product.description = description;
  if (category !== undefined) product.category = category;
  if (finish !== undefined) product.finish = finish;
  if (size !== undefined) product.size = size;
  if (color !== undefined) {
    product.color = { name: color?.name || '', hex: color?.hex || '' };
  }
  if (price !== undefined) product.price = price;
  if (isActive !== undefined) product.isActive = isActive;
  if (stock?.lowStockThreshold !== undefined) {
    product.stock.lowStockThreshold = stock.lowStockThreshold;
  }

  await product.save();

  res.json({
    success: true,
    message: 'Product updated successfully.',
    data: { product: product.toJSON() },
  });
});

/** DELETE /api/products/:id — admin only. Soft delete (archive). */
const archive = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) throw new ApiError(404, 'Product not found.');

  product.isActive = false;
  await product.save();

  res.json({
    success: true,
    message: 'Product archived. It is hidden from customers but can be restored.',
    data: { product: product.toJSON() },
  });
});

module.exports = { list, stats, getById, create, update, archive };
