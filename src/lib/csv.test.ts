import { describe, expect, it } from 'vitest';
import { csvCell, csvFilename, downloadCsv, toCsv } from './csv';

describe('toCsv', () => {
  it('joins fields with commas and ends every record with CRLF', () => {
    expect(
      toCsv([
        ['coin', 'px'],
        ['BTC', 61840.5],
      ]),
    ).toBe('coin,px\r\nBTC,61840.5\r\n');
  });

  it('returns an empty string for no rows', () => {
    expect(toCsv([])).toBe('');
  });

  it('quotes fields with commas, quotes and line breaks (RFC 4180)', () => {
    expect(toCsv([['a,b', 'say "hi"', 'line1\nline2', 'cr\r']])).toBe('"a,b","say ""hi""","line1\nline2","cr\r"\r\n');
  });

  it('leaves plain text, spaces and unicode unquoted', () => {
    expect(toCsv([['Long HL / Short Binance', 'Rp 1.000', 'Ünïcode']])).toBe('Long HL / Short Binance,Rp 1.000,Ünïcode\r\n');
  });

  it('writes null, undefined and non-finite numbers as empty fields', () => {
    expect(toCsv([[null, undefined, NaN, Infinity, 0, -1.5]])).toBe(',,,,0,-1.5\r\n');
  });

  it('keeps empty strings as empty fields', () => {
    expect(toCsv([['', 'x', '']])).toBe(',x,\r\n');
  });
});

describe('csvCell', () => {
  it('neutralises spreadsheet formulas in text', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1+2')).toBe("'+1+2");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('-cmd')).toBe("'-cmd");
  });

  it('does not touch numbers or numeric text', () => {
    expect(csvCell(-0.25)).toBe('-0.25');
    expect(csvCell('-0.25')).toBe('-0.25');
    expect(csvCell('-.5')).toBe('-.5');
    expect(csvCell(1e-7)).toBe('1e-7');
  });
});

describe('downloadCsv', () => {
  it('is a no-op outside the browser', () => {
    expect(downloadCsv('x.csv', ['a'], [[1]])).toBe(false);
  });
});

describe('csvFilename', () => {
  it('stamps the local date and time', () => {
    expect(csvFilename('dty-markets', new Date(2026, 9, 4, 9, 5))).toBe('dty-markets-20261004-0905.csv');
  });
});
