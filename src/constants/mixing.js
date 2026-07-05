/** Central paint-mixing definitions. */
const MIX_STATUS = Object.freeze({
  QUEUED: 'queued', // waiting for the mixer
  MIXING: 'mixing', // on the bench
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
});

/** Units a formula component can be measured in. */
const FORMULA_UNITS = Object.freeze(['mL', 'g', 'parts', 'drops']);

module.exports = { MIX_STATUS, FORMULA_UNITS };
