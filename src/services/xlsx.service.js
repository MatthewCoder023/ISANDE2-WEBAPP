const ExcelJS = require('exceljs');
const Setting = require('../models/Setting');

/**
 * Branded, locked spreadsheets for staff data exports.
 *
 * Be clear about what "locked" buys: worksheet protection is a convention,
 * not security. Excel honours it, but the password is trivially stripped by
 * anyone determined, and the format is openly documented. It stops casual
 * edits and accidental overwrites — nothing more. When a figure must be
 * provably untouched, send the PDF, whose verification code is checked
 * against the server.
 *
 * CSV exports are deliberately left exactly as they were, for anyone who
 * wants the raw rows to analyse.
 */

const HEADER_FILL = 'FF4F46E5';
const TITLE_SIZE = 14;

/**
 * @param {object} spec
 * @param {string} spec.title      Document heading, e.g. "Transactions"
 * @param {string} spec.subtitle   Range or filter description
 * @param {string[]} spec.headers
 * @param {Array<Array<*>>} spec.rows
 * @param {Array<{ width: number, numFmt?: string }>} spec.columns
 * @param {string} [spec.password] Protection password; random when omitted
 */
async function buildWorkbook({ title, subtitle, headers, rows, columns, password }) {
  const settings = await Setting.get();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = settings.shopName || 'Flavor & Color';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(title, {
    views: [{ state: 'frozen', ySplit: 4 }],
  });

  sheet.columns = columns.map((c) => ({ width: c.width }));

  // Branded heading block above the table.
  sheet.mergeCells(1, 1, 1, headers.length);
  const shopCell = sheet.getCell(1, 1);
  shopCell.value = settings.shopName || 'Flavor & Color';
  shopCell.font = { size: TITLE_SIZE, bold: true, color: { argb: 'FF0F172A' } };

  sheet.mergeCells(2, 1, 2, headers.length);
  const titleCell = sheet.getCell(2, 1);
  titleCell.value = `${title}${subtitle ? ` — ${subtitle}` : ''}`;
  titleCell.font = { size: 10, color: { argb: 'FF5B6474' } };

  sheet.mergeCells(3, 1, 3, headers.length);
  const stampCell = sheet.getCell(3, 1);
  stampCell.value = `Generated ${new Date().toLocaleString('en-PH')} · ${settings.addressLine || ''}`;
  stampCell.font = { size: 9, italic: true, color: { argb: 'FF8B93A5' } };

  const headerRow = sheet.getRow(4);
  headerRow.values = headers;
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
  headerRow.alignment = { vertical: 'middle' };
  headerRow.height = 20;

  for (const row of rows) sheet.addRow(row);

  // Money and date formats, applied to the data rows only.
  columns.forEach((column, index) => {
    if (!column.numFmt) return;
    sheet.getColumn(index + 1).numFmt = column.numFmt;
  });

  sheet.autoFilter = {
    from: { row: 4, column: 1 },
    to: { row: 4, column: headers.length },
  };

  // Everything is locked; nothing is marked unlocked, so the sheet is
  // read-only in Excel while still sortable and filterable.
  await sheet.protect(password || Math.random().toString(36).slice(2), {
    selectLockedCells: true,
    selectUnlockedCells: true,
    autoFilter: true,
    sort: true,
  });

  return workbook.xlsx.writeBuffer();
}

/** Sets download headers and sends the workbook. */
function sendXlsx(res, filenameBase, buffer) {
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}-${stamp}.xlsx"`);
  res.send(Buffer.from(buffer));
}

module.exports = { buildWorkbook, sendXlsx };
