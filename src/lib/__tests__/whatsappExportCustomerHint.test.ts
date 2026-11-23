import { describe, expect, it } from 'vitest';
import { extractTrailingCustomerCodeFromDisplayName } from '@/lib/customers/customerIdentity';
import { extractCustomerHintFromExportFileName } from '@/lib/whatsappExportCustomerHint';

describe('extractCustomerHintFromExportFileName', () => {
  it('extracts Arabic customer name and trailing Arabic-indic code from zip filename', () => {
    const result = extractCustomerHintFromExportFileName('ابراهيم الصياد ٣٤٣.zip');
    expect(result.nameHint).toBe('ابراهيم الصياد');
    expect(result.codeHint).toBe('343');
    expect(result.source).toBe('file_name');
  });

  it('removes common WhatsApp export prefixes', () => {
    const result = extractCustomerHintFromExportFileName('WhatsApp Chat with محمد طارق 1200.txt');
    expect(result.nameHint).toBe('محمد طارق');
    expect(result.codeHint).toBe('1200');
  });

  it('ignores explicit price notes both before and after the customer code', () => {
    expect(extractCustomerHintFromExportFileName('عميل تجريبي 54321 p.150.zip').codeHint).toBe('54321');
    expect(extractCustomerHintFromExportFileName('عميل اختبار p.٥٥٠ 87654.zip').codeHint).toBe('87654');
    expect(extractTrailingCustomerCodeFromDisplayName('عميل تجريبي 54321 p.150')).toBe('54321');
    expect(extractTrailingCustomerCodeFromDisplayName('عميل تجريبي p.150')).toBe('');
  });

  it('does not invent a customer from a generic technical filename', () => {
    const result = extractCustomerHintFromExportFileName('whatsapp.zip');
    expect(result.nameHint).toBeNull();
  });
});
