import { describe, expect, it } from 'vitest';
import { extractCustomerHintFromExportFileName } from '@/lib/whatsappExportCustomerHint';

describe('extractCustomerHintFromExportFileName', () => {
  it('extracts Arabic customer name and trailing Arabic-indic code from zip filename', () => {
    const result = extractCustomerHintFromExportFileName('ابراهيم الصياد ٣٤٣.zip');
    expect(result.nameHint).toBe('ابراهيم الصياد');
    expect(result.codeHint).toBe('343');
    expect(result.source).toBe('file_name');
  });

  it('extracts a customer code attached directly to the Arabic name', () => {
    const result = extractCustomerHintFromExportFileName('محمد الكموني17777.zip');
    expect(result.nameHint).toBe('محمد الكموني');
    expect(result.codeHint).toBe('17777');
  });

  it('ignores a browser copy suffix after the real customer code', () => {
    const result = extractCustomerHintFromExportFileName('محمد الكموني17777(1).zip');
    expect(result.nameHint).toBe('محمد الكموني');
    expect(result.codeHint).toBe('17777');
  });

  it('handles Arabic-indic codes plus a copy suffix', () => {
    const result = extractCustomerHintFromExportFileName('ابراهيم الصياد ٣٦٤٣(5).zip');
    expect(result.nameHint).toBe('ابراهيم الصياد');
    expect(result.codeHint).toBe('3643');
  });

  it('removes common WhatsApp export prefixes', () => {
    const result = extractCustomerHintFromExportFileName('WhatsApp Chat with محمد طارق 1200.txt');
    expect(result.nameHint).toBe('محمد طارق');
    expect(result.codeHint).toBe('1200');
  });

  it('does not invent a customer from a generic technical filename', () => {
    const result = extractCustomerHintFromExportFileName('whatsapp.zip');
    expect(result.nameHint).toBeNull();
  });
});
