import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ClipboardList,
  Heart,
  Loader2,
  MessageSquare,
  PhoneCall,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  Trophy,
  UserCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { ALL_FILTER } from '@/lib/api/customers';
import {
  fetchCustomerServiceFollowups,
  fetchCustomerServiceInsightPools,
  updateFollowupResult,
  type CustomerServiceInsightPools,
  type FollowupRow,
} from '@/lib/api/customerServiceCommandCenter';
import { normalizeBranchName } from '@/lib/branch';
import { getCustomerCodeSafe, resolveCustomerBranch } from '@/lib/customerDisplay';
import { isValidEgyptPhone } from '@/lib/customerAnalyticsService';
import { canSeeAllBranches, effectiveBranchFilter } from '@/lib/security/permissionScopes';

const BRANCH_OPTIONS = [ALL_FILTER, 'فرع الشامي', 'فرع شكري'];
const LIMIT = 180;

type WorkRow = FollowupRow & {
  virtual?: boolean;
  source_bucket?: 'vip' | 'reduced' | 'stopped' | 'daily';
  operating_score?: number;
};

type BucketKey = 'now' | 'pamper' | 'winback' | 'data' | 'done';
type QuickResult = 'تم التواصل' | 'لم يرد' | 'طلب لاحق' | 'تم البيع' | 'شكوى' | 'رقم غير صحيح' | 'يحتاج مدير';
type ScriptKind = 'auto' | 'vip' | 'reduced' | 'stopped' | 'complaint' | 'chronic' | 'unavailable' | 'no_answer' | 'care' | 'angry' | 'returned' | 'manager' | 'overdue' | 'default';

const RESULT_OPTIONS: QuickResult[] = ['تم التواصل', 'لم يرد', 'طلب لاحق', 'تم البيع', 'شكوى', 'رقم غير صحيح', 'يحتاج مدير'];
const SCRIPT_KINDS: Array<{ value: ScriptKind; label: string; objective: string }> = [
  { value: 'auto', label: 'اختيار ذكي تلقائي', objective: 'النظام يختار الأسلوب الأنسب حسب حالة العميل' },
  { value: 'vip', label: 'دلع عميل VIP', objective: 'زيادة الولاء وعدم خسارة عميل مهم' },
  { value: 'reduced', label: 'استرجاع عميل قلل التعامل', objective: 'فتح حوار ودود لمعرفة سبب قلة التعامل' },
  { value: 'stopped', label: 'استرجاع عميل متوقف', objective: 'إرجاع العميل بدون ضغط بيع مباشر' },
  { value: 'complaint', label: 'اعتذار عن شكوى', objective: 'امتصاص الغضب وإظهار اهتمام حقيقي' },
  { value: 'chronic', label: 'متابعة علاج شهري', objective: 'تذكير العميل وتجهيز احتياجه قبل نفاد العلاج' },
  { value: 'unavailable', label: 'صنف غير متوفر / بديل', objective: 'عدم ترك العميل بدون حل' },
  { value: 'no_answer', label: 'لم يرد', objective: 'ترك باب التواصل مفتوحًا بأدب' },
  { value: 'care', label: 'دلع بدون بيع مباشر', objective: 'رسالة اهتمام تقوي العلاقة' },
  { value: 'angry', label: 'عميل غير راضٍ', objective: 'احتواء العميل وطلب تفاصيل المشكلة' },
  { value: 'returned', label: 'شكر بعد رجوع العميل', objective: 'تثبيت الرجوع وتحسين التجربة التالية' },
  { value: 'manager', label: 'تدخل مدير', objective: 'طمأنة العميل أن الموضوع تحت متابعة مسؤول' },
  { value: 'overdue', label: 'متابعة متأخرة', objective: 'اعتذار واضح وتعويض تأخير المتابعة باهتمام' },
  { value: 'default', label: 'متابعة عامة', objective: 'متابعة لطيفة لأي حالة غير مصنفة' },
];

const FEATURE_LINKS = [
  { label: 'أثر المتابعات', tab: 'impact', desc: 'المبيعات بعد المتابعة والعملاء الراجعين' },
  { label: 'أداء مسؤولي الخدمة', tab: 'owners-performance', desc: 'إنجاز ضحى/دنيا/الفريق حسب الفرع' },
  { label: 'تحليل خدمة العملاء', tab: 'performance', desc: 'تحليل أعمق للنتائج والتأخيرات' },
  { label: 'أداء الدكتور', tab: 'doctor', desc: 'ربط المحادثات والمتابعات بالدكتور' },
  { label: 'أداء الفريق', tab: 'team', desc: 'مقارنة مسؤولي الخدمة والفروع' },
  { label: 'تحليل قرار العميل', tab: 'decision', desc: 'ليه اشترى أو لم يشترِ' },
  { label: 'اقتراحات التحسين', tab: 'improvements', desc: 'فرص تطوير يومية' },
  { label: 'قوالب واتساب', tab: 'scripts', desc: 'كل السكريبتات والردود الجاهزة' },
  { label: 'طلبات العملاء', tab: 'customer-requests', desc: 'الأصناف المطلوبة والوعد بالمتابعة' },
  { label: 'مراجعة البيانات', tab: 'data-review', desc: 'الكود والرقم والفرع والتكرارات' },
  { label: 'تقييم المحادثات', tab: 'evaluation', desc: 'جودة الردود وتأخير الأوردر وتسجيل الطلبات' },
  { label: 'إضافة متابعة', tab: 'add', desc: 'تحويل مقترح ذكي لمتابعة رسمية' },
];

