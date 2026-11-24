import { describe, expect, it } from 'vitest';
import { extractCustomerHintFromExportFileName } from '@/lib/whatsappExportCustomerHint';

// Branch export names: customer code plus the agreed price limit ("p.150", "P.250", "p550").
const cases: Array<[string, string]> = [
  ['9334 دعاء عودة P.200.zip', '9334'],
  ['احمد عيسي 8526 P.250.zip', '8526'],
  ['ام خالد 8870 p.100.zip', '8870'],
  ['حنان محمد محمد 13058  p.150.zip', '13058'],
  ['د ايه خليل 283 p.100.zip', '283'],
  ['دعاء مصطفي ٩٤٧١ دعاء مصطفي 9471  P.100.zip', '9471'],
  ['رانيا سمير 16739 P.50.zip', '16739'],
  ['ساره ابراهيم 10244تبع عمرو فيصل _ p.250.zip', '10244'],
  ['مازن محمد10398 p.300.zip', '10398'],
  ['محمد السيد p.550 16063.zip', '16063'],
  ['محمد مندور 11810 p550.zip', '11810'],
  ['نانسي الامام1397  P.100.zip', '1397'],
  ['ندى منتصر 11298 p.150 ندي منتصر 11298.zip', '11298'],
  ['هاجر المسيرى 11393 هاجر المسيري 11393 (مفيش خصم ) p.145.zip', '11393'],
  ['ولاء الشحات ١١٥٢٦(توصيل سريع _) p.300.zip', '11526'],
];

const priceNotes = new Set(['50', '100', '145', '150', '200', '250', '300', '350', '400', '450', '550']);

describe('price notes in branch export file names', () => {
  it.each(cases)('%s → never the price note', (file, code) => {
    const hint = extractCustomerHintFromExportFileName(file);
    expect(priceNotes.has(String(hint.codeHint))).toBe(false);
    expect(hint.codeHint).toBe(code);
  });
});
