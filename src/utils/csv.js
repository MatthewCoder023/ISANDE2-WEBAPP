/** Minimal CSV builder with RFC 4180-style escaping. */

function csvEscape(value) {
  const str = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

/**
 * @param {string[]} headers
 * @param {Array<Array<*>>} rows
 * @returns CSV text with a BOM so Excel opens it as UTF-8.
 */
function toCsv(headers, rows) {
  const lines = [headers, ...rows].map((row) => row.map(csvEscape).join(','));
  return `﻿${lines.join('\r\n')}`;
}

/** Sets download headers and sends the CSV. */
function sendCsv(res, filenameBase, csv) {
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}-${stamp}.csv"`);
  res.send(csv);
}

module.exports = { toCsv, sendCsv };