function text(value: unknown, fallback = 'غير محدد') {
  return String(value ?? '').trim() || fallback;
}

function customerName(row?: WorkRow | null) {
  if (!row) return 'عميل غير محدد';
  return text(row.customer_name || row.name, 'عميل غير مسجل');
}

function phoneOf(row?: WorkRow | null) {
  if (!row) return '';
  return String(row.customer_phone || row.phone || row.whatsapp_phone || row.phone_alt || '').trim();
}

function statusOf(row: WorkRow) {
  return text(row.followup_status || row.status || row.contact_status, 'معلق');
}

function totalSpent(row: WorkRow) {
  return Number(row.customer_metrics?.total_spent || row.total_spent || 0) || 0;
}

function avgMonthly(row: WorkRow) {
  return Number(row.customer_metrics?.avg_monthly || 0) || 0;
}

function invoicesCount(row: WorkRow) {
  return Number(row.customer_metrics?.invoices_count || row.customer_metrics?.total_invoices || 0) || 0;
}

function customerStatus(row: WorkRow) {
  return text(row.customer_metrics?.customer_status || row.customer_status, 'غير محدد');
}

function segment(row: WorkRow) {
  return text(row.customer_metrics?.segment || row.segment || row.classification, 'غير مصنف');
}

function dueAt(row: WorkRow) {
  return row.followup_datetime || row.followup_date || row.next_followup_date || row.date || row.created_at || null;
}

function formatDate(value?: string | null) {
  if (!value) return 'غير محدد';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 16);
  return d.toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' });
}

function money(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n.toLocaleString('ar-EG', { maximumFractionDigits: 0 }) : '0';
}

function isCompleted(row: WorkRow) {
  const status = statusOf(row);
  return Boolean(row.completed_at || row.closed_at || /تم|completed|done|closed/i.test(status));
}

function isOverdue(row: WorkRow) {
  if (isCompleted(row) || row.postponed_until) return false;
  const raw = dueAt(row);
  return Boolean(raw && new Date(raw).getTime() < Date.now());
}

