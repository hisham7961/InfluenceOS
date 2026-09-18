// A tiny, dependency-free CSV parser (W3-4). Handles quoted fields, commas and
// newlines inside quotes, doubled-quote escapes ("" → "), and CRLF/LF line
// endings. It is deliberately small: input is trusted staff-uploaded rosters,
// not arbitrary internet data, so we favour predictability over RFC-completeness.

/** Parse CSV text into a matrix of string cells. Blank trailing lines are dropped. */
export function parseCsv(text: string): string[][] {
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
    } else if (c === ',') {
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
