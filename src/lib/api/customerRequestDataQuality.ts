import { supabase } from '@/lib/supabase';
import { normalizePhone, searchCustomers, type CustomerSearchResult } from '@/lib/customerSearch';
import { searchProductsCatalog, type CatalogProduct } from '@/lib/api/productsCatalog';
import type { CustomerRequest } from '@/lib/api/customerRequests';

export type RequestDataQuality = {
  customerCandidate: CustomerSearchResult | null;
  productCandidate: CatalogProduct | null;
  customerIssues: string[];
  productIssues: string[];
  branchConflict: boolean;
};

function normalizeCode(value: unknown) {
  return String(value ?? '').trim().replace(/\.0$/, '').toUpperCase();
}

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
  if (!requestWithProduct.product_id) productIssues.push('الصنف غير مربوط بكتالوج الأصناف');
  if (!normalizeCode(requestWithProduct.product_code)) productIssues.push('كود الصنف غير موجود');
  if (!String(request.medicine_name || '').trim()) productIssues.push('اسم الصنف غير موجود');

  let productCandidate: CatalogProduct | null = null;
  const productQuery = normalizeCode(requestWithProduct.product_code) || String(request.medicine_name || '').trim();
  if (productQuery) {
    const products = await searchProductsCatalog(productQuery, 20);
    const code = normalizeCode(requestWithProduct.product_code);
    productCandidate = products.find((item) => code && normalizeCode(item.code) === code) || null;
    if (!productCandidate && !code && products.length === 1) productCandidate = products[0];
  }

  if (productCandidate && requestWithProduct.product_code && normalizeCode(productCandidate.code) !== normalizeCode(requestWithProduct.product_code)) {
    productIssues.push('كود الصنف لا يطابق كتالوج الأصناف');
  }
  if (productCandidate && request.medicine_name && productCandidate.name && productCandidate.name.trim() !== request.medicine_name.trim()) {
    productIssues.push('اسم الصنف في الطلب مختلف عن الاسم المعتمد في الكتالوج');
  }

  return { customerCandidate, productCandidate, customerIssues, productIssues, branchConflict };
}

export async function repairCustomerRequestCustomer(requestId: string, customer: CustomerSearchResult, keepRequestBranch = true) {
  const payload: Record<string, unknown> = {
    customer_id: customer.id || null,
    customer_code: customer.code || null,
    customer_name: customer.name || null,
    customer_phone: customer.phone || null,
    updated_at: new Date().toISOString(),
  };
  if (!keepRequestBranch && customer.branch) payload.branch = customer.branch;
  const { data, error } = await supabase.from('customer_requests').update(payload).eq('id', requestId).select('*').single();
  if (error) throw new Error(error.message);
  return data as CustomerRequest;
}

export async function refreshCustomerRequest(requestId: string) {
  const { data, error } = await supabase.from('customer_requests').select('*').eq('id', requestId).single();
  if (error) throw new Error(error.message);
  return data as CustomerRequest;
}