function minutesLate(row: WorkRow) {
  const raw = dueAt(row);
  if (!raw) return 0;
  const value = Math.floor((Date.now() - new Date(raw).getTime()) / 60000);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function delayLabel(row: WorkRow) {
  const minutes = minutesLate(row);
  if (!minutes) return 'في الموعد';
  if (minutes < 60) return `${minutes} دقيقة`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ساعة`;
  return `${Math.floor(hours / 24)} يوم`;
}

function hasValidPhone(row: WorkRow) {
  const phone = phoneOf(row);
  return Boolean(phone && isValidEgyptPhone(phone, getCustomerCodeSafe(row)));
}

function workKey(row: WorkRow) {
  const phone = phoneOf(row).replace(/\D/g, '');
  return String(row.customer_id || getCustomerCodeSafe(row) || phone || customerName(row)).trim().toLowerCase().replace(/\s+/g, '');
}

function classify(row: WorkRow): BucketKey {
  if (isCompleted(row)) return 'done';
  if (!hasValidPhone(row) || !getCustomerCodeSafe(row) || resolveCustomerBranch(row).needsReview) return 'data';
  if (row.source_bucket === 'reduced' || row.source_bucket === 'stopped' || /متوقف|قلل|مهدد|inactive|stop/i.test(`${customerStatus(row)} ${row.followup_reason || ''}`)) return 'winback';
  if (row.source_bucket === 'vip' || /vip|مميز|مهم جدًا|مهم جدا/i.test(`${segment(row)} ${row.priority || ''}`)) return 'pamper';
  return 'now';
}

function score(row: WorkRow) {
  let value = 0;
  if (row.needs_manager) value += 260;
  if (isOverdue(row)) value += 220 + Math.min(160, minutesLate(row));
  if (!hasValidPhone(row)) value += 140;
  if (!getCustomerCodeSafe(row)) value += 120;
  if (resolveCustomerBranch(row).needsReview) value += 80;
  if (row.source_bucket === 'stopped') value += 95;
  if (row.source_bucket === 'reduced') value += 85;
  if (row.source_bucket === 'vip') value += 75;
  if (/عاجل|urgent|high/i.test(String(row.priority || ''))) value += 100;
  value += Math.min(110, Math.round(totalSpent(row) / 1800));
  value += Math.min(70, Math.round(avgMonthly(row) / 450));
  return value;
}

function dedupe(rows: WorkRow[]) {
  const map = new Map<string, WorkRow>();
  rows.forEach((row) => {
    const key = workKey(row);
    if (!key) return;
    const current = { ...row, operating_score: score(row) };
    const old = map.get(key);
    if (!old || score(current) > score(old) || (!current.virtual && old.virtual)) map.set(key, current);
  });
  return [...map.values()].sort((a, b) => score(b) - score(a) || totalSpent(b) - totalSpent(a));
}

function insightRows(insights: CustomerServiceInsightPools): WorkRow[] {
  return [
    ...insights.important.map((row) => ({ ...row, id: `vip-${workKey(row)}`, virtual: true, source_bucket: 'vip' as const })),
    ...insights.reduced.map((row) => ({ ...row, id: `reduced-${workKey(row)}`, virtual: true, source_bucket: 'reduced' as const })),
    ...insights.stopped60.map((row) => ({ ...row, id: `stopped-${workKey(row)}`, virtual: true, source_bucket: 'stopped' as const })),
  ];
}

function reasonFor(row: WorkRow) {
  if (!hasValidPhone(row)) return 'تصحيح رقم العميل قبل التواصل';
  if (!getCustomerCodeSafe(row)) return 'استكمال كود العميل قبل الإغلاق';
  if (resolveCustomerBranch(row).needsReview) return 'مراجعة الفرع الصحيح للعميل';
  if (row.needs_manager) return 'تصعيد للمدير مع ملخص واضح';
  if (isOverdue(row)) return `متابعة متأخرة ${delayLabel(row)}`;
  if (row.source_bucket === 'stopped') return 'استرجاع عميل متوقف';
  if (row.source_bucket === 'reduced') return 'استرجاع عميل قلل التعامل';
  if (row.source_bucket === 'vip') return 'دلع عميل مهم';
  return row.request_details || row.followup_reason || row.suggested_action || 'متابعة العميل بود واهتمام';
}

function recommendedScriptKind(row: WorkRow): Exclude<ScriptKind, 'auto'> {
  const combined = `${reasonFor(row)} ${customerStatus(row)} ${segment(row)} ${statusOf(row)} ${row.notes || ''} ${row.followup_result || ''}`;
  if (row.needs_manager) return 'manager';
  if (/شكوى|complaint/i.test(combined)) return 'complaint';
  if (/غاضب|زعلان|غير راض/i.test(combined)) return 'angry';
  if (/لم يرد|no answer/i.test(combined)) return 'no_answer';
  if (/مزمن|شهري|سكر|ضغط|قلب|غدة/i.test(combined)) return 'chronic';
  if (/غير متوفر|ناقص|بديل/i.test(combined)) return 'unavailable';
  if (row.source_bucket === 'stopped' || /متوقف|inactive|stop/i.test(combined)) return 'stopped';
  if (row.source_bucket === 'reduced' || /قلل|منخفض/i.test(combined)) return 'reduced';
  if (row.source_bucket === 'vip' || /vip|مهم جدًا|مهم جدا|مميز/i.test(combined)) return 'vip';
  if (isOverdue(row)) return 'overdue';
  if (row.purchase_after_followup) return 'returned';
  return 'care';
}

function greeting(row: WorkRow) {
  const name = customerName(row);
  return `أهلا بحضرتك${name && name !== 'عميل غير مسجل' ? ` أ/ ${name}` : ''}\nمع حضرتك صيدليات دواء.`;
}

function careScript(row: WorkRow, forcedKind: ScriptKind = 'auto') {
  const kind = forcedKind === 'auto' ? recommendedScriptKind(row) : forcedKind;
  const opening = greeting(row);
  const reason = reasonFor(row);
  if (!hasValidPhone(row)) return 'لا يوجد رقم صحيح للواتساب. راجع بيانات العميل أو اطلب تحديث الرقم من الفرع قبل التواصل.';
  const scripts: Record<Exclude<ScriptKind, 'auto'>, string> = {
    vip: `${opening}\n\nحضرتك من عملائنا المميزين، ووجودك دايمًا يهمنا جدًا.\nبنطمن على حضرتك وعلى احتياجاتك الشهرية، ولو في أي صنف ناقص أو طلب تحب نجهزه لحضرتك قبل ما تحتاجه، إحنا تحت أمر حضرتك فورًا.\n\nولو في أي ملاحظة على الخدمة، يهمنا نسمعها ونحلها لحضرتك بكل اهتمام.\nصيدليات دواء دايمًا في خدمتك.`,
    reduced: `${opening}\n\nلاحظنا إن بقالنا فترة ما اتشرفناش بتعاملك زي المعتاد، فحبينا نطمن على حضرتك.\nيهمنا نعرف هل في أي صنف محتاجه؟ أو في أي ملاحظة على الخدمة نقدر نصلحها لحضرتك؟\n\nحضرتك عميل مهم عندنا، ورضاك عن صيدليات دواء يفرق معانا جدًا.`,
    stopped: `${opening}\n\nوحشنا تعامل حضرتك معانا، وحبينا نطمن عليك ونشوف لو في أي احتياج نقدر نوفره لحضرتك.\nولو حصل قبل كده أي تقصير مننا أو تجربة ماكنتش مرضية، بنعتذر لحضرتك جدًا ويهمنا نصلحها.\n\nوجود حضرتك معانا مهم، ونتشرف بخدمتك في أي وقت.`,
    complaint: `${opening}\n\nبنعتذر لحضرتك جدًا لو حصل أي تقصير أو تجربة ماكنتش على المستوى اللي يرضيك.\nحضرتك تهمنا، وملاحظتك محل اهتمام حقيقي مننا، وهنراجعها بعناية علشان نضمن إن التجربة الجاية تكون أفضل بإذن الله.\n\nيهمنا نعرف من حضرتك إيه أكتر حاجة تحب نصلحها أو نهتم بيها؟`,
    chronic: `${opening}\n\nبنطمن على حضرتك بخصوص علاجك الشهري، ولو في أي صنف قرب يخلص أو محتاج يتجهز، نقدر نجهزه لحضرتك ونوفره في أسرع وقت.\n\nولو حضرتك تحب نتابع معاك شهريًا قبل معاد العلاج، ده يسعدنا جدًا.\nصيدليات دواء تحت أمر حضرتك دائمًا.`,
    unavailable: `${opening}\n\nبنعتذر لحضرتك إن الصنف المطلوب غير متوفر حاليًا، لكن يهمنا مانسيبش حضرتك من غير حل.\nممكن نراجع لحضرتك أقرب بديل مناسب أو نتابع توفر الصنف ونبلغك أول ما يوصل.\n\nالأهم عندنا إن حضرتك تلاقي حل آمن ومناسب، وتكون مطمّن قبل أي اختيار.`,
    no_answer: `${opening}\n\nحاولنا نطمن على حضرتك بخصوص متابعتك، ويمكن الوقت ماكانش مناسب.\nإحنا تحت أمرك في أي وقت يناسب حضرتك، ولو في أي طلب أو استفسار ابعتلنا وهنساعدك فورًا.\n\nنتشرف بخدمة حضرتك دائمًا.`,
    care: `${opening}\n\nرسالتنا لحضرتك مش للبيع بس، إحنا فعلًا بنطمن عليك.\nلو في أي حاجة محتاجها، سؤال عن دواء، صنف ناقص، أو حتى ملاحظة على الخدمة، إحنا موجودين علشان حضرتك.\n\nوجودك وثقتك في صيدليات دواء حاجة نعتز بيها جدًا.`,
    angry: `${opening}\n\nحق حضرتك علينا إن تجربتك تكون أفضل من كده، وبنعتذر جدًا لو حضرتك اتضايقت من أي موقف.\nيهمنا نسمع حضرتك بهدوء ونفهم المشكلة كويس، ونوعدك إننا هنتعامل معاها باهتمام حقيقي.\n\nرضاك عن صيدليات دواء مش مجرد متابعة، ده أولوية عندنا.`,
    returned: `${opening}\n\nبنشكرك جدًا إنك شرفتنا بتعاملك مرة تانية.\nيهمنا نطمن إن طلب حضرتك وصل أو اتجهز بالشكل المناسب، وإن الخدمة كانت مرضية لحضرتك.\n\nلو في أي ملاحظة أو احتياج قادم، إحنا تحت أمر حضرتك دائمًا.`,
    manager: `${opening}\n\nبنراجع طلب حضرتك مع المسؤول المختص، وهنرجع لحضرتك بأسرع وقت بإذن الله.\nيهمنا تكون مطمّن إن الموضوع محل اهتمام ومتابعة، وحق حضرتك علينا إننا نوضح لحضرتك كل التفاصيل.\n\nتحت أمر حضرتك في أي وقت.`,
    overdue: `${opening}\n\nبنعتذر لحضرتك عن التأخير في المتابعة، ويهمنا نطمن إن طلب حضرتك تم بالشكل المناسب.\nمتابعين مع حضرتك بخصوص ${reason}، ولو في أي ملاحظة أو احتياج حالي إحنا نساعدك فورًا.\n\nثقة حضرتك في صيدليات دواء تهمنا جدًا.`,
    default: `${opening}\n\nبنطمن على حضرتك بخصوص ${reason}.\nلو في أي طلب أو استفسار أو ملاحظة، إحنا تحت أمر حضرتك فورًا.\n\nنتشرف بخدمة حضرتك دائمًا في صيدليات دواء.`,
  };
  return scripts[kind];
}

function waHref(row: WorkRow, kind: ScriptKind) {
  const digits = phoneOf(row).replace(/\D/g, '');
  if (!digits) return '';
  const phone = digits.startsWith('20') ? digits : digits.startsWith('0') ? `2${digits}` : digits;
  return `https://wa.me/${phone}?text=${encodeURIComponent(careScript(row, kind))}`;
}

function addUrl(row: WorkRow) {
  const params = new URLSearchParams({ tab: 'add' });
  if (customerName(row)) params.set('name', customerName(row));
  if (phoneOf(row)) params.set('phone', phoneOf(row));
  if (getCustomerCodeSafe(row)) params.set('code', getCustomerCodeSafe(row));
  if (row.branch) params.set('branch', normalizeBranchName(row.branch));
  return `/customer-service?${params.toString()}`;
}

function detailsUrl(row: WorkRow) {
  if (row.virtual) return addUrl(row);
  const params = new URLSearchParams({ followupId: row.id, openDetails: '1' });
  return `/customer-service?${params.toString()}`;
}

function tabUrl(tab: string) {
  return `/customer-service?tab=${encodeURIComponent(tab)}`;
}

function lossReason(row: WorkRow) {
  return text(row.no_purchase_reason || row.followup_result || row.contact_result || row.notes, 'غير محدد');
}

function LoadingBox() {
  return (
    <div className="rounded-2xl border border-cyan-300/15 bg-slate-950/50 p-5 text-center text-sm font-bold text-slate-300">
      <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin text-cyan-300" />
      جاري تجهيز مركز التشغيل...
    </div>
  );
}

function Metric({ label, value, tone = 'cyan', subtitle }: { label: string; value: string; tone?: 'cyan' | 'emerald' | 'amber' | 'red' | 'purple'; subtitle?: string }) {
  const tones = {
    cyan: 'border-cyan-300/20 bg-cyan-400/10 text-cyan-100',
    emerald: 'border-emerald-300/20 bg-emerald-400/10 text-emerald-100',
    amber: 'border-amber-300/25 bg-amber-400/10 text-amber-100',
    red: 'border-red-300/25 bg-red-400/10 text-red-100',
    purple: 'border-violet-300/25 bg-violet-400/10 text-violet-100',
  }[tone];
  return (
    <div className={`rounded-2xl border p-4 ${tones}`}>
      <div className="text-xs font-black text-slate-300">{label}</div>
      <div className="mt-2 text-2xl font-black text-white">{value}</div>
      {subtitle ? <div className="mt-1 text-[11px] font-bold text-slate-400">{subtitle}</div> : null}
    </div>
  );
}

function SmallPanel({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-3xl border border-slate-700/70 bg-slate-950/45 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-base font-black text-white">{title}</h3>
        {icon ? <span className="rounded-2xl bg-cyan-400/10 p-2 text-cyan-200">{icon}</span> : null}
      </div>
      {children}
    </div>
  );
}

export default function CustomerServiceOperatingCenterV2() {
  const { user } = useAuth();
  const canAll = canSeeAllBranches(user?.role);
  const [branch, setBranch] = useState(() => effectiveBranchFilter(user, ALL_FILTER, ALL_FILTER) || ALL_FILTER);
  const [rows, setRows] = useState<WorkRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bucket, setBucket] = useState<BucketKey>('now');
  const [selectedKey, setSelectedKey] = useState<string>('');
  const [quickResult, setQuickResult] = useState<QuickResult>('تم التواصل');
  const [note, setNote] = useState('');
  const [nextStep, setNextStep] = useState('');
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [scriptKind, setScriptKind] = useState<ScriptKind>('auto');

  const scopedBranch = useMemo(() => {
    const next = effectiveBranchFilter(user, branch, ALL_FILTER) || ALL_FILTER;
    return normalizeBranchName(next) || next;
  }, [branch, user]);

  useEffect(() => {
    if (!canAll && scopedBranch && scopedBranch !== branch) setBranch(scopedBranch);
  }, [branch, canAll, scopedBranch]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [daily, insights] = await Promise.all([
        fetchCustomerServiceFollowups({ branch: scopedBranch, limit: LIMIT }),
        fetchCustomerServiceInsightPools(scopedBranch),
      ]);
      const merged = dedupe([...daily.map((row) => ({ ...row, source_bucket: 'daily' as const })), ...insightRows(insights)]);
      setRows(merged);
      if (!selectedKey || !merged.some((row) => workKey(row) === selectedKey)) setSelectedKey(workKey(merged[0]));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل مركز خدمة العملاء');
    } finally {
      setLoading(false);
    }
  }, [scopedBranch, selectedKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    const open = rows.filter((row) => !isCompleted(row)).length;
    const urgent = rows.filter((row) => !isCompleted(row) && (row.needs_manager || isOverdue(row))).length;
    const winback = rows.filter((row) => classify(row) === 'winback').length;
    const pamper = rows.filter((row) => classify(row) === 'pamper').length;
    const data = rows.filter((row) => classify(row) === 'data').length;
    const done = rows.filter(isCompleted).length;
    const recovered = rows.filter((row) => row.purchase_after_followup).length;
    const contactedNoPurchase = rows.filter((row) => isCompleted(row) && !row.purchase_after_followup).length;
    const recoverySales = rows.reduce((sum, row) => sum + (row.purchase_after_followup ? Number(row.purchase_amount || 0) : 0), 0);
    return { open, urgent, winback, pamper, data, done, recovered, contactedNoPurchase, recoverySales };
  }, [rows]);

  const searchedRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const digits = q.replace(/\D/g, '');
    if (!q) return rows;
    return rows.filter((row) => {
      const haystack = [customerName(row), getCustomerCodeSafe(row), phoneOf(row), normalizeBranchName(row.branch || ''), reasonFor(row), responsibleName(row)].join(' ').toLowerCase();
      return haystack.includes(q) || (digits.length >= 3 && phoneOf(row).replace(/\D/g, '').includes(digits));
    });
  }, [rows, search]);

  const filtered = useMemo(() => searchedRows.filter((row) => classify(row) === bucket).slice(0, 20), [bucket, searchedRows]);
  const selected = useMemo(() => rows.find((row) => workKey(row) === selectedKey) || filtered[0] || rows[0] || null, [filtered, rows, selectedKey]);
  const selectedKind = selected ? (scriptKind === 'auto' ? recommendedScriptKind(selected) : scriptKind) : 'default';
  const selectedScript = selected ? careScript(selected, scriptKind) : '';
  const selectedObjective = SCRIPT_KINDS.find((kind) => kind.value === (scriptKind === 'auto' ? 'auto' : selectedKind))?.objective || '';

  const opportunities = useMemo(() => {
    const topValue = [...rows].filter((row) => !isCompleted(row)).sort((a, b) => totalSpent(b) - totalSpent(a)).slice(0, 5);
    const reasons = new Map<string, number>();
    rows.forEach((row) => {
      const reason = lossReason(row);
      if (reason && reason !== 'غير محدد') reasons.set(reason, (reasons.get(reason) || 0) + 1);
    });
    const topReasons = [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const promiseRows = rows.filter((row) => !isCompleted(row) && (row.next_followup_date || row.postponed_until)).slice(0, 5);
    return { topValue, topReasons, promiseRows };
  }, [rows]);

  function responsibleName(row: WorkRow) {
    return text(row.responsible_name || row.assigned_to || row.assigned_doctor, 'غير مسند');
  }

  async function saveQuick() {
    if (!selected) return;
    if (selected.virtual) {
      window.location.href = addUrl(selected);
      return;
    }
    setSaving(true);
    try {
      const completed = quickResult === 'تم التواصل' || quickResult === 'تم البيع' || quickResult === 'رقم غير صحيح';
      const updated = await updateFollowupResult(selected.id, {
        contact_method: 'واتساب/اتصال',
        contact_status: quickResult,
        contact_result: quickResult,
        followup_result: quickResult,
        followup_summary: `نتيجة سريعة من مركز التشغيل: ${quickResult}`,
        followup_notes: [note.trim(), nextStep.trim() ? `الخطوة القادمة: ${nextStep.trim()}` : ''].filter(Boolean).join(' | '),
        followup_status: completed ? 'تم' : quickResult,
        status: completed ? 'تم' : quickResult,
        completed_at: completed ? new Date().toISOString() : null,
        needs_manager: quickResult === 'يحتاج مدير',
        purchase_after_followup: quickResult === 'تم البيع' ? true : selected.purchase_after_followup,
        evaluated_by_name: user?.name || 'خدمة العملاء',
        evaluated_at: new Date().toISOString(),
      });
      setRows((current) => current.map((row) => (row.id === selected.id ? { ...row, ...updated } : row)));
      toast.success('تم حفظ النتيجة السريعة');
      setNote('');
      setNextStep('');
    } catch (err) {
      toast.error(`تعذر حفظ النتيجة: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  }

  const bucketButtons: Array<{ key: BucketKey; label: string; count: number; icon: ReactNode }> = [
    { key: 'now', label: 'ابدأ الآن', count: rows.filter((row) => classify(row) === 'now').length, icon: <Sparkles className="h-4 w-4" /> },
    { key: 'pamper', label: 'مرحلة الدلع', count: stats.pamper, icon: <Heart className="h-4 w-4" /> },
    { key: 'winback', label: 'استرجاع العملاء', count: stats.winback, icon: <UserCheck className="h-4 w-4" /> },
    { key: 'data', label: 'تصحيح البيانات', count: stats.data, icon: <ShieldCheck className="h-4 w-4" /> },
    { key: 'done', label: 'المكتمل', count: stats.done, icon: <CheckCircle2 className="h-4 w-4" /> },
  ];

  return (
    <section className="mb-6 rounded-3xl border border-cyan-300/15 bg-gradient-to-br from-slate-950 via-slate-900 to-cyan-950/40 p-5 shadow-2xl" dir="rtl">
      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-400/10 px-3 py-1 text-xs font-black text-cyan-100">
            <Sparkles className="h-4 w-4" /> مركز تشغيل خدمة العملاء المطوّر
          </div>
          <h2 className="mt-3 text-2xl font-black text-white">كل المميزات في شاشة واحدة: تشغيل + دلع + استرجاع + تحليلات + سكريبتات</h2>
          <p className="mt-1 text-sm font-bold text-slate-300">الصفحة الأساسية والتقارير القديمة موجودة بالكامل تحت المركز، والجزء ده يجمع أهم الأفكار في واجهة تشغيل أسرع.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canAll ? (
            <select value={branch} onChange={(event) => setBranch(event.target.value)} className="rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-2 text-sm font-bold text-white outline-none focus:border-cyan-400">
              {BRANCH_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          ) : null}
          <button onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-2xl border border-cyan-300/25 bg-cyan-400/10 px-4 py-2 text-sm font-black text-cyan-100 hover:bg-cyan-400/20 disabled:opacity-60">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> تحديث المركز
          </button>
        </div>
      </div>

      <div className="mb-4 grid gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Metric label="مفتوح" value={`${stats.open}`} />
        <Metric label="عاجل/متأخر" value={`${stats.urgent}`} tone={stats.urgent ? 'red' : 'emerald'} />
        <Metric label="مرحلة الدلع" value={`${stats.pamper}`} tone="amber" />
        <Metric label="استرجاع" value={`${stats.winback}`} tone="cyan" />
        <Metric label="تصحيح بيانات" value={`${stats.data}`} tone={stats.data ? 'amber' : 'emerald'} />
        <Metric label="مكتمل" value={`${stats.done}`} tone="emerald" />
        <Metric label="رجع واشترى" value={`${stats.recovered}`} tone="emerald" />
        <Metric label="مبيعات بعد المتابعة" value={money(stats.recoverySales)} tone="purple" subtitle="من النتائج المسجلة" />
      </div>

      {error ? (
        <div className="mb-4 rounded-2xl border border-amber-300/25 bg-amber-400/10 p-3 text-sm font-bold text-amber-100">
          <AlertTriangle className="ml-2 inline h-4 w-4" /> {error}
        </div>
      ) : null}

      {loading && rows.length === 0 ? <LoadingBox /> : (
        <div className="grid gap-4 xl:grid-cols-[0.95fr_1.25fr_0.9fr]">
          <div className="rounded-3xl border border-slate-700/70 bg-slate-950/45 p-4">
            <div className="relative mb-3">
              <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="بحث باسم العميل / الكود / الرقم / السبب" className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 py-2.5 pr-10 pl-3 text-sm font-bold text-white outline-none focus:border-cyan-400" />
            </div>
            <div className="mb-3 grid grid-cols-2 gap-2">
              {bucketButtons.map((item) => (
                <button key={item.key} onClick={() => setBucket(item.key)} className={`rounded-2xl border px-3 py-2 text-right text-xs font-black transition ${bucket === item.key ? 'border-cyan-300/50 bg-cyan-400/15 text-cyan-50' : 'border-slate-700 bg-slate-900/70 text-slate-300 hover:bg-slate-800'}`}>
                  <span className="mb-1 flex items-center gap-1">{item.icon}{item.label}</span>
                  <b className="text-lg text-white">{item.count}</b>
                </button>
              ))}
            </div>
            <div className="max-h-[560px] space-y-2 overflow-auto pr-1">
              {filtered.length ? filtered.map((row) => {
                const active = selected && workKey(selected) === workKey(row);
                return (
                  <button key={`${row.id}-${workKey(row)}`} onClick={() => { setSelectedKey(workKey(row)); setScriptKind('auto'); }} className={`w-full rounded-2xl border p-3 text-right transition ${active ? 'border-cyan-300/60 bg-cyan-400/15' : 'border-slate-700 bg-slate-900/70 hover:bg-slate-800'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <b className="block text-sm text-white">{customerName(row)}</b>
                        <span className="text-xs font-bold text-slate-400">{getCustomerCodeSafe(row) || 'بدون كود'} · {phoneOf(row) || 'بدون رقم'}</span>
                      </div>
                      <span className="rounded-full bg-slate-950/70 px-2 py-1 text-[11px] font-black text-cyan-100">{score(row)}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1 text-[11px] font-black">
                      <span className="rounded-full bg-amber-400/10 px-2 py-1 text-amber-100">{reasonFor(row)}</span>
                      <span className="rounded-full bg-slate-800 px-2 py-1 text-slate-300">{normalizeBranchName(row.branch || '') || 'فرع غير محدد'}</span>
                    </div>
                  </button>
                );
              }) : (
                <div className="rounded-2xl border border-dashed border-slate-700 p-6 text-center text-sm font-bold text-slate-400">لا توجد عناصر في هذا المسار حاليًا.</div>
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-cyan-300/15 bg-slate-950/55 p-5">
            {selected ? (
              <>
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <h3 className="text-2xl font-black text-white">{customerName(selected)}</h3>
                    <p className="mt-1 text-sm font-bold text-slate-400">{getCustomerCodeSafe(selected) || 'بدون كود'} · {phoneOf(selected) || 'بدون رقم'} · {normalizeBranchName(selected.branch || '') || 'فرع غير محدد'}</p>
                  </div>
                  <span className="rounded-2xl border border-cyan-300/25 bg-cyan-400/10 px-3 py-2 text-sm font-black text-cyan-100">{reasonFor(selected)}</span>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-4">
                  <Metric label="إجمالي مشتريات" value={money(totalSpent(selected))} />
                  <Metric label="متوسط شهري" value={money(avgMonthly(selected))} />
                  <Metric label="عدد الفواتير" value={`${invoicesCount(selected)}`} tone="purple" />
                  <Metric label="موعد المتابعة" value={formatDate(dueAt(selected)).slice(0, 14)} />
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="rounded-2xl border border-slate-700 bg-slate-900/65 p-3 text-xs font-bold leading-6 text-slate-300">
                    <b className="text-white">آخر حالة للعميل</b><br />
                    الحالة: {customerStatus(selected)}<br />
                    التصنيف: {segment(selected)}<br />
                    المسؤول: {responsibleName(selected)}<br />
                    آخر شراء: {formatDate(selected.customer_metrics?.last_purchase || selected.last_purchase_date)}
                  </div>
                  <div className="rounded-2xl border border-slate-700 bg-slate-900/65 p-3 text-xs font-bold leading-6 text-slate-300">
                    <b className="text-white">خطة الإنقاذ المقترحة</b><br />
                    1) استخدم السكريبت المناسب.<br />
                    2) اسأل عن سبب التوقف أو الملاحظة.<br />
                    3) سجل النتيجة والخطوة القادمة.<br />
                    4) لو فيه وعد للعميل، افتح التسجيل الرسمي وحدد موعد متابعة.
                  </div>
                </div>
                <div className="mt-4 rounded-2xl border border-emerald-300/20 bg-emerald-400/10 p-4">
                  <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                      <h4 className="text-sm font-black text-emerald-100">سكريبتات الدلع والاسترجاع — صيدليات دواء</h4>
                      <p className="text-xs font-bold text-slate-300">هدف الرسالة: {selectedObjective}</p>
                    </div>
                    <select value={scriptKind} onChange={(event) => setScriptKind(event.target.value as ScriptKind)} className="rounded-xl border border-emerald-300/20 bg-slate-950/80 px-3 py-2 text-xs font-bold text-white outline-none focus:border-emerald-300">
                      {SCRIPT_KINDS.map((kind) => <option key={kind.value} value={kind.value}>{kind.label}</option>)}
                    </select>
                  </div>
                  <pre className="whitespace-pre-wrap rounded-xl bg-slate-950/70 p-4 text-sm font-bold leading-7 text-slate-100">{selectedScript}</pre>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button onClick={() => navigator.clipboard.writeText(selectedScript).then(() => toast.success('تم نسخ السكريبت'))} className="rounded-xl border border-emerald-300/25 bg-emerald-400/15 px-3 py-2 text-xs font-black text-emerald-100">نسخ السكريبت</button>
                    {waHref(selected, scriptKind) ? <a href={waHref(selected, scriptKind)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl bg-emerald-400 px-3 py-2 text-xs font-black text-slate-950"><MessageSquare className="h-4 w-4" /> واتساب</a> : null}
                    {phoneOf(selected) ? <a href={`tel:${phoneOf(selected)}`} className="inline-flex items-center gap-2 rounded-xl border border-cyan-300/25 px-3 py-2 text-xs font-black text-cyan-100"><PhoneCall className="h-4 w-4" /> اتصال</a> : null}
                  </div>
                </div>
              </>
            ) : <div className="p-8 text-center text-sm font-bold text-slate-400">اختر عميلًا من قائمة الأولوية.</div>}
          </div>

          <div className="rounded-3xl border border-slate-700/70 bg-slate-950/45 p-4">
            <h3 className="mb-3 text-lg font-black text-white">تسجيل نتيجة سريع</h3>
            {selected ? (
              <div className="space-y-3">
                <select value={quickResult} onChange={(e) => setQuickResult(e.target.value as QuickResult)} className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-3 py-3 text-sm font-bold text-white outline-none focus:border-cyan-400">
                  {RESULT_OPTIONS.map((item) => <option key={item}>{item}</option>)}
                </select>
                <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="ملاحظة مختصرة: العميل محتاج إيه؟ قال إيه؟" className="min-h-24 w-full rounded-2xl border border-slate-700 bg-slate-950/70 p-3 text-sm font-bold text-white outline-none focus:border-cyan-400" />
                <input value={nextStep} onChange={(e) => setNextStep(e.target.value)} placeholder="الخطوة القادمة: اتصال غدًا / متابعة صنف / تصعيد..." className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-3 py-3 text-sm font-bold text-white outline-none focus:border-cyan-400" />
                <button onClick={() => void saveQuick()} disabled={saving} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-cyan-400 px-4 py-3 text-sm font-black text-slate-950 hover:bg-cyan-300 disabled:opacity-60">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} {selected.virtual ? 'تحويل لمتابعة رسمية' : 'حفظ النتيجة السريعة'}
                </button>
                <a href={detailsUrl(selected)} className="block rounded-2xl border border-slate-700 px-4 py-3 text-center text-sm font-black text-slate-200 hover:bg-slate-800">فتح التسجيل/التفاصيل الرسمية</a>
                <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-3 text-xs font-bold leading-6 text-slate-300">
                  <b className="text-white">Checklist قبل الإغلاق:</b><br />
                  {hasValidPhone(selected) ? '✅ رقم صحيح' : '⚠️ رقم يحتاج مراجعة'}<br />
                  {getCustomerCodeSafe(selected) ? '✅ كود العميل موجود' : '⚠️ بدون كود'}<br />
                  {resolveCustomerBranch(selected).needsReview ? '⚠️ الفرع يحتاج مراجعة' : '✅ الفرع واضح'}<br />
                  {isOverdue(selected) ? `⚠️ متأخر ${delayLabel(selected)}` : '✅ لا يوجد تأخير حرج'}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <SmallPanel title="فرص اليوم الذهبية" icon={<Target className="h-4 w-4" />}>
          <div className="space-y-2">
            {opportunities.topValue.length ? opportunities.topValue.map((row) => (
              <button key={`gold-${workKey(row)}`} onClick={() => setSelectedKey(workKey(row))} className="w-full rounded-2xl border border-amber-300/15 bg-amber-400/10 p-3 text-right text-xs font-bold text-amber-50 hover:bg-amber-400/15">
                <b className="block text-sm text-white">{customerName(row)}</b>
                فرصة قيمة عالية · مشتريات {money(totalSpent(row))} ج · {reasonFor(row)}
              </button>
            )) : <p className="text-sm font-bold text-slate-400">لا توجد فرص ذهبية حاليًا.</p>}
          </div>
        </SmallPanel>
        <SmallPanel title="أسباب فقد أو ضعف الشراء" icon={<BarChart3 className="h-4 w-4" />}>
          <div className="space-y-2">
            {opportunities.topReasons.length ? opportunities.topReasons.map(([reason, value]) => (
              <div key={reason} className="flex items-center justify-between rounded-2xl border border-slate-700 bg-slate-900/70 p-3 text-xs font-bold text-slate-200">
                <span className="line-clamp-2">{reason}</span>
                <b className="rounded-full bg-slate-950 px-2 py-1 text-cyan-100">{value}</b>
              </div>
            )) : <p className="text-sm font-bold text-slate-400">كلما سجل الفريق سبب عدم الشراء ستظهر هنا أسباب الفقد بوضوح.</p>}
          </div>
        </SmallPanel>
        <SmallPanel title="وعود العميل والمتابعة القادمة" icon={<ClipboardList className="h-4 w-4" />}>
          <div className="space-y-2">
            {opportunities.promiseRows.length ? opportunities.promiseRows.map((row) => (
              <button key={`promise-${workKey(row)}`} onClick={() => setSelectedKey(workKey(row))} className="w-full rounded-2xl border border-cyan-300/15 bg-cyan-400/10 p-3 text-right text-xs font-bold text-cyan-50 hover:bg-cyan-400/15">
                <b className="block text-sm text-white">{customerName(row)}</b>
                وعد/متابعة: {formatDate(row.next_followup_date || row.postponed_until)} · {reasonFor(row)}
              </button>
            )) : <p className="text-sm font-bold text-slate-400">لا توجد وعود متابعة ظاهرة حاليًا.</p>}
          </div>
        </SmallPanel>
      </div>

      <div className="mt-4 rounded-3xl border border-violet-300/15 bg-violet-400/10 p-4">
        <div className="mb-3 flex items-center gap-2 text-violet-100">
          <Trophy className="h-5 w-5" />
          <h3 className="text-lg font-black text-white">كل التحليلات والمميزات القديمة والجديدة</h3>
        </div>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {FEATURE_LINKS.map((item) => (
            <a key={item.tab} href={tabUrl(item.tab)} className="rounded-2xl border border-violet-300/15 bg-slate-950/50 p-3 text-right transition hover:bg-violet-400/15">
              <b className="block text-sm text-white">{item.label}</b>
              <span className="text-xs font-bold text-slate-400">{item.desc}</span>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
