import { describe, expect, it } from 'vitest';
import { buildIndex, searchCatalog, skeleton, splitQuantity } from '../productSearch';

const index = buildIndex([
  { code: '1001', name: 'PANADOL EXTRA 24 TAB', price: 60, sold: 300 },
  { code: '1002', name: 'PANADOL ADVANCE 24 TAB', price: 55, sold: 120 },
  { code: '1003', name: 'PANADOL COLD & FLU', price: 70, sold: 10 },
  { code: '2001', name: 'CATAFLAM 50MG 20 TAB', price: 48, sold: 90 },
  { code: '3001', name: 'ALPHINTERN 30 TAB', price: 90, sold: 40 },
  { code: '3002', name: 'ALFAINTERN 30 TAB', price: 85, sold: 5 },
  { code: '4001', name: 'AUGMENTIN 1GM 14 TAB', price: 120, sold: 200 },
  { code: '5001', name: 'كريم بيبانثين', price: 40, sold: 2 },
  { code: '10015', name: 'CONCOR 5MG 30 TAB', price: 80, sold: 60 },
]);
const names = (q: string) => searchCatalog(index, q).map((r) => r.name);

describe('searching the catalog', () => {
  it('finds a code exactly first, then codes starting with it', () => {
    expect(names('1001')[0]).toBe('PANADOL EXTRA 24 TAB');
    expect(names('١٠٠١')[0]).toBe('PANADOL EXTRA 24 TAB');
    expect(names('100')).toContain('CONCOR 5MG 30 TAB');
  });

  it('matches English words in any order', () => {
    expect(names('extra pana')).toEqual(['PANADOL EXTRA 24 TAB']);
    expect(names('panadol')[0]).toBe('PANADOL EXTRA 24 TAB');
    expect(names('augmntin')[0]).toBe('AUGMENTIN 1GM 14 TAB');
  });

  it('finds the Latin name from its Arabic spelling', () => {
    expect(skeleton('بانادول')).toBe(skeleton('PANADOL'));
    expect(names('بانادول')[0]).toMatch(/^PANADOL/);
    expect(names('كتافلام')[0]).toBe('CATAFLAM 50MG 20 TAB');
    expect(names('اوجمنتين')[0]).toBe('AUGMENTIN 1GM 14 TAB');
    expect(names('بانادول اكسترا')[0]).toBe('PANADOL EXTRA 24 TAB');
  });

  it('lets * stand for the letters she is not sure of', () => {
    expect(names('الف*ن*رن')).toEqual(expect.arrayContaining(['ALPHINTERN 30 TAB', 'ALFAINTERN 30 TAB']));
    expect(names('pan*ext')).toEqual(['PANADOL EXTRA 24 TAB']);
    expect(names('بيبان*')[0]).toBe('كريم بيبانثين');
  });

  it('puts the item sold more often first when matches are equal', () => {
    expect(names('alphintern alfaintern'.split(' ')[0])[0]).toBe('ALPHINTERN 30 TAB');
    expect(names('*intern')[0]).toBe('ALPHINTERN 30 TAB');
  });

  it('ignores one letter and reads a quantity written after the name', () => {
    expect(names('p')).toEqual([]);
    expect(splitQuantity('بانادول x2')).toEqual({ query: 'بانادول', qty: 2 });
    expect(splitQuantity('panadol ×٣')).toEqual({ query: 'panadol', qty: 3 });
    expect(splitQuantity('كونكور 5')).toEqual({ query: 'كونكور 5', qty: null });
  });
});
