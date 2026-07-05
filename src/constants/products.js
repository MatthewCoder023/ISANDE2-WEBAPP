/**
 * Central product-domain definitions. UI dropdowns, validators, and
 * schemas all derive from these — never hard-code category strings.
 */
const PRODUCT_CATEGORIES = Object.freeze({
  INTERIOR: 'interior',
  EXTERIOR: 'exterior',
  PRIMER: 'primer',
  ENAMEL: 'enamel',
  SPRAY: 'spray',
  SUPPLIES: 'supplies',
});

const CATEGORY_VALUES = Object.freeze(Object.values(PRODUCT_CATEGORIES));

const CATEGORY_LABELS = Object.freeze({
  [PRODUCT_CATEGORIES.INTERIOR]: 'Interior Paint',
  [PRODUCT_CATEGORIES.EXTERIOR]: 'Exterior Paint',
  [PRODUCT_CATEGORIES.PRIMER]: 'Primers & Sealers',
  [PRODUCT_CATEGORIES.ENAMEL]: 'Enamel & Wood/Metal',
  [PRODUCT_CATEGORIES.SPRAY]: 'Spray Paint',
  [PRODUCT_CATEGORIES.SUPPLIES]: 'Tools & Supplies',
});

/** Used when auto-generating SKUs, e.g. FC-INT-4821. */
const SKU_PREFIXES = Object.freeze({
  [PRODUCT_CATEGORIES.INTERIOR]: 'INT',
  [PRODUCT_CATEGORIES.EXTERIOR]: 'EXT',
  [PRODUCT_CATEGORIES.PRIMER]: 'PRM',
  [PRODUCT_CATEGORIES.ENAMEL]: 'ENM',
  [PRODUCT_CATEGORIES.SPRAY]: 'SPR',
  [PRODUCT_CATEGORIES.SUPPLIES]: 'SUP',
});

const FINISHES = Object.freeze(['flat', 'matte', 'eggshell', 'satin', 'semi-gloss', 'gloss']);

const SIZES = Object.freeze(['250mL', '500mL', '1L', '4L', '16L']);

const MOVEMENT_TYPES = Object.freeze({
  INITIAL: 'initial', // starting quantity recorded at product creation
  RESTOCK: 'restock', // supplier delivery, always positive
  ADJUSTMENT: 'adjustment', // manual correction (damage, count fix), signed
  SALE: 'sale', // stock reserved/sold through an order
  RETURN: 'return', // stock restored (order cancelled or reservation rolled back)
});

module.exports = {
  PRODUCT_CATEGORIES,
  CATEGORY_VALUES,
  CATEGORY_LABELS,
  SKU_PREFIXES,
  FINISHES,
  SIZES,
  MOVEMENT_TYPES,
};
