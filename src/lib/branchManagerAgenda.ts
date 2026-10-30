import { supabase } from '@/lib/supabase';

// Branch manager daily agenda ("قائمة اليوم"). The items come from the branch's own data through
// get_branch_manager_agenda_v1 (migration 20261030140000); the manager closes an item with
// mark_branch_manager_agenda_item_v1. Auto items close themselves when the data is clean.

export type AgendaGroup = 'auto' | 'decide' | 'check';
export type AgendaItemKey =
  | 'open_requests' | 'uncoded_invoices' | 'purchases_review' | 'weekly_inventory'
  | 'big_customers' | 'high_discount'
  | 'cash_reconciliation' | 'appearance_cleanliness' | 'shelves_fridge';

export interface AgendaItem {
  key: AgendaItemKey;
  group: AgendaGroup;
  count: number;
  rows: Record<string, unknown>[];
  done: boolean;
  state: 'done' | 'issue' | null;
  note: string | null;
  marked_by: string | null;
  data_day?: string | null;
  inventory_status?: 'not_planned' | 'late' | 'planned' | 'counting' | 'submitted' | 'closed';
  due_date?: string | null;
}

export interface BranchManagerAgenda {
  branch: 'shokry' | 'elshamy';
  day: string;
  sales_day: string | null;
  purchase_day: string | null;
  items: AgendaItem[];
  done: number;
  total: number;
}

export const AGENDA_GROUP_LABELS: Record<AgendaGroup, { title: string; hint: string }> = {
  auto: { title: 'من بيانات الفرع', hint: 'بتتقفل لوحدها لما الرقم يوصل صفر' },
  decide: { title: 'محتاجة قرارك', hint: 'اكتب اللي عملته في سطر' },
  check: { title: 'لفة على الفرع', hint: 'ضغطة واحدة، والملاحظة لو فيه مشكلة بس' },
};

export const AGENDA_ITEM_LABELS: Record<AgendaItemKey, { title: string; action: string; link?: string }> = {
  open_requests: { title: 'طلبات عملاء مفتوحة أكتر من يوم', action: 'كلّم العميل أو حدّث حالة الطلب', link: '/customer-requests' },
  uncoded_invoices: { title: 'فواتير من غير كود عميل', action: 'راجع مع الدكتور وسجّل الكود', link: '/customers' },
  purchases_review: { title: 'فواتير مشتريات مستنية مراجعتك', action: 'راجع الفاتورة واعتمدها', link: '/purchase-invoice-review' },
  weekly_inventory: { title: 'جرد الأسبوع', action: '', link: '/inventory-counts' },
  big_customers: { title: 'عملاء اشتروا بـ 500 ج أو أكتر', action: 'مكالمة شكر ومتابعة', },
  high_discount: { title: 'خصم أكبر من 10%', action: 'اكتب سبب الخصم', },
  cash_reconciliation: { title: 'مطابقة الخزنة', action: 'الدرج مطابق للسيستم' },
  appearance_cleanliness: { title: 'اللبس والنظافة', action: 'الفريق بالزي والفرع نضيف' },
  shelves_fridge: { title: 'الرفوف والتلاجة', action: 'الرفوف مترتبة والتلاجة في درجتها' },
};

export const INVENTORY_STATUS_LABELS: Record<NonNullable<AgendaItem['inventory_status']>, string> = {
  not_planned: 'لسه ما اتخططش — ارفع ملف أصناف الأسبوع',
  late: 'متأخر عن ميعاده — تابع مع المسؤولين عن الجرد',
  planned: 'متخطط ومستني الجرد',
  counting: 'الجرد شغال',
  submitted: 'اتسلّم — مستني مراجعتك واعتمادك',
  closed: 'اتقفل ✓',
};

export const REQUEST_STATUS_SHORT: Record<string, string> = {
  new: 'جديد',
  purchasing_review: 'عند المشتريات',
  searching_suppliers: 'بندوّر عليه',
  needs_customer_confirmation: 'محتاج تأكيد العميل',
  customer_confirmed: 'العميل أكّد',
  sourcing: 'اتطلب',
  available: 'اتوفّر — كلّم العميل',
  arrived: 'وصل الفرع',
  customer_contacted: 'اتكلمنا معاه',
};

/** Items that need a note when closed by hand: every item except a floor check that is fine. */
export function agendaNoteRequired(item: Pick<AgendaItem, 'group'>, state: 'done' | 'issue') {
  return !(item.group === 'check' && state === 'done');
}

export function groupAgendaItems(items: AgendaItem[]) {
  const order: AgendaGroup[] = ['auto', 'decide', 'check'];
  return order
    .map((group) => ({ group, items: items.filter((item) => item.group === group) }))
    .filter((section) => section.items.length > 0);
}

export function agendaErrorMessage(error: unknown) {
  const message = String((error as { message?: string })?.message ?? error ?? '');
  if (message.includes('not_authorized')) return 'القائمة دي لمدير الفرع بس';
  if (message.includes('note_required')) return 'اكتب ملاحظة قصيرة باللي عملته';
  if (message.includes('Could not find the function') || message.includes('PGRST202')) {
    return 'قائمة اليوم لسه مش متفعلة على قاعدة البيانات';
  }
  return 'حصلت مشكلة، جرّب تاني';
}

export async function loadBranchManagerAgenda(branch: string | null) {
  const { data, error } = await supabase.rpc('get_branch_manager_agenda_v1', { p_branch: branch });
  if (error) throw error;
  return data as BranchManagerAgenda;
}

export async function markAgendaItem(branch: string | null, key: AgendaItemKey, state: 'done' | 'issue' | 'clear', note?: string) {
  const { error } = await supabase.rpc('mark_branch_manager_agenda_item_v1', {
    p_branch: branch, p_item_key: key, p_state: state, p_note: note ?? null,
  });
  if (error) throw error;
}
