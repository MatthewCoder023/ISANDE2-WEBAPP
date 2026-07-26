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

/**
 * Builds a sectioned CSV — a document rather than a bare table.
 *
 * A flat table cannot carry what an invoice shows: who it is for, what it
 * totals, which order it belongs to. Sections give that context while
 * staying valid CSV that any spreadsheet opens. Formatting and branding
 * genuinely cannot survive this format; that is what the PDF is for.
 *
 * @param {Array<{ title?: string, headers?: string[], rows: Array<Array<*>> }>} sections
 */
function toSectionedCsv(sections) {
  const lines = [];

  for (const [index, section] of sections.entries()) {
    if (index > 0) lines.push('');
    if (section.title) lines.push([section.title.toUpperCase()].map(csvEscape).join(','));
    if (section.headers) lines.push(section.headers.map(csvEscape).join(','));
    for (const row of section.rows) lines.push(row.map(csvEscape).join(','));
  }

  return `﻿${lines.join('\r\n')}`;
}

/** Sets download headers and sends the CSV. */
function sendCsv(res, filenameBase, csv) {
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}-${stamp}.csv"`);
  res.send(csv);
}

module.exports = { toCsv, toSectionedCsv, sendCsv };
