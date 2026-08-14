import { supabase } from '@/lib/supabase';
import { normalizeProductCode, normalizeProductName } from '@/lib/productMatching';
import type { CustomerRequest } from '@/lib/api/customerRequests';

export const WAREHOUSE_PENDING_STATUSES = [
  'new',
  'purchasing_review',
  'searching_suppliers',
  'needs_customer_confirmation',
  'customer_confirmed',
  'sourcing',
  'not_available',
] as const;

type RequestWithProduct = CustomerRequest & {
  product_id?: string | null;
  product_code?: string | null;
  product_price?: number | null;
};

type CanonicalProduct = {
  id: string;
  code: string;
  name: string;
  price: number | null;
};

export type WarehouseShortageGroup = {
  key: string;
  productId: string | null;
  productCode: string;
  canonicalName: string;
  requestNames: string[];
  totalQuantity: number;
  requestCount: number;
  urgentCount: number;
  customerCount: number;
  branches: Record<string, number>;
  statuses: Record<string, number>;
  oldestRequestAt: string | null;
  latestRequestAt: string | null;
  neededByDate: string | null;
  supplierHints: string[];
  linkQuality: 'linked_code' | 'linked_name' | 'unlinked';
};

export type WarehouseShortageSnapshot = {
  groups: WarehouseShortageGroup[];
  totalRequests: number;
  totalQuantity: number;
  linkedGroups: number;
  unlinkedGroups: number;
  urgentRequests: number;
  generatedAt: string;
  branch: string;
};

function dateValue(value: string | null | undefined) {
  if (!value) return 0;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.getTime() : 0;
}

function requestDate(request: RequestWithProduct) {
  return request.requested_at || request.created_at || null;
}

function isUrgent(request: RequestWithProduct) {
  const urgency = String(request.urgency || request.priority || '').toLowerCase();
  return Boolean(request.is_urgent) || ['urgent', 'high', 'critical', 'عاجل', 'مهم'].includes(urgency);
}

function customerKey(request: RequestWithProduct) {
  return String(request.customer_id || request.customer_code || request.customer_phone || '').trim();
}

// مطابق للدالة SQL الحالية normalize_product_name المستخدمة في products.normalized_name.
function normalizeCatalogDbName(value: unknown) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06ff]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function loadCanonicalProducts(requests: RequestWithProduct[]) {
  const byCode = new Map<string, CanonicalProduct>();
  const byName = new Map<string, CanonicalProduct[]>();
  const codes = [...new Set(requests.map((request) => normalizeProductCode(request.product_code)).filter(Boolean))];
  const dbNames = [...new Set(
    requests
      .filter((request) => !normalizeProductCode(request.product_code))
      .map((request) => normalizeCatalogDbName(request.medicine_name))
      .filter(Boolean)
  )];

  const addProduct = (row: { id: string; product_code: string | null; name: string | null; price: number | null; normalized_name?: string | null }) => {
    const product: CanonicalProduct = {
      id: row.id,
      code: row.product_code || '',
      name: row.name || '',
      price: row.price === null ? null : Number(row.price),
    };
    const code = normalizeProductCode(row.product_code);
    if (code) byCode.set(code, product);
    const smartName = normalizeProductName(row.name);
    if (smartName) {
      const current = byName.get(smartName) || [];
      if (!current.some((item) => item.id === product.id)) byName.set(smartName, [...current, product]);
    }
  };

  for (let index = 0; index < codes.length; index += 100) {
    const chunk = codes.slice(index, index + 100);
    const { data, error } = await supabase.from('products').select('id,product_code,name,price,normalized_name').in('product_code', chunk);
    if (error) throw new Error(error.message);
    for (const row of data || []) addProduct(row);
  }

  for (let index = 0; index < dbNames.length; index += 100) {
    const chunk = dbNames.slice(index, index + 100);
    const { data, error } = await supabase.from('products').select('id,product_code,name,price,normalized_name').in('normalized_name', chunk);
    if (error) throw new Error(error.message);
    for (const row of data || []) addProduct(row);
  }

  return { byCode, byName };
}

