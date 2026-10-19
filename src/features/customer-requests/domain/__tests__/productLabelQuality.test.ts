import { describe, expect, it } from 'vitest';
import { customerRequestProductLabelNeedsReview, customerRequestQualityIssues, customerRequestOperationalView } from '../request';
import type { CustomerRequest } from '@/lib/api/customerRequests';

describe('imported request product label quality', () => {
  it.each(['.', '  ...  ', 'صيدليات دواء – تم استلام وتأكيد طلب حضراتكم: (aricept 5)'])('flags ambiguous source text without extracting or rewriting products: %s', (medicine_name) => {
    const request = { medicine_name, source_system: 'dawaawael' } as CustomerRequest;
    expect(customerRequestProductLabelNeedsReview(medicine_name)).toBe(true);
    expect(customerRequestQualityIssues(request)).toContain('اسم الصنف يحتاج مراجعة — نص غير صالح كاسم صنف');
    expect(customerRequestOperationalView(request).product.name).toBe(medicine_name);
  });
  it.each(['GLYCODAL 30 TAB', 'جاست ريج 50 أمبول', 'Vitamin D3', 'Nan AR'])('preserves valid labels: %s', (name) => {
    expect(customerRequestProductLabelNeedsReview(name)).toBe(false);
  });
});
