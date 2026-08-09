const Product = require('../models/Product');
const StockMovement = require('../models/StockMovement');
const Setting = require('../models/Setting');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const escapeRegExp = require('../utils/escapeRegExp');
const { toCsv, sendCsv } = require('../utils/csv');
const { HEX_COLOR_REGEX, hexToLab, deltaE } = require('../utils/color');
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

  /**
   * Custom paints are mixed for one customer and must never appear in
   * anyone else's catalogue. Customers see the ordinary catalogue plus
   * their own mixes; staff see everything so they can sell and manage them.
   * Products created before custom mixes existed have no isCustom field at
   * all, so the test is `$ne: true` rather than `false`.
   */
  if (isClient) {
    filter.$and = [
      ...(filter.$and || []),
      { $or: [{ isCustom: { $ne: true } }, { customFor: req.user._id }] },
    ];
  }

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
    // "alert" is low AND out together — what the admin dashboard's
    // Low / Out of Stock tile counts, so it can link to exactly that set.
    else if (req.query.stock === 'alert') {
      filter.$expr = { $lte: ['$stock.quantity', '$stock.lowStockThreshold'] };
    }
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
  // Catalogue health is about shelf stock. A sold custom mix hitting zero is
  // the expected end of its life, not a stock alert worth chasing.
  const catalogue = { isActive: true, isCustom: { $ne: true } };

  const [totalActive, lowStock, outOfStock, valueAgg] = await Promise.all([
    Product.countDocuments(catalogue),
    Product.countDocuments({ ...catalogue, ...LOW_STOCK_FILTER }),
    Product.countDocuments({ ...catalogue, 'stock.quantity': 0 }),
    Product.aggregate([
      { $match: catalogue },
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

/**
 * GET /api/products/match?hex=A1B2C3&limit=4
 * Ranks active, colored catalog paints by perceptual closeness (CIELAB ΔE)
 * to the requested color. Powers the Color Studio suggestions.
 */
const matchByColor = asyncHandler(async (req, res) => {
  const hex = String(req.query.hex || '');
  if (!HEX_COLOR_REGEX.test(hex)) {
    throw new ApiError(422, 'Provide a color as a 6-digit hex value, e.g. ?hex=A1B2C3.');
  }
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 4, 1), 8);

  const targetLab = hexToLab(hex);
  // One-off custom mixes are not shelf stock — suggesting someone else's
  // bespoke colour as a "closest paint" would be both wrong and a leak.
  const products = await Product.find({
    isActive: true,
    'color.hex': { $ne: '' },
    isCustom: { $ne: true },
  });

  const matches = products
    .map((product) => {
      const distance = deltaE(targetLab, hexToLab(product.color.hex));
      return {
        product: shapeForRole(product, req.user.role),
        deltaE: Math.round(distance * 10) / 10,
        // 0 ΔE = identical; anything beyond ~60 is effectively unrelated.
        matchPercent: Math.max(0, Math.round(100 - distance)),
      };
    })
    .sort((a, b) => a.deltaE - b.deltaE)
    .slice(0, limit);

  res.json({ success: true, data: { matches } });
});

/** GET /api/products/export — the full inventory as a CSV download. */
const exportCsv = asyncHandler(async (req, res) => {
  const products = await Product.find({}).sort('sku');

  const rows = products.map((p) => [
    p.sku,
    p.name,
    p.category,
    p.color.name,
    p.color.hex,
    p.finish,
    p.size,
    p.price,
    p.stock.quantity,
    p.stock.lowStockThreshold,
    Math.round(p.price * p.stock.quantity * 100) / 100,
    p.isActive ? 'active' : 'archived',
  ]);

  const csv = toCsv(
    ['SKU', 'Name', 'Category', 'Color', 'Hex', 'Finish', 'Size', 'Price', 'Stock',
      'Low Stock Threshold', 'Stock Value', 'Status'],
    rows
  );
  sendCsv(res, 'inventory', csv);
});

/** GET /api/products/:id */
const getById = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);
  const isClient = req.user.role === ROLES.CLIENT;

  // Archived products don't exist as far as customers are concerned, and
  // neither does another customer's custom mix — a 404 rather than a 403,
  // so the response can't be used to prove such a product exists.
  const foreignCustomMix =
    isClient && product?.isCustom && !product.customFor?.equals(req.user._id);

  if (!product || (isClient && !product.isActive) || foreignCustomMix) {
    throw new ApiError(404, 'Product not found.');
  }

  res.json({ success: true, data: { product: shapeForRole(product, req.user.role) } });
});

/** POST /api/products — admin only. */
const create = asyncHandler(async (req, res) => {
  const { name, sku, description, category, finish, size, color, price, stock } = req.body;
  const settings = await Setting.get();

  /**
   * A new product is a catalogue entry, not a delivery. It starts empty and
   * fills up when a purchase order is received, so that every unit on the
   * shelf can be traced to the order that bought it — a starting quantity
   * typed in here would be stock from nowhere.
   */
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
      quantity: 0,
      lowStockThreshold: stock?.lowStockThreshold ?? settings.defaultLowStockThreshold,
    },
  });

  res.status(201).json({
    success: true,
    message: 'Product added to the catalogue. Raise a purchase order to bring in stock.',
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

module.exports = { list, stats, matchByColor, exportCsv, getById, create, update, archive };