export async function getWarehouseShortageSnapshot(branch = 'all', limit = 3000): Promise<WarehouseShortageSnapshot> {
  let query = supabase
    .from('customer_requests')
    .select('*')
    .in('status', [...WAREHOUSE_PENDING_STATUSES])
    .order('created_at', { ascending: true })
    .limit(Math.min(Math.max(limit, 100), 5000));

  if (branch && branch !== 'all') query = query.eq('branch', branch);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const requests = (data || []) as RequestWithProduct[];
  const { byCode, byName } = await loadCanonicalProducts(requests);

  const groups = new Map<string, WarehouseShortageGroup>();
  const customerKeysByGroup = new Map<string, Set<string>>();

  for (const request of requests) {
    const requestCode = normalizeProductCode(request.product_code);
    const normalizedRequestName = normalizeProductName(request.medicine_name);
    const byExactCode = requestCode ? byCode.get(requestCode) : undefined;
    const nameMatches = !requestCode && normalizedRequestName ? byName.get(normalizedRequestName) || [] : [];
    const byUniqueName = nameMatches.length === 1 ? nameMatches[0] : undefined;
    const canonical = byExactCode || byUniqueName;
    const productCode = normalizeProductCode(canonical?.code || requestCode);
    const canonicalName = canonical?.name || String(request.medicine_name || '').trim() || 'صنف غير محدد';
    const key = canonical?.id ? `id:${canonical.id}` : productCode ? `code:${productCode}` : `name:${normalizedRequestName || request.id}`;
    const quantity = Math.max(1, Number(request.quantity || 1));
    const branchName = String(request.branch || 'غير محدد').trim() || 'غير محدد';
    const status = String(request.status || 'غير محدد');
    const created = requestDate(request);
    const current = groups.get(key) || {
      key,
      productId: canonical?.id || request.product_id || null,
      productCode,
      canonicalName,
      requestNames: [],
      totalQuantity: 0,
      requestCount: 0,
      urgentCount: 0,
      customerCount: 0,
      branches: {},
      statuses: {},
      oldestRequestAt: created,
      latestRequestAt: created,
      neededByDate: request.needed_by_date || null,
      supplierHints: [],
      linkQuality: byExactCode ? 'linked_code' : byUniqueName ? 'linked_name' : 'unlinked',
    } satisfies WarehouseShortageGroup;

    current.totalQuantity += quantity;
    current.requestCount += 1;
    if (isUrgent(request)) current.urgentCount += 1;
    current.branches[branchName] = (current.branches[branchName] || 0) + quantity;
    current.statuses[status] = (current.statuses[status] || 0) + 1;
    if (request.medicine_name && !current.requestNames.includes(request.medicine_name)) current.requestNames.push(request.medicine_name);
    if (request.supplier_hint && !current.supplierHints.includes(request.supplier_hint)) current.supplierHints.push(request.supplier_hint);
    if (!current.oldestRequestAt || (created && dateValue(created) < dateValue(current.oldestRequestAt))) current.oldestRequestAt = created;
    if (!current.latestRequestAt || (created && dateValue(created) > dateValue(current.latestRequestAt))) current.latestRequestAt = created;
    if (request.needed_by_date && (!current.neededByDate || dateValue(request.needed_by_date) < dateValue(current.neededByDate))) current.neededByDate = request.needed_by_date;

    const cKey = customerKey(request);
    if (cKey) {
      const set = customerKeysByGroup.get(key) || new Set<string>();
      set.add(cKey);
      customerKeysByGroup.set(key, set);
    }

    groups.set(key, current);
  }

  for (const group of groups.values()) {
    group.customerCount = customerKeysByGroup.get(group.key)?.size || 0;
  }

  const sorted = [...groups.values()].sort((a, b) =>
    b.urgentCount - a.urgentCount
    || b.requestCount - a.requestCount
    || b.totalQuantity - a.totalQuantity
    || dateValue(a.oldestRequestAt) - dateValue(b.oldestRequestAt)
  );

  return {
    groups: sorted,
    totalRequests: requests.length,
    totalQuantity: sorted.reduce((total, group) => total + group.totalQuantity, 0),
    linkedGroups: sorted.filter((group) => group.linkQuality !== 'unlinked').length,
    unlinkedGroups: sorted.filter((group) => group.linkQuality === 'unlinked').length,
    urgentRequests: sorted.reduce((total, group) => total + group.urgentCount, 0),
    generatedAt: new Date().toISOString(),
    branch,
  };
}

