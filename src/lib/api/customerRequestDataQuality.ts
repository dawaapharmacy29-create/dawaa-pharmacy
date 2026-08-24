import { supabase } from '@/lib/supabase';
import { normalizePhone, searchCustomers, type CustomerSearchResult } from '@/lib/customerSearch';
import { searchProductsCatalogSmart, type CatalogProduct } from '@/lib/api/productsCatalog';
import { confidentUniqueProductMatch, normalizeProductCode, normalizeProductName, scoreProductCandidate } from '@/lib/productMatching';
import type { CustomerRequest } from '@/lib/api/customerRequests';

export type RequestDataQuality = {
  customerCandidate: CustomerSearchResult | null;
  productCandidate: CatalogProduct | null;
  productMatchScore: number;
  productMatchLabel: string;
  customerIssues: string[];
  productIssues: string[];
  branchConflict: boolean;
};

export async function inspectCustomerRequestDataQuality(request: CustomerRequest & { product_id?: string | null; product_code?: string | null }) : Promise<RequestDataQuality> {
  const customerIssues: string[] = [];
  const productIssues: string[] = [];

  if (!request.customer_id) customerIssues.push('الطلب غير مربوط بسجل عميل');
  if (!String(request.customer_code || '').trim()) customerIssues.push('كود العميل غير موجود');
  if (!normalizePhone(request.customer_phone)) customerIssues.push('رقم الهاتف غير موجود أو غير صالح');
  if (!String(request.branch || '').trim()) customerIssues.push('الفرع غير محدد');

  let customerCandidate: CustomerSearchResult | null = null;
  const customerQuery = String(request.customer_code || request.customer_phone || request.customer_name || '').trim();
  if (customerQuery) {
    const results = await searchCustomers(customerQuery, 20);
    const code = String(request.customer_code || '').trim();
    const phone = normalizePhone(request.customer_phone);
    customerCandidate = results.find((item) =>
      (code && String(item.code || '').trim() === code)
      || (phone && normalizePhone(item.phone) === phone)
      || (request.customer_id && item.id === request.customer_id)
    ) || null;
  }

  if (customerCandidate && request.customer_id && customerCandidate.id !== request.customer_id) {
    customerIssues.push('معرّف العميل لا يطابق الكود/الهاتف الحالي');
  }
  if (customerCandidate && request.customer_code && customerCandidate.code && String(customerCandidate.code) !== String(request.customer_code)) {
    customerIssues.push('كود العميل في الطلب مختلف عن سجل العميل');
  }
  if (customerCandidate && request.customer_phone && customerCandidate.phone && normalizePhone(customerCandidate.phone) !== normalizePhone(request.customer_phone)) {
    customerIssues.push('هاتف العميل في الطلب مختلف عن سجل العميل');
  }
  const branchConflict = Boolean(customerCandidate?.branch && request.branch && customerCandidate.branch !== request.branch);
  if (branchConflict) customerIssues.push(`فرع الطلب (${request.branch}) مختلف عن فرع العميل (${customerCandidate?.branch})`);

  const requestWithProduct = request as CustomerRequest & { product_id?: string | null; product_code?: string | null };
  const requestCode = normalizeProductCode(requestWithProduct.product_code);
  const requestName = String(request.medicine_name || '').trim();
  if (!requestWithProduct.product_id) productIssues.push('الصنف غير مربوط بكتالوج الأصناف');
  if (!requestCode) productIssues.push('كود الصنف غير موجود');
  if (!requestName) productIssues.push('اسم الصنف غير موجود');

  let productCandidate: CatalogProduct | null = null;
  let productMatchScore = 0;
  let productMatchLabel = 'لا يوجد تطابق مؤكد';
  const productQuery = requestCode || requestName;
  if (productQuery) {
    const products = await searchProductsCatalogSmart(productQuery, 30);
    if (requestCode) {
      const exact = products.find((item) => normalizeProductCode(item.code) === requestCode);
      if (exact) {
        productCandidate = exact;
        productMatchScore = 100;
        productMatchLabel = 'تطابق كود مؤكد';
      }
    } else {
      const confident = confidentUniqueProductMatch({ name: requestName }, products);
      if (confident) {
        productCandidate = confident.product;
        productMatchScore = confident.score;
        productMatchLabel = confident.label;
      } else if (products[0]) {
        productMatchScore = products[0].matchScore;
        productMatchLabel = products[0].matchScore >= 68 ? 'يوجد تشابه محتمل — يحتاج مراجعة يدوية' : 'لا يوجد تطابق قوي';
      }
    }
  }

  if (productCandidate && requestCode && normalizeProductCode(productCandidate.code) !== requestCode) {
    productIssues.push('كود الصنف لا يطابق كتالوج الأصناف');
  }
  if (productCandidate && requestName && productCandidate.name) {
    const match = scoreProductCandidate({ requestName, requestCode, product: productCandidate });
    if (normalizeProductName(productCandidate.name) !== normalizeProductName(requestName)) {
      productIssues.push(`اسم الطلب مختلف عن الاسم المعتمد في الكتالوج — ${match.label}`);
    }
    productMatchScore = Math.max(productMatchScore, match.score);
    productMatchLabel = match.label;
  }

  return { customerCandidate, productCandidate, productMatchScore, productMatchLabel, customerIssues, productIssues, branchConflict };
}

export async function repairCustomerRequestCustomer(
  requestId: string,
  customer: CustomerSearchResult,
  keepRequestBranch = true
) {
  if (!customer.id) throw new Error('اختر سجل عميل معياري قبل تنفيذ الإصلاح');
  const { data, error } = await supabase.rpc('repair_customer_request_customer_v2', {
    p_request_id: requestId,
    p_customer_id: customer.id,
    p_keep_request_branch: keepRequestBranch,
  });
  if (error) throw new Error(error.message);
  return data as CustomerRequest;
}

export async function refreshCustomerRequest(requestId: string) {
  const { data, error } = await supabase.from('customer_requests').select('*').eq('id', requestId).single();
  if (error) throw new Error(error.message);
  return data as CustomerRequest;
}
