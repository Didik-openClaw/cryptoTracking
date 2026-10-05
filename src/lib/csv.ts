// CSV export (RFC 4180): fields containing a comma, quote or line break are
// quoted, quotes are doubled, records end with CRLF.

export type CsvCell = string | number | null | undefined;

/**
 * Text a spreadsheet would run as a formula (=, +, @, a leading tab/CR, or a
 * "-" that does not start a number) gets a leading apostrophe, so an exported
 * coin name can never execute in Excel or Sheets. Numbers pass through.
 */
const FORMULA_START = /^(?:[=+@\t\r]|-(?![\d.]))/;

export function csvCell(v: CsvCell): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  const s = FORMULA_START.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rows to CSV text; every record (the last one too) ends with CRLF. */
export function toCsv(rows: CsvCell[][]): string {
  return rows.map((r) => r.map(csvCell).join(',') + '\r\n').join('');
}

/**
 * Save rows as a .csv file in the browser (UTF-8 with BOM so Excel reads
 * non-ASCII text correctly). Returns false where downloads are impossible
 * (tests, server rendering).
 */
/** UTF-8 byte-order mark as bytes: a BOM character in the bundle can make browsers misread an inlined page's encoding. */
const BOM = new Uint8Array([0xef, 0xbb, 0xbf]);

export function downloadCsv(filename: string, header: string[], rows: CsvCell[][]): boolean {
  if (typeof document === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) {
    return false;
  }
  const blob = new Blob([BOM, toCsv([header, ...rows])], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke later: some browsers start reading the blob after click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
  return true;
}

/** "dty-markets-20261004-1405.csv" in the viewer's timezone. */
export function csvFilename(prefix: string, now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${prefix}-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.csv`;
}