function formatDate(value: string | null) {
  return value ? String(value).slice(0, 10) : '';
}

export async function exportWarehouseShortageWorkbook(snapshot: WarehouseShortageSnapshot) {
  const XLSX = await import('xlsx');
  const summaryRows = snapshot.groups.map((group, index) => ({
    'م': index + 1,
    'كود الصنف': group.productCode || '',
    'اسم الصنف المعتمد': group.canonicalName,
    'إجمالي الكمية المطلوبة': group.totalQuantity,
    'عدد الطلبات': group.requestCount,
    'عدد العملاء': group.customerCount,
    'طلبات عاجلة': group.urgentCount,
    'الفروع': Object.entries(group.branches).map(([name, qty]) => `${name}: ${qty}`).join(' | '),
    'أقدم طلب': formatDate(group.oldestRequestAt),
    'مطلوب قبل': formatDate(group.neededByDate),
    'المورد المقترح': group.supplierHints.join(' | '),
    'حالة الربط': group.linkQuality === 'linked_code' ? 'مربوط بالكود' : group.linkQuality === 'linked_name' ? 'مربوط باسم مؤكد' : 'يحتاج مراجعة',
  }));

  const branchRows = snapshot.groups.flatMap((group) => Object.entries(group.branches).map(([branch, quantity]) => ({
    'كود الصنف': group.productCode || '',
    'اسم الصنف المعتمد': group.canonicalName,
    'الفرع': branch,
    'الكمية المطلوبة': quantity,
    'إجمالي طلبات الصنف': group.requestCount,
    'طلبات عاجلة': group.urgentCount,
  })));

  const reviewRows = snapshot.groups.filter((group) => group.linkQuality === 'unlinked' || group.requestNames.length > 1).map((group) => ({
    'كود الصنف الحالي': group.productCode || '',
    'الاسم المقترح': group.canonicalName,
    'الأسماء المسجلة في طلبات العملاء': group.requestNames.join(' | '),
    'عدد الطلبات': group.requestCount,
    'إجمالي الكمية': group.totalQuantity,
    'سبب المراجعة': group.linkQuality === 'unlinked' ? 'لا يوجد ربط مؤكد بكتالوج الأصناف' : 'يوجد أكثر من طريقة كتابة لنفس الصنف',
  }));

  const wb = XLSX.utils.book_new();
  const addSheet = (rows: Record<string, string | number>[], name: string) => {
    const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ 'لا توجد بيانات': '' }]);
    ws['!dir'] = 'rtl';
    const headers = Object.keys(rows[0] || { 'لا توجد بيانات': '' });
    ws['!cols'] = headers.map((header) => ({ wch: Math.min(45, Math.max(14, header.length + 4, ...rows.slice(0, 120).map((row) => String(row[header] ?? '').length + 2))) }));
    XLSX.utils.book_append_sheet(wb, ws, name);
  };

  addSheet(summaryRows, 'طلب المخازن');
  addSheet(branchRows, 'توزيع الفروع');
  addSheet(reviewRows, 'مراجعة الأكواد والأسماء');

  const branchLabel = snapshot.branch === 'all' ? 'كل_الفروع' : snapshot.branch.replace(/\s+/g, '_');
  XLSX.writeFile(wb, `طلبات_العملاء_غير_المتوفرة_${branchLabel}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
