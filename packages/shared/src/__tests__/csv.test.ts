import { describe, expect, it } from 'vitest';
import { parseCsv, parseCsvRecords } from '../utils/csv';

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
