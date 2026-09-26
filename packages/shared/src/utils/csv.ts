// A tiny, dependency-free CSV parser (W3-4). Handles quoted fields, commas and
// newlines inside quotes, doubled-quote escapes ("" → "), and CRLF/LF line
// endings. It is deliberately small: input is trusted staff-uploaded rosters,
// not arbitrary internet data, so we favour predictability over RFC-completeness.

/**
 * Parse CSV text into a matrix of string cells. Blank trailing lines are
 * dropped. `delimiter` is ',' by default; '\t' reads rows pasted from Excel,
 * ';' the exports of spreadsheets set to a comma-decimal locale.
 */
export function parseCsv(text: string, delimiter = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  // Normalise a leading UTF-8 BOM which spreadsheets often prepend.
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++; // consume the escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      // End the row on LF, or on CR not followed by LF; swallow the LF of a CRLF.
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  // Flush the final field/row if the text did not end with a newline.
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Drop rows that are entirely empty (e.g. a blank line at EOF).
  return rows.filter((r) => !(r.length === 1 && r[0]!.trim() === ''));
}

/**
 * Parse CSV text into records keyed by a normalised header (trimmed,
 * lower-cased). The first non-empty row is the header. Values are trimmed.
 * Rows with more cells than headers ignore the extras; missing cells are ''.
 */
export function parseCsvRecords(text: string): Record<string, string>[] {
  const matrix = parseCsv(text);
  if (matrix.length === 0) return [];
  const headers = matrix[0]!.map((h) => h.trim().toLowerCase());
  const out: Record<string, string>[] = [];
  for (let i = 1; i < matrix.length; i++) {
    const cells = matrix[i]!;
    const rec: Record<string, string> = {};
    headers.forEach((h, idx) => {
      if (h) rec[h] = (cells[idx] ?? '').trim();
    });
    out.push(rec);
  }
  return out;
}

/** The delimiter a pasted or uploaded table most likely uses, from its first line. */
export function guessDelimiter(text: string): ',' | '\t' | ';' {
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  const count = (ch: string) => first.split(ch).length - 1;
  const tabs = count('\t');
  const semis = count(';');
  const commas = count(',');
  if (tabs > 0 && tabs >= commas) return '\t';
  if (semis > commas) return ';';
  return ',';
}

// --- Writing ---------------------------------------------------------------

// A cell a spreadsheet would run as a formula (=, +, -, @, tab, CR first).
const FORMULA_START = /^[=+\-@\t\r]/;
// …unless it is plainly a number or phone number ("+965 5000 0000", "-12.5").
const PLAIN_NUMBER = /^[+-]?[\d\s().,]+$/;

/**
 * One CSV cell. Quoted when it holds a comma, quote or line break; text that
 * Excel would execute as a formula (a creator name like `=HYPERLINK(...)`
 * from an import) gets a leading apostrophe so it is shown, never run.
 */
export function csvCell(v: unknown): string {
  if (v == null) return '';
  let s = typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v);
  if (typeof v === 'string' && FORMULA_START.test(s) && !PLAIN_NUMBER.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * CSV text that opens correctly in Excel: a UTF-8 byte-order mark (without
 * it Excel on Windows reads Arabic with the wrong code page) and CRLF line
 * endings.
 */
export function toCsv(header: string[], rows: unknown[][]): string {
  return '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}
