import { isSupabaseConfigured, supabase } from '@/lib/supabase';

export interface ActivityLogInput {
  action: string;
  module: string;
  target_type?: string | null;
  target_id?: string | null;
  user_id?: string | null;
  user_name?: string | null;
  user_role?: string | null;
  branch_id?: string | null;
  branch_name?: string | null;
  details?: Record<string, unknown> | string | null;
  old_value?: Record<string, unknown> | null;
  new_value?: Record<string, unknown> | null;
  route_path?: string | null;
}

const DETAIL_LABELS: Record<string, string> = {
  summary: 'الملخص',
  staff_id: 'رقم الموظف',
  staff_name: 'الموظف',
  staffName: 'الموظف',
  staff_role: 'الدور',
  customer_id: 'رقم العميل',
  customer_name: 'العميل',
  customerName: 'العميل',
  customer_code: 'كود العميل',
  customer_phone: 'هاتف العميل',
  phone: 'الهاتف',
  points: 'النقاط',
  points_delta: 'تأثير النقاط',
  score: 'التقييم',
  final_score: 'التقييم النهائي',
  reason: 'السبب',
  status: 'الحالة',
  branch: 'الفرع',
  branch_name: 'الفرع',
  source: 'المصدر',
  source_id: 'رقم المصدر',
  route: 'الرابط',
};

function renderDetailValue(value: unknown) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function compactDetails(details: ActivityLogInput['details']) {
  if (!details) return '';
  if (typeof details === 'string') return details;

  return Object.entries(details)
    .map(([key, value]) => {
      const rendered = renderDetailValue(value);
      if (!rendered) return '';
      return `${DETAIL_LABELS[key] || key}: ${rendered}`;
    })
    .filter(Boolean)
    .join(' | ');
}

export function formatActivityDetails(details: unknown) {
  if (!details) return 'لا توجد تفاصيل إضافية';

  if (typeof details === 'string') {
    if (!details.trim()) return 'لا توجد تفاصيل إضافية';
    try {
      return formatActivityDetails(JSON.parse(details));
    } catch {
      return details;
    }
  }

  if (typeof details === 'object') {
    const text = compactDetails(details as Record<string, unknown>);
    return text || 'لا توجد تفاصيل إضافية';
  }

  return String(details);
}

function missingColumn(message: string) {
  return message.match(/'([^']+)' column/)?.[1] || message.match(/column "([^"]+)"/)?.[1] || '';
}

// يكتب في جدول activity_log الرسمي الوحيد مع fallback تلقائي للأعمدة الناقصة
async function insertWithColumnFallback(payload: Record<string, unknown>) {
  const next = { ...payload };
  const removed = new Set<string>();

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { error } = await supabase.from('activity_log').insert(next);
    if (!error) return true;

    const column = missingColumn(error.message);
    if (!column || removed.has(column) || !(column in next)) {
      return false;
    }

    removed.add(column);
    delete next[column];
  }

  return false;
}

export async function logActivity(input: ActivityLogInput) {
  if (!isSupabaseConfigured) return;

  const details = input.details ?? {};
  const branchName = input.branch_name || '';
  const createdAt = new Date().toISOString();

  // جدول واحد رسمي فقط: activity_log
  const payload: Record<string, unknown> = {
    action: input.action,
    module: input.module,
    target_type: input.target_type || null,
    target_id: input.target_id || null,
    user_id: input.user_id || null,
    user_name: input.user_name || 'النظام',
    user_role: input.user_role || null,
    branch_id: input.branch_id || null,
    branch_name: branchName || null,
    branch: branchName || null,
    details,
    old_value: input.old_value || null,
    new_value: input.new_value || null,
    route_path: input.route_path || null,
    created_at: createdAt,
  };

  const saved = await insertWithColumnFallback(payload);
  if (saved) return;

  // محاولة أخيرة بالحقول الأساسية فقط
  await insertWithColumnFallback({
    user_id: payload.user_id,
    user_name: payload.user_name,
    action: payload.action,
    module: payload.module,
    branch: payload.branch,
    details: formatActivityDetails(details),
    created_at: createdAt,
  });
}
