/**
 * Escapes regex metacharacters so user-supplied search terms can be
 * used safely inside a RegExp (prevents ReDoS / filter injection).
 */
const escapeRegExp = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

module.exports = escapeRegExp;
