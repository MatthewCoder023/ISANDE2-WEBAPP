const ColorFormula = require('../models/ColorFormula');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const escapeRegExp = require('../utils/escapeRegExp');

/** GET /api/formulas — mixer/admin formula library. */
const list = asyncHandler(async (req, res) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);

  const filter = {};
  const status = req.query.status || 'active';
  if (status === 'active') filter.isActive = true;
  else if (status === 'archived') filter.isActive = false;
  // status === 'all' -> no filter

  if (req.query.search) {
    const pattern = new RegExp(escapeRegExp(req.query.search.trim()), 'i');
    filter.$or = [{ name: pattern }, { colorHex: pattern }];
  }

  const [formulas, total] = await Promise.all([
    ColorFormula.find(filter)
      .sort('name')
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('createdBy', 'firstName lastName'),
    ColorFormula.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: {
      formulas,
      pagination: { page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1) },
    },
  });
});

/** POST /api/formulas */
const create = asyncHandler(async (req, res) => {
  const { name, colorHex, components, notes } = req.body;

  const formula = await ColorFormula.create({
    name,
    colorHex,
    components,
    notes,
    createdBy: req.user._id,
  });

  res.status(201).json({
    success: true,
    message: `Formula "${formula.name}" saved.`,
    data: { formula: formula.toJSON() },
  });
});

/** PATCH /api/formulas/:id — whitelisted fields; also restores archived. */
const update = asyncHandler(async (req, res) => {
  const formula = await ColorFormula.findById(req.params.id);
  if (!formula) throw new ApiError(404, 'Formula not found.');

  const { name, colorHex, components, notes, isActive } = req.body;
  if (name !== undefined) formula.name = name;
  if (colorHex !== undefined) formula.colorHex = colorHex;
  if (components !== undefined) formula.components = components;
  if (notes !== undefined) formula.notes = notes;
  if (isActive !== undefined) formula.isActive = isActive;
  await formula.save();

  res.json({
    success: true,
    message: `Formula "${formula.name}" updated.`,
    data: { formula: formula.toJSON() },
  });
});

/** DELETE /api/formulas/:id — soft delete (archive). */
const archive = asyncHandler(async (req, res) => {
  const formula = await ColorFormula.findById(req.params.id);
  if (!formula) throw new ApiError(404, 'Formula not found.');

  formula.isActive = false;
  await formula.save();

  res.json({
    success: true,
    message: `Formula "${formula.name}" archived. Past mixes keep their reference.`,
    data: { formula: formula.toJSON() },
  });
});

module.exports = { list, create, update, archive };
