/*
 * Reads a Padlet export and returns its posts.
 *
 * Accepts the bytes of: the zip Padlet downloads, a Posts CSV on its own, or the Excel export.
 * Returns { ok: true, posts, ... } or { ok: false, code, message } with a message a teacher can
 * act on. It never throws and never guesses.
 *
 * The Posts table is recognised by its shape, never by header words or file names, because
 * Padlet translates both (DECISIONS.md D28):
 *   - its first row has 7 columns, or 8 when the board has sections;
 *   - every other row has the same number of columns as the first (D36);
 *   - counted from the END, the author is 3rd from last, the body 5th, the title 6th.
 *
 * Plain script, no build step: in the browser it adds to the global `WhoWroteThis` and expects
 * the globals `fflate` and `XLSX` (vendor/); in Node it is loaded with require().
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../vendor/fflate.js'), require('../vendor/xlsx.mini.min.js'));
  } else {
    root.WhoWroteThis = Object.assign(root.WhoWroteThis || {}, factory(root.fflate, root.XLSX));
  }
})(typeof self !== 'undefined' ? self : this, function (fflate, XLSX) {
  'use strict';

  // ---- The numbers that define the format and the limits. Change them here. ----
  var POSTS_COLUMN_COUNTS = [7, 8]; // 8 = a board with sections
  var AUTHOR_FROM_END = 3;
  var BODY_FROM_END = 5;
  var TITLE_FROM_END = 6;
  var MAX_FILE_BYTES = 25 * 1024 * 1024; // the file as dropped in (D36)
  var MAX_UNPACKED_BYTES = 100 * 1024 * 1024; // everything inside a zip or Excel file (D36)
  var MAX_NAME_IN_MESSAGE = 60; // file and sheet names are cut to this length in messages

  var HOW_TO_EXPORT = 'In Padlet, choose Share > Export CSV and drop in the zip it downloads.';
  var FRESH_EXPORT = 'It may have been edited after export. Download a fresh export from Padlet and try again.';

  function fail(code, message) {
    return { ok: false, code: code, message: message };
  }

  function startsWith(bytes, signature) {
    if (bytes.length < signature.length) return false;
    for (var i = 0; i < signature.length; i++) {
      if (bytes[i] !== signature[i]) return false;
    }
    return true;
  }

  function megabytes(byteCount) {
    return (byteCount / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function plural(count, word) {
    return count + ' ' + word + (count === 1 ? '' : 's');
  }

  // A file or sheet name, quoted and cut short, for use inside a message.
  function quoted(name) {
    var text = String(name);
    if (text.length > MAX_NAME_IN_MESSAGE) text = text.slice(0, MAX_NAME_IN_MESSAGE) + '…';
    return '"' + text + '"';
  }

  // Bytes -> text, or null if the bytes are not UTF-8. A leading byte-order mark is removed here.
  function decodeUtf8(bytes) {
    var text;
    try {
      text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch (e) {
      return null;
    }
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  }

  /*
   * A worksheet -> a table: { columns, rows } or { unevenRow }.
   *   columns   = how many cells the first row (the header) has.
   *   rows      = every non-blank row as plain text cells, each exactly `columns` long.
   *   unevenRow = the first row whose last filled cell is not in the header's last column,
   *               as { number, columns }. `number` is the row as a spreadsheet shows it (header = 1).
   * A row that is completely blank is skipped.
   */
  function sheetToTable(sheet) {
    var raw = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, blankrows: true });
    var columns = 0;
    var rows = [];
    for (var i = 0; i < raw.length; i++) {
      var cells = Array.from(raw[i], function (cell) { return cell == null ? '' : String(cell); });
      if (cells.length === 0) continue;
      if (columns === 0) columns = cells.length;
      if (cells.length !== columns) return { unevenRow: { number: i + 1, columns: cells.length }, columns: columns };
      rows.push(cells);
    }
    return { columns: columns, rows: rows };
  }

  // CSV text -> a table (see sheetToTable), or null if it cannot be read as a table at all.
  function csvToTable(text) {
    // In a CSV every quote mark comes in a pair. An odd count means a quote was never closed,
    // which would swallow the rows after it into one cell.
    if ((text.split('"').length - 1) % 2 === 1) return { unclosedQuote: true, columns: 0 };
    try {
      var book = XLSX.read(text, { type: 'string', raw: true, FS: ',' });
      return sheetToTable(book.Sheets[book.SheetNames[0]]);
    } catch (e) {
      return null;
    }
  }

  function hasPostsShape(table) {
    return table !== null && POSTS_COLUMN_COUNTS.indexOf(table.columns) !== -1;
  }

  // A table that has the Posts shape -> the result, or the reason one of its rows stops us.
  function tableToResult(table, kind, name) {
    if (table.unevenRow) {
      return fail('uneven-row',
        'Row ' + table.unevenRow.number + ' has ' + plural(table.unevenRow.columns, 'column') +
        ', but this file has ' + table.columns + '. ' + FRESH_EXPORT);
    }
    var posts = [];
    for (var i = 1; i < table.rows.length; i++) { // row 0 is the header: skipped, never read
      var row = table.rows[i];
      posts.push({
        row: i,
        number: row[0],
        title: row[table.columns - TITLE_FROM_END],
        body: row[table.columns - BODY_FROM_END],
        author: row[table.columns - AUTHOR_FROM_END]
      });
    }
    return { ok: true, kind: kind, tableName: name, columnCount: table.columns, posts: posts };
  }

  function unclosedQuoteFailure() {
    return fail('unclosed-quote',
      'This file has a quote mark (") that is never closed, so the rows after it can\'t be told apart. ' +
      FRESH_EXPORT);
  }

  function describeTables(tables) {
    return tables.map(function (t) {
      if (t.table === null) return quoted(t.name) + ' (could not be read as a table)';
      if (t.table.unclosedQuote) return quoted(t.name) + ' (has a quote mark that is never closed)';
      return quoted(t.name) + ' with ' + plural(t.table.columns, 'column');
    }).join('; ');
  }

  // Several named tables (CSV files in a zip, or sheets in a workbook) -> the one Posts table.
  function pickPostsTable(tables, kind, containerWord) {
    var candidates = tables.filter(function (t) { return hasPostsShape(t.table); });
    if (candidates.length === 1) return tableToResult(candidates[0].table, kind, candidates[0].name);
    if (candidates.length === 0) {
      return fail('no-posts-table',
        'Nothing in this ' + containerWord + ' looks like Padlet\'s Posts table, which has 7 or 8 columns. ' +
        'Found: ' + describeTables(tables) + '. ' + HOW_TO_EXPORT);
    }
    return fail('several-posts-tables',
      'More than one table in this ' + containerWord + ' could be the Posts table: ' +
      describeTables(candidates) + '. Drop in the one Posts file on its own.');
  }

  // Lists what a zip holds without unpacking it. Returns null if the zip cannot be opened.
  function listZip(bytes) {
    var entries = [];
    try {
      fflate.unzipSync(bytes, {
        filter: function (file) {
          entries.push({ name: file.name, unpackedSize: file.originalSize });
          return false;
        }
      });
    } catch (e) {
      return null;
    }
    return entries;
  }

  function isFolderOrJunk(name) {
    var baseName = name.split('/').pop();
    return name.charAt(name.length - 1) === '/' || name.indexOf('__MACOSX/') !== -1 || baseName.indexOf('._') === 0;
  }

  function damagedZip() {
    return fail('damaged-zip', 'This zip file is damaged and can\'t be opened. Export it from Padlet again.');
  }

  function readExcel(bytes) {
    var book;
    try {
      book = XLSX.read(bytes, { type: 'array' });
    } catch (e) {
      return fail('damaged-excel', 'This Excel file is damaged and can\'t be opened. Export it from Padlet again.');
    }
    var tables = book.SheetNames.map(function (name) {
      return { name: name, table: sheetToTable(book.Sheets[name]) };
    });
    return pickPostsTable(tables, 'excel', 'Excel file');
  }

  function readZip(bytes) {
    var entries = listZip(bytes);
    if (entries === null) return damagedZip();
    var unpackedTotal = entries.reduce(function (sum, e) { return sum + e.unpackedSize; }, 0);
    if (unpackedTotal > MAX_UNPACKED_BYTES) {
      return fail('too-large-unpacked',
        'This file unpacks to ' + megabytes(unpackedTotal) + '. The most this page reads is ' +
        megabytes(MAX_UNPACKED_BYTES) + '.');
    }
    var names = entries.map(function (e) { return e.name; });

    // An Excel file is itself a zip, so it can only be told apart by what is inside it.
    if (names.indexOf('[Content_Types].xml') !== -1) {
      if (names.indexOf('xl/workbook.xml') !== -1) return readExcel(bytes);
      return fail('office-not-excel', 'This is an Office document, not a spreadsheet. ' + HOW_TO_EXPORT);
    }

    var csvNames = names.filter(function (name) {
      return !isFolderOrJunk(name) && /\.csv$/i.test(name);
    });
    if (csvNames.length === 0) {
      var shown = names.filter(function (name) { return !isFolderOrJunk(name); });
      var listed = shown.slice(0, 5).map(quoted).join(', ');
      if (shown.length > 5) listed += ' and ' + (shown.length - 5) + ' more';
      return fail('zip-without-csv',
        'This zip has no CSV files in it, so it is not a Padlet export. It holds ' +
        (shown.length === 0 ? 'no files' : listed) + '. ' + HOW_TO_EXPORT);
    }

    var unpacked;
    try {
      unpacked = fflate.unzipSync(bytes, {
        filter: function (file) { return csvNames.indexOf(file.name) !== -1; }
      });
    } catch (e) {
      return damagedZip();
    }
    var tables = csvNames.map(function (name) {
      var text = decodeUtf8(unpacked[name]);
      return { name: name, table: text === null ? null : csvToTable(text) };
    });
    var posts = tables.filter(function (t) { return hasPostsShape(t.table); });
    var broken = tables.filter(function (t) { return t.table !== null && t.table.unclosedQuote; });
    if (posts.length === 0 && broken.length > 0) return unclosedQuoteFailure();
    return pickPostsTable(tables, 'zip', 'zip');
  }

  function readCsv(bytes) {
    var text = decodeUtf8(bytes);
    if (text === null) {
      return fail('not-utf8',
        'This file is not a zip, an Excel file or a CSV saved as UTF-8 text, so it can\'t be read. ' +
        'If you saved the CSV from a spreadsheet, save it again as "CSV UTF-8". ' + HOW_TO_EXPORT);
    }
    if (text.trim() === '') {
      return fail('empty', 'This file has no rows in it. ' + HOW_TO_EXPORT);
    }
    var table = csvToTable(text);
    if (table === null || (!table.unclosedQuote && table.columns === 0)) {
      return fail('not-a-table', 'This file could not be read as a table, so it is not a Padlet export. ' + HOW_TO_EXPORT);
    }
    if (table.unclosedQuote) return unclosedQuoteFailure();
    if (!hasPostsShape(table)) {
      return fail('wrong-columns',
        'This file has ' + plural(table.columns, 'column') + '. Padlet\'s Posts table has 7 or 8. ' +
        (table.columns === 2
          ? 'It may be the Summary file: pick the other, larger CSV from the zip, or drop in the whole zip.'
          : HOW_TO_EXPORT));
    }
    return tableToResult(table, 'csv', '');
  }

  /**
   * @param {Uint8Array} bytes the file as dropped in
   * @returns {{ok: true, kind: 'zip'|'csv'|'excel', tableName: string, columnCount: number,
   *            posts: Array<{row: number, number: string, title: string, body: string, author: string}>}
   *          | {ok: false, code: string, message: string}}
   */
  function readExport(bytes) {
    if (!(bytes instanceof Uint8Array)) {
      return fail('not-a-file', 'That could not be read as a file. ' + HOW_TO_EXPORT);
    }
    if (bytes.length === 0) {
      return fail('empty', 'This file is empty. ' + HOW_TO_EXPORT);
    }
    if (bytes.length > MAX_FILE_BYTES) {
      return fail('too-large',
        'This file is ' + megabytes(bytes.length) + '. The largest file this page reads is ' +
        megabytes(MAX_FILE_BYTES) + '.');
    }
    if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) { // "%PDF"
      return fail('pdf', 'This is a PDF, which can\'t be read. ' + HOW_TO_EXPORT);
    }
    if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0])) { // Excel 97-2003 and other old Office files
      return fail('old-office',
        'This is an old-style Office file (.xls or similar), which can\'t be read. ' + HOW_TO_EXPORT);
    }
    // A zip (which includes Excel .xlsx) starts with "PK" and then one of these two byte pairs.
    // Plain text that merely starts with the letters "PK" does not.
    if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06])) {
      return readZip(bytes);
    }
    return readCsv(bytes);
  }

  return {
    readExport: readExport,
    limits: { MAX_FILE_BYTES: MAX_FILE_BYTES, MAX_UNPACKED_BYTES: MAX_UNPACKED_BYTES }
  };
});
