const PurchaseOrder = require('../models/PurchaseOrder');
const Setting = require('../models/Setting');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const escapeRegExp = require('../utils/escapeRegExp');
const purchaseOrderService = require('../services/purchase-order.service');
const { renderPurchaseOrder } = require('../services/pdf.service');
const { PO_STATUS, PO_STATUS_VALUES, OPEN_PO_STATUSES } = require('../constants/purchasing');

/** Loads a PO or 404s — every handler below starts here. */
async function loadPo(id) {
  const po = await PurchaseOrder.findById(id)
    .populate('supplier', 'name contactPerson email phone address paymentTerms')
    .populate('createdBy', 'firstName lastName')
    .populate('receivedBy', 'firstName lastName');
  if (!po) throw new ApiError(404, 'Purchase order not found.');
  return po;
}

/** GET /api/purchase-orders — the list, newest first. */
const list = asyncHandler(async (req, res) => {
  const filter = {};

  if (req.query.status === 'open') filter.status = { $in: OPEN_PO_STATUSES };
  else if (PO_STATUS_VALUES.includes(req.query.status)) filter.status = req.query.status;

  if (req.query.supplier) filter.supplier = req.query.supplier;

  if (req.query.search) {
    const pattern = new RegExp(escapeRegExp(req.query.search.trim()), 'i');
    filter.$or = [{ poNumber: pattern }, { supplierName: pattern }];
  }

  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);

  const [purchaseOrders, total] = await Promise.all([
    PurchaseOrder.find(filter)
      .sort('-createdAt')
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('createdBy', 'firstName lastName'),
    PurchaseOrder.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: {
      purchaseOrders: purchaseOrders.map((po) => po.toJSON()),
      pagination: { page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1) },
    },
  });
});

/** GET /api/purchase-orders/stats — the tiles above the list. */
const stats = asyncHandler(async (req, res) => {
  const [open, received, outstanding] = await Promise.all([
    PurchaseOrder.countDocuments({ status: { $in: OPEN_PO_STATUSES } }),
    PurchaseOrder.countDocuments({ status: PO_STATUS.RECEIVED }),
    PurchaseOrder.aggregate([
      { $match: { status: { $in: OPEN_PO_STATUSES } } },
      { $group: { _id: null, value: { $sum: '$total' } } },
    ]),
  ]);

  res.json({
    success: true,
    data: {
      stats: {
        openOrders: open,
        receivedOrders: received,
        outstandingValue: outstanding[0]?.value || 0,
      },
    },
  });
});

/**
 * GET /api/purchase-orders/incoming — what stock is on its way, for staff.
 *
 * Deliberately narrower than the purchase order itself. The counter needs to
 * answer "we are out, but twelve are due Thursday"; it does not need to know
 * what the shop pays its suppliers. So this returns quantities and dates and
 * no money at all — the cost columns never leave the admin's own screens.
 *
 * Aggregated by product rather than by order, because one paint can sit on
 * two open orders and the question is about the paint.
 */
const incoming = asyncHandler(async (req, res) => {
  const purchaseOrders = await PurchaseOrder.find({ status: { $in: OPEN_PO_STATUSES } })
    .select('poNumber supplierName expectedDate items.name items.sku items.quantityOrdered')
    .limit(200);

  const byProduct = new Map();
  for (const po of purchaseOrders) {
    for (const item of po.items) {
      const line = byProduct.get(item.sku);
      if (!line) {
        byProduct.set(item.sku, {
          name: item.name,
          sku: item.sku,
          quantity: item.quantityOrdered,
          supplierName: po.supplierName,
          expectedDate: po.expectedDate,
          orders: 1,
        });
        continue;
      }

      line.quantity += item.quantityOrdered;
      line.orders += 1;
      // Two orders for one paint: the earlier arrival is the one that
      // answers "when does this stop being a problem".
      if (!line.expectedDate || (po.expectedDate && po.expectedDate < line.expectedDate)) {
        line.expectedDate = po.expectedDate;
        line.supplierName = po.supplierName;
      }
    }
  }

  // Dated deliveries first and soonest at the top; undated ones fall to the
  // bottom rather than pretending to be imminent.
  const incomingLines = [...byProduct.values()].sort((a, b) => {
    if (!a.expectedDate && !b.expectedDate) return b.quantity - a.quantity;
    if (!a.expectedDate) return 1;
    if (!b.expectedDate) return -1;
    return new Date(a.expectedDate) - new Date(b.expectedDate);
  });

  res.json({ success: true, data: { incoming: incomingLines } });
});

const detail = asyncHandler(async (req, res) => {
  const po = await loadPo(req.params.id);
  res.json({ success: true, data: { purchaseOrder: po.toJSON() } });
});

const create = asyncHandler(async (req, res) => {
  const po = await purchaseOrderService.createPurchaseOrder({
    supplierId: req.body.supplierId,
    requestedItems: req.body.items,
    expectedDate: req.body.expectedDate || null,
    notes: req.body.notes || '',
    status: req.body.status === PO_STATUS.ORDERED ? PO_STATUS.ORDERED : PO_STATUS.DRAFT,
    createdById: req.user._id,
  });

  res.status(201).json({
    success: true,
    message: `${po.poNumber} created.`,
    data: { purchaseOrder: (await loadPo(po._id)).toJSON() },
  });
});

const markOrdered = asyncHandler(async (req, res) => {
  const po = await purchaseOrderService.markOrdered(await loadPo(req.params.id), req.user._id);
  res.json({
    success: true,
    message: `${po.poNumber} marked as ordered.`,
    data: { purchaseOrder: po.toJSON() },
  });
});

/**
 * POST /api/purchase-orders/:id/receive — the only path that adds stock.
 * The body confirms what actually arrived, line by line.
 */
const receive = asyncHandler(async (req, res) => {
  const po = await purchaseOrderService.receivePurchaseOrder(
    await loadPo(req.params.id),
    req.body.items,
    req.user._id
  );

  res.json({
    success: true,
    message: `${po.poNumber} received. Inventory updated.`,
    data: { purchaseOrder: (await loadPo(po._id)).toJSON() },
  });
});

const cancel = asyncHandler(async (req, res) => {
  const po = await purchaseOrderService.cancelPurchaseOrder(
    await loadPo(req.params.id),
    req.user._id,
    req.body.reason || ''
  );
  res.json({
    success: true,
    message: `${po.poNumber} cancelled.`,
    data: { purchaseOrder: po.toJSON() },
  });
});

/** GET /api/purchase-orders/:id/document.pdf — the sendable document. */
const documentPdf = asyncHandler(async (req, res) => {
  const po = await loadPo(req.params.id);
  const settings = await Setting.get();
  const pdf = await renderPurchaseOrder(po, settings);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${po.poNumber}.pdf"`);
  res.send(pdf);
});

module.exports = {
  list,
  stats,
  incoming,
  detail,
  create,
  markOrdered,
  receive,
  cancel,
  documentPdf,
};
