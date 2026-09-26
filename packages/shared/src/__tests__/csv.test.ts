import { describe, expect, it } from 'vitest';
import { csvCell, guessDelimiter, parseCsv, parseCsvRecords, toCsv } from '../utils/csv';

/**
 * W3-4 — the CSV parser behind roster import. It must survive quoted fields
 * with embedded commas/newlines, doubled-quote escapes, CRLF endings, a BOM,
 * and ragged rows, because staff paste real spreadsheet exports.
 */
describe('csv parser', () => {
  it('parses simple rows', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('handles quoted fields with commas, newlines and escaped quotes', () => {
    const text = 'name,note\n"Doe, Jane","line1\nline2"\n"He said ""hi""",ok';
    expect(parseCsv(text)).toEqual([
      ['name', 'note'],
      ['Doe, Jane', 'line1\nline2'],
      ['He said "hi"', 'ok'],
    ]);
  });

  it('strips a BOM and handles CRLF, and drops blank trailing lines', () => {
    const text = '﻿a,b\r\n1,2\r\n';
    expect(parseCsv(text)).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('maps to records by normalised header, trimming values and ignoring extras', () => {
    const text = 'Display Name , Platform ,fitScore\n Alice ,INSTAGRAM, 80 ,extra\nBob,,';
    expect(parseCsvRecords(text)).toEqual([
      { 'display name': 'Alice', platform: 'INSTAGRAM', fitscore: '80' },
      { 'display name': 'Bob', platform: '', fitscore: '' },
    ]);
  });

  it('returns an empty array for empty input', () => {
    expect(parseCsvRecords('')).toEqual([]);
    expect(parseCsv('')).toEqual([]);
  });
});

describe('toCsv / csvCell — Excel-safe output', () => {
  it('starts with a UTF-8 BOM and uses CRLF, so Arabic opens correctly in Excel', () => {
    const csv = toCsv(['الاسم', 'Views'], [['سارة', 1200]]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1)).toBe('الاسم,Views\r\nسارة,1200');
  });

  it('neutralises text a spreadsheet would run as a formula', () => {
    expect(csvCell('=HYPERLINK("http://x","click")')).toBe(`"'=HYPERLINK(""http://x"",""click"")"`);
    expect(csvCell('+cmd|calc')).toBe("'+cmd|calc");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('-2+3+cmd')).toBe("'-2+3+cmd");
  });

  it('leaves numbers and phone numbers alone', () => {
    expect(csvCell(-12.5)).toBe('-12.5');
    expect(csvCell('+965 5000 0000')).toBe('+965 5000 0000');
    expect(csvCell('-1,200')).toBe('"-1,200"');
  });

  it('quotes commas, quotes and both kinds of line break', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line\r\nbreak')).toBe('"line\r\nbreak"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(true)).toBe('true');
  });

  it('round-trips through the parser', () => {
    const csv = toCsv(['a', 'b'], [['x,y', 'multi\nline']]);
    expect(parseCsv(csv)).toEqual([['a', 'b'], ['x,y', 'multi\nline']]);
  });
});

describe('other delimiters (P3.1 — rows pasted from Excel, semicolon exports)', () => {
  it('reads tab-separated rows pasted from Excel', () => {
    const text = 'Order\tDate\tTotal\n#1001\t01/09/2026\t12,500\n';
    expect(guessDelimiter(text)).toBe('\t');
    expect(parseCsv(text, '\t')).toEqual([
      ['Order', 'Date', 'Total'],
      ['#1001', '01/09/2026', '12,500'],
    ]);
  });

  it('reads semicolon exports and keeps quoted semicolons', () => {
    const text = 'Order;Total;Note\n#1;"12,5";"a;b"\n';
    expect(guessDelimiter(text)).toBe(';');
    expect(parseCsv(text, ';')[1]).toEqual(['#1', '12,5', 'a;b']);
  });

  it('falls back to commas', () => {
    expect(guessDelimiter('Order,Date,Total')).toBe(',');
    expect(guessDelimiter('')).toBe(',');
  });
});
