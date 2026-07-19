import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Eye,
  ListChecks,
  Pencil,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Star,
  UserCheck,
  X,
} from 'lucide-react';
import {
  defaultReviewState,
  defaultSevereErrors,
  evaluateConversationReview,
  monthCycleFromDate,
  REVIEW_CRITERIA,
  SEVERE_ERRORS,
  type ConversationReviewState,
  type ReviewCriterionKey,
  type SevereErrorKey,
  type SevereErrorsState,
} from '@/lib/conversationReviews';
import { supabase } from '@/lib/supabase';
import { useAuth, getCurrentUserProfile } from '@/hooks/useAuth';
import { normalizeBranchName } from '@/lib/branch';
import { normalizeRole } from '@/lib/core/permissionSystem';
import { canViewAllBranches, isDoctorRole, normalizeArabicName, rowMatchesCurrentUserScope } from '@/lib/security/userDataScope';
import { toast } from 'sonner';
import { useSupabaseQuery, logActivity } from '@/hooks/useSupabaseQuery';
import { persistPointsTransaction, applyStaffDelta } from '@/lib/pointsPersistence';
import { canonicalMaxPoints, canonicalSnapshotPoints } from '@/lib/pointsLedger';
import { getCycleForDate } from '@/lib/pharmacy-cycle';
import type { Customer } from '@/types/database';
import type { CustomerMetric } from '@/lib/api/customers';
import { getCustomers } from '@/lib/api/customers';
import { toNumber } from '@/lib/utils';
import { isActiveStaffFilter } from '@/lib/staffActiveFilter';
import { mergeStaffChoices, reviewerChoices } from '@/lib/staffFallback';
import { TABLES } from '@/lib/supabaseTables';
import { notifyEmployee } from '@/lib/notificationService';
import { usePendingFormNavigationGuard } from '@/hooks/useUnsavedChangesGuard';

interface StaffOpt {
  id: string;
  name: string;
  role: string;
  branch: string;
  branch_id?: string | null;
  status?: string | null;
  active?: boolean | null;
  deleted_at?: string | null;
  is_deleted?: boolean | null;
  points?: number | null;
  max_points?: number | null;
}

interface ConversationReviewHistoryRow {
  id?: string;
  created_at?: string | null;
  updated_at?: string | null;
  reviewer_id?: string | null;
  reviewer_name?: string | null;
  reviewer_role?: string | null;
  staff_id?: string | null;
  doctor_id?: string | null;
  staff_name?: string | null;
  staff_role?: string | null;
  doctor_name?: string | null;
  branch?: string | null;
  customer_id?: string | null;
  customer_name?: string | null;
  customer_code?: string | null;
  customer_phone?: string | null;
  invoice_number?: string | null;
  evaluation_kind?: string | null;
  conversation_type?: string | null;
  evaluation_reason?: string | null;
  conversation_date?: string | null;
  total_score?: number | string | null;
  final_score?: number | string | null;
  level?: string | null;
  point_impact?: number | string | null;
  doctor_points_impact?: number | string | null;
  main_positive_reason?: string | null;
  main_negative_reason?: string | null;
  reviewer_notes?: string | null;
  training_recommendation?: string | null;
  month_cycle?: string | null;
  raw_scores?: any;
  review_items?: any;
  manager_review_score?: number | string | null;
  manager_review_notes?: string | null;
  manager_reviewed_by?: string | null;
  manager_reviewed_at?: string | null;
}

interface ReviewDraftPayload {
  form: typeof emptyReviewForm;
  reviewState: ConversationReviewState;
  severeErrors: SevereErrorsState;
  custSearch: string;
  savedAt: string;
}

const EVAL_KINDS = [
  'واتساب',
  'مكالمة',
  'داخل الفرع',
  'متابعة عميل',
  'شكوى',
  'عملية بيع',
  'مراجعة فاتورة',
];
const EVAL_REASONS = [
  'مراجعة عشوائية',
  'شكوى عميل',
  'متابعة جودة',
  'عملية بيع مهمة',
  'عميل VIP',
  'خطأ فاتورة',
  'تقييم تدريب',
  'مراجعة أداء شهرية',
];
const REVIEW_DRAFT_KEY = 'dawaa_conversation_review_draft_v3';

const emptyReviewForm = {
  reviewerId: '',
  staffId: '',
  customerId: '',
  customerCode: '',
  customerName: '',
  customerPhone: '',
  evaluationKind: 'واتساب',
  evaluationReason: 'مراجعة عشوائية',
  invoiceNo: '',
  conversationDate: '',
  firstCustomerMessageAt: '',
  firstStaffReplyAt: '',
  followUpPromised: false,
  followUpPromisedAt: '',
  followUpReturnedAt: '',
  notes: '',
  reviewerNotes: '',
  trainingRecommendationManual: '',
};

function canUserSeeConversationReviewBranch(
  user: { role?: string | null; name?: string | null; username?: string | null; branch?: string | null } | null | undefined,
  branch?: string | null
) {
  if (!user) return false;
  if (canViewAllBranches(user)) return true;

  const normalizedBranch = normalizeBranchName(branch || '');
  const allowedReviewBranches = new Set(['فرع الشامي', 'فرع شكري']);
  const normalizedName = normalizeArabicName(user.name || user.username || '');
  const normalizedUsername = normalizeArabicName(user.username || '');
  const explicitReviewUsers = new Set(['ضحى', 'دنيا']);
  const isExplicitReviewUser = explicitReviewUsers.has(normalizedName) || explicitReviewUsers.has(normalizedUsername);
  const isCustomerServiceManager = normalizeRole(user.role) === 'customer_service_manager';

  // استثناء آمن لعرض تقييم المحادثات في فرعي الشامي وشكري فقط لهؤلاء المستخدمين.
  if ((isExplicitReviewUser || isCustomerServiceManager) && allowedReviewBranches.has(normalizedBranch)) {
    return true;
  }

  return rowMatchesCurrentUserScope(user, { branch } as Record<string, unknown>);
}

function asUuid(value?: string | null) {
  if (!value) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

function isoInputNow() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function minutesBetween(start?: string, end?: string) {
  if (!start || !end) return null;
  const a = new Date(start).getTime();
  const b = new Date(end).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return Math.round((b - a) / 60000);
}

function responseChoice(minutes: number | null) {
  if (minutes == null) return null;
  if (minutes <= 5) return 'within_5';
  if (minutes <= 10) return 'five_to_10';
  if (minutes <= 20) return 'ten_to_20';
  if (minutes <= 30) return 'over_20';
  return 'over_30';
}

function followupChoice(minutes: number | null, promised: boolean) {
  if (!promised) return null;
  if (minutes == null) return 'never';
  if (minutes <= 5) return 'within_5';
  if (minutes <= 10) return 'five_to_10';
  if (minutes <= 20) return 'over_10';
  return 'over_20';
}

function choiceLabel(key: ReviewCriterionKey, choice: string) {
  const criterion = REVIEW_CRITERIA.find((item) => item.key === key);
  return criterion?.choices.find((item) => item.value === choice)?.label || choice;
}

function choicePoints(key: ReviewCriterionKey, choice: string) {
  const criterion = REVIEW_CRITERIA.find((item) => item.key === key);
  return criterion?.choices.find((item) => item.value === choice)?.pointsEarned ?? 0;
}

function getScore(key: ReviewCriterionKey, state: ConversationReviewState) {
  const criterion = REVIEW_CRITERIA.find((item) => item.key === key);
  if (!criterion || !state[key]?.applies) return null;
  return choicePoints(key, state[key].choice);
}

function scoreOf(row: ConversationReviewHistoryRow) {
  return toNumber(row.final_score ?? row.total_score ?? 0);
}

function impactOf(row: ConversationReviewHistoryRow) {
  return toNumber(row.doctor_points_impact ?? row.point_impact ?? 0);
}

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 16);
  return d.toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' });
}

function missingColumnName(message?: string) {
  if (!message) return null;
  const patterns = [
    /column\s+"?([a-zA-Z0-9_]+)"?\s+of relation/i,
    /column\s+"?([a-zA-Z0-9_]+)"?\s+does not exist/i,
    /Could not find the '([^']+)' column/i,
    /Could not find the column '([^']+)'/i,
  ];
  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

async function insertSafe(table: string, payload: Record<string, unknown>) {
  const currentPayload = { ...payload };
  const removedColumns: string[] = [];
  for (let attempt = 0; attempt < 35; attempt += 1) {
    const ins = await supabase.from(table).insert(currentPayload).select('id').single();
    if (!ins.error) return { id: ins.data?.id as string | undefined, removedColumns };
    const missing = missingColumnName(ins.error.message);
    if (missing && Object.prototype.hasOwnProperty.call(currentPayload, missing)) {
      delete currentPayload[missing];
      removedColumns.push(missing);
      continue;
    }
    throw new Error(`${table}: ${ins.error.message}`);
  }
  throw new Error(`${table}: schema mismatch too large`);
}

async function updateSafe(table: string, id: string, payload: Record<string, unknown>) {
  const currentPayload = { ...payload };
  const removedColumns: string[] = [];
  for (let attempt = 0; attempt < 35; attempt += 1) {
    const upd = await supabase
      .from(table)
      .update(currentPayload)
      .eq('id', id)
      .select('id')
      .single();
    if (!upd.error) return { id: upd.data?.id as string | undefined, removedColumns };
    const missing = missingColumnName(upd.error.message);
    if (missing && Object.prototype.hasOwnProperty.call(currentPayload, missing)) {
      delete currentPayload[missing];
      removedColumns.push(missing);
      continue;
    }
    throw new Error(`${table}: ${upd.error.message}`);
  }
  throw new Error(`${table}: schema mismatch too large`);
}

function normalizeRawScores(raw: any) {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return raw;
}

function rowReviewItems(row: ConversationReviewHistoryRow) {
  const explicit = Array.isArray(row.review_items) ? row.review_items : null;
  if (explicit) return explicit;
  const raw = normalizeRawScores(row.raw_scores);
  if (Array.isArray(raw?.result?.reviewItems)) return raw.result.reviewItems;
  if (Array.isArray(raw?.review_items)) return raw.review_items;
  return [];
}

function isGeneralManager(user: any) {
  const role = String(user?.role || '').toLowerCase();
  const name = String(user?.name || '');
  return (
    role.includes('admin') ||
    role.includes('manager') ||
    role.includes('general') ||
    role.includes('owner') ||
    name.includes('معاذ')
  );
}

export default function Reviews() {
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);
  const [reviewState, setReviewState] = useState<ConversationReviewState>(defaultReviewState());
  const [severeErrors, setSevereErrors] = useState<SevereErrorsState>(defaultSevereErrors());
  const [custSearch, setCustSearch] = useState('');
  const [custHits, setCustHits] = useState<CustomerMetric[]>([]);
  const [repeatInfo, setRepeatInfo] = useState<{ count: number; multiplier: number } | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [reviewHistory, setReviewHistory] = useState<ConversationReviewHistoryRow[]>([]);
  const [draftRestored, setDraftRestored] = useState(false);
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const [selectedReview, setSelectedReview] = useState<ConversationReviewHistoryRow | null>(null);
  const [selectedReviewId, setSelectedReviewId] = useState<string | null>(null);
  const [editingReview, setEditingReview] = useState<ConversationReviewHistoryRow | null>(null);
  const [managerReviewTarget, setManagerReviewTarget] =
    useState<ConversationReviewHistoryRow | null>(null);

  const closeSelectedReview = useCallback(() => {
    setSelectedReview(null);
    setSelectedReviewId(null);
    setHistoryError(null);
    setHistoryLoading(false);
    const params = new URLSearchParams(window.location.search);
    if (params.has('id')) {
      params.delete('id');
      const search = params.toString();
      window.history.replaceState(null, '', `${window.location.pathname}${search ? `?${search}` : ''}`);
    }
  }, []);

  useEffect(() => {
    return () => {
      closeSelectedReview();
    };
  }, [closeSelectedReview]);
  const [managerSaving, setManagerSaving] = useState(false);
  const [managerForm, setManagerForm] = useState({
    score: '100',
    notes: '',
    strengths: '',
    improvements: '',
  });
  const [editForm, setEditForm] = useState({
    staff_id: '',
    staff_name: '',
    customer_name: '',
    customer_code: '',
    customer_phone: '',
    final_score: '',
    point_impact: '',
    reviewer_notes: '',
    training_recommendation: '',
    manager_note: '',
  });
  const [form, setForm] = useState(() => ({
    ...emptyReviewForm,
    reviewerId: user?.id || '',
    conversationDate: isoInputNow(),
  }));

  const { data: staff } = useSupabaseQuery<StaffOpt>({
    table: 'staff',
    filters: isActiveStaffFilter(),
    realtimeEnabled: false,
  });
  const staffOptions = useMemo(() => {
    const choices = mergeStaffChoices(staff);
    if (canViewAllBranches(user)) return choices;
    if (isDoctorRole(user)) {
      return choices.filter(
        (row) =>
          row.id === (user?.staffId || user?.id) ||
          row.name === user?.name ||
          rowMatchesCurrentUserScope(user, row as unknown as Record<string, unknown>)
      );
    }
    return choices.filter((row) => rowMatchesCurrentUserScope(user, row as unknown as Record<string, unknown>));
  }, [staff, user]);
  const reviewers = useMemo(() => {
    const choices = reviewerChoices(staff);
    if (user && !choices.some((row) => row.id === user.id)) {
      return [
        {
          id: user.id,
          name: user.name,
          role: user.role,
          branch: user.branch || '',
          points: null,
          max_points: null,
        },
        ...choices,
      ];
    }
    return choices;
  }, [staff, user]);

  const canManageReviews = isGeneralManager(user);
  const selectedStaff = staffOptions.find((s) => s.id === form.staffId) || null;
  const selectedReviewer = reviewers.find((s) => s.id === form.reviewerId) || reviewers[0] || null;
  const responseMinutes = useMemo(
    () => minutesBetween(form.firstCustomerMessageAt, form.firstStaffReplyAt),
    [form.firstCustomerMessageAt, form.firstStaffReplyAt]
  );
  const followupDelayMinutes = useMemo(
    () => minutesBetween(form.followUpPromisedAt, form.followUpReturnedAt),
    [form.followUpPromisedAt, form.followUpReturnedAt]
  );
  const result = useMemo(
    () => {
      try {
        return evaluateConversationReview(reviewState, severeErrors);
      } catch (err) {
        console.warn('[reviews] evaluateConversationReview failed', err);
        return {
          finalScore: 0,
          earnedPoints: 0,
          totalApplicablePoints: 0,
          totalApplicableItems: 0,
          totalNotApplicableItems: 0,
          baseDoctorImpact: 0,
          extraPenaltyPoints: 0,
          doctorPointsImpact: 0,
          impactStatus: 'pending',
          impactLabel: '',
          impactReason: '',
          level: 'غير محدد',
          mainPositiveReason: '',
          mainNegativeReason: '',
          trainingRecommendation: '',
          hasSevereError: false,
          forgottenCustomer: false,
          missedSalesOpportunity: false,
          successfulCrossSell: false,
          handledAngryCustomerWell: false,
          excellentCase: false,
          repeatErrorType: null,
          reviewItems: [],
          extraPenalties: [],
        } as any;
      }
    },
    [reviewState, severeErrors]
  );
  const finalTraining = form.trainingRecommendationManual || result.trainingRecommendation;
  const conversationDate = form.conversationDate || isoInputNow();
  const reviewCycle = useMemo(
    () => getCycleForDate(new Date(conversationDate)),
    [conversationDate]
  );
  const monthCycle = useMemo(() => monthCycleFromDate(conversationDate), [conversationDate]);

  const historyStats = useMemo(() => {
    const byBranch = new Map<
      string,
      {
        branch: string;
        count: number;
        total: number;
        low: number;
        positive: number;
        negative: number;
      }
    >();
    for (const row of reviewHistory) {
      const branch = row.branch || 'غير محدد';
      const score = scoreOf(row);
      const impact = impactOf(row);
      const entry = byBranch.get(branch) || {
        branch,
        count: 0,
        total: 0,
        low: 0,
        positive: 0,
        negative: 0,
      };
      entry.count += 1;
      entry.total += score;
      if (score < 70) entry.low += 1;
      if (impact > 0) entry.positive += impact;
      if (impact < 0) entry.negative += Math.abs(impact);
      byBranch.set(branch, entry);
    }
    return Array.from(byBranch.values())
      .map((row) => ({ ...row, avg: row.count ? Math.round(row.total / row.count) : 0 }))
      .sort((a, b) => b.count - a.count);
  }, [reviewHistory]);

  const loadReviewHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const { data, error } = await supabase
        .from('conversation_sales_reviews')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(120);
      if (error) throw error;
      const rows = ((data || []) as ConversationReviewHistoryRow[]).filter((row) =>
        canUserSeeConversationReviewBranch(user, row.branch)
      );
      setReviewHistory(rows);
      const params = new URLSearchParams(window.location.search);
      const id = params.get('id');
      if (id) {
        const found = rows.find((row) => row.id === id);
        if (found) {
          setSelectedReview(found);
          setSelectedReviewId(found.id ?? null);
        } else {
          setSelectedReview(null);
          setSelectedReviewId(null);
        }
      }
    } catch (error) {
      setHistoryError((error as Error).message);
      setReviewHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadReviewHistory();
  }, [loadReviewHistory]);

  useEffect(() => {
    if (draftRestored) return;
    try {
      const raw = window.localStorage.getItem(REVIEW_DRAFT_KEY);
      if (!raw) {
        setDraftRestored(true);
        return;
      }
      const draft = JSON.parse(raw) as Partial<ReviewDraftPayload>;
      if (draft.form)
        setForm((current) => ({
          ...current,
          ...draft.form,
          reviewerId: draft.form?.reviewerId || current.reviewerId || user?.id || '',
        }));
      if (draft.reviewState) setReviewState(draft.reviewState);
      if (draft.severeErrors) setSevereErrors(draft.severeErrors);
      if (typeof draft.custSearch === 'string') setCustSearch(draft.custSearch);
      if (draft.savedAt) setDraftSavedAt(draft.savedAt);
    } catch {
      // تجاهل أي مسودة تالفة
    } finally {
      setDraftRestored(true);
    }
  }, [draftRestored, user?.id]);

  useEffect(() => {
    if (!draftRestored) return;
    const timer = window.setTimeout(() => {
      const savedAt = new Date().toISOString();
      const draft: ReviewDraftPayload = { form, reviewState, severeErrors, custSearch, savedAt };
      window.localStorage.setItem(REVIEW_DRAFT_KEY, JSON.stringify(draft));
      setDraftSavedAt(savedAt);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [custSearch, draftRestored, form, reviewState, severeErrors]);

  const setCriterionApplies = (key: ReviewCriterionKey, applies: boolean) => {
    setReviewState((current) => ({ ...current, [key]: { ...current[key], applies } }));
  };

  const setCriterionChoice = (key: ReviewCriterionKey, choice: string) => {
    setReviewState((current) => ({ ...current, [key]: { ...current[key], choice } }));
  };

  const setCriterionNotes = (key: ReviewCriterionKey, notes: string) => {
    setReviewState((current) => ({ ...current, [key]: { ...current[key], notes } }));
  };

  const setSevere = (key: SevereErrorKey, active: boolean) => {
    setSevereErrors((current) => ({ ...current, [key]: active }));
  };

  const applyTiming = () => {
    const firstChoice = responseChoice(responseMinutes);
    const waitChoice = followupChoice(followupDelayMinutes, form.followUpPromised);
    setReviewState((current) => ({
      ...current,
      first_response_speed: firstChoice
        ? {
            ...current.first_response_speed,
            applies: true,
            choice: firstChoice,
            notes: `مدة أول رد: ${responseMinutes} دقيقة`,
          }
        : current.first_response_speed,
      followup_after_wait: waitChoice
        ? {
            ...current.followup_after_wait,
            applies: true,
            choice: waitChoice,
            notes:
              waitChoice === 'never'
                ? 'تم وعد العميل بالمتابعة ولم يتم الرجوع له'
                : `مدة الرجوع بعد الوعد: ${followupDelayMinutes} دقيقة`,
          }
        : { ...current.followup_after_wait, applies: false },
    }));
    toast.success('تم تطبيق توقيت الرد والمتابعة على بنود التقييم');
  };

  const loadCustomersHits = async () => {
    const q = custSearch.trim();
    if (q.length < 2) {
      setCustHits([]);
      return;
    }
    try {
      const res = await getCustomers({ search: q, limit: 15, offset: 0 });
      setCustHits(res.customers);
    } catch {
      setCustHits([]);
    }
  };

  const countPreviousReviewErrors = async () => {
    if (!selectedStaff || !result.repeatErrorType) return 0;
    try {
      const { data, error } = await supabase
        .from(TABLES.employeeTransactions)
        .select('id,description,month_cycle')
        .eq('staff_id', selectedStaff.id)
        .eq('month_cycle', monthCycle)
        .ilike('description', `%review_error:${result.repeatErrorType}%`);
      if (!error) return data?.length || 0;
    } catch {
      // fallback below
    }

    const { data } = await supabase
      .from(TABLES.employeeTransactions)
      .select('id,description,created_at')
      .eq('staff_id', selectedStaff.id)
      .gte('created_at', `${reviewCycle.start.toISOString().slice(0, 10)}T00:00:00`)
      .lte('created_at', `${reviewCycle.end.toISOString().slice(0, 10)}T23:59:59`)
      .ilike('description', `%review_error:${result.repeatErrorType}%`);
    return data?.length || 0;
  };

  const save = async (): Promise<boolean> => {
    if (!selectedStaff) {
      toast.error('اختر الدكتور أو الموظف الذي يتم تقييمه');
      return false;
    }
    if (!selectedReviewer) {
      toast.error('اختر من يقوم بالتقييم');
      return false;
    }
    if (result.totalApplicableItems === 0 || result.totalApplicablePoints === 0) {
      toast.error('فعّل بند واحد على الأقل قبل حفظ التقييم');
      return false;
    }

    setSaving(true);
    try {
      const previousCount = await countPreviousReviewErrors();
      const multiplier =
        result.doctorPointsImpact < 0 && result.repeatErrorType ? previousCount + 1 : 1;
      const repeatedDoctorImpact =
        result.doctorPointsImpact < 0
          ? -Math.abs(result.doctorPointsImpact) * multiplier
          : result.doctorPointsImpact;
      setRepeatInfo({ count: previousCount, multiplier });

      const selectedChoices = reviewState;
      const payload = {
        reviewer_id: asUuid(selectedReviewer.id || user?.id),
        reviewer_name: selectedReviewer.name || user?.name || null,
        reviewer_role: selectedReviewer.role || user?.role || null,
        staff_id: asUuid(selectedStaff.id),
        doctor_id: asUuid(selectedStaff.id),
        staff_name: selectedStaff.name,
        staff_role: selectedStaff.role,
        branch: selectedStaff.branch,
        branch_id: asUuid(selectedStaff.branch_id) ?? null,
        customer_id: form.customerId || form.customerCode || null,
        customer_name: form.customerName || null,
        customer_code: form.customerCode || null,
        customer_phone: form.customerPhone || null,
        evaluation_kind: form.evaluationKind,
        conversation_type: form.evaluationKind,
        conversation_date: new Date(conversationDate).toISOString(),
        invoice_number: form.invoiceNo || null,
        invoice_time: form.conversationDate ? new Date(form.conversationDate).toISOString() : null,
        evaluation_reason: form.evaluationReason,
        base_score: 100,
        positive_points: result.earnedPoints,
        negative_points: Math.max(0, result.totalApplicablePoints - result.earnedPoints),
        severe_error_points: Math.abs(result.extraPenaltyPoints),
        total_score: result.finalScore,
        final_score: result.finalScore,
        level: result.level,
        conversation_level: result.level,
        point_impact: repeatedDoctorImpact,
        base_points_impact: result.baseDoctorImpact,
        extra_penalty_points: result.extraPenaltyPoints,
        doctor_points_impact: repeatedDoctorImpact,
        impact_status: result.impactStatus,
        total_applicable_items: result.totalApplicableItems,
        total_not_applicable_items: result.totalNotApplicableItems,
        total_applicable_points: result.totalApplicablePoints,
        earned_points: result.earnedPoints,
        main_positive_reason: result.mainPositiveReason,
        main_negative_reason: result.mainNegativeReason,
        top_positive_reason: result.mainPositiveReason,
        top_deduction_reason: result.mainNegativeReason,
        forgotten_customer: result.forgottenCustomer,
        missed_sales_opportunity: result.missedSalesOpportunity,
        missed_sale_opportunity: result.missedSalesOpportunity,
        successful_cross_sell: result.successfulCrossSell,
        handled_angry_customer_well: result.handledAngryCustomerWell,
        excellent_case: result.excellentCase,
        has_critical_error: result.hasSevereError,
        repeated_error_type: result.repeatErrorType,
        repeat_count: previousCount,
        repeat_multiplier: multiplier,
        month_cycle: monthCycle,
        raw_scores: {
          criteria: selectedChoices,
          severe_errors: severeErrors,
          result: { ...result, doctorPointsImpact: repeatedDoctorImpact },
        },
        review_items: result.reviewItems,
        first_customer_message_at: form.firstCustomerMessageAt
          ? new Date(form.firstCustomerMessageAt).toISOString()
          : null,
        first_staff_reply_at: form.firstStaffReplyAt
          ? new Date(form.firstStaffReplyAt).toISOString()
          : null,
        first_response_minutes: responseMinutes,
        response_speed_score: getScore('first_response_speed', selectedChoices),
        greeting_score: getScore('greeting', selectedChoices),
        greeting_message_used: selectedChoices.greeting.applies
          ? choiceLabel('greeting', selectedChoices.greeting.choice)
          : null,
        doctor_name_used_in_greeting:
          selectedChoices.greeting.applies &&
          ['official_full', 'close_with_name'].includes(selectedChoices.greeting.choice),
        doctor_name_used:
          selectedChoices.doctor_name.applies && selectedChoices.doctor_name.choice !== 'none',
        doctor_name_score: getScore('doctor_name', selectedChoices),
        customer_name_used:
          selectedChoices.customer_name.applies && selectedChoices.customer_name.choice === 'used',
        customer_name_score: getScore('customer_name', selectedChoices),
        tone_language_score: getScore('tone', selectedChoices),
        bad_tone_flag:
          selectedChoices.tone.applies &&
          ['dry', 'bad', 'very_bad', 'insult'].includes(selectedChoices.tone.choice),
        understanding_score: getScore('understanding', selectedChoices),
        follow_up_promised: form.followUpPromised || selectedChoices.followup_after_wait.applies,
        follow_up_delay_minutes: followupDelayMinutes,
        follow_up_score: getScore('followup_after_wait', selectedChoices),
        consultation_quality_score: getScore('consultation_quality', selectedChoices),
        dosage_explanation_score: getScore('dosage_explanation', selectedChoices),
        alternative_handling_score: getScore('unavailable_items', selectedChoices),
        sales_quality_score: getScore('sales_closing', selectedChoices),
        upsell_cross_sell_score: getScore('cross_sell_upsell', selectedChoices),
        complaint_handling_score: getScore('angry_customer', selectedChoices),
        order_confirmation_score: getScore('order_confirmation', selectedChoices),
        closing_message_score: getScore('closing_message', selectedChoices),
        has_complaint: Boolean(selectedChoices.angry_customer.applies || severeErrors.insult),
        has_medical_error: Boolean(
          severeErrors.medical_error ||
          result.reviewItems.some((item) => item.errorType === 'medical_error')
        ),
        has_invoice_error: Boolean(severeErrors.invoice_error),
        has_delivery_issue: Boolean(severeErrors.delivery_error),
        reviewer_notes: form.reviewerNotes || form.notes,
        training_recommendation: finalTraining,
      };

      const ins = await insertSafe('conversation_sales_reviews', payload);
      const reviewRowId = ins.id;
      if (ins.removedColumns.length) {
        toast.warning(
          `تم حفظ التقييم، لكن قاعدة البيانات ينقصها أعمدة اختيارية: ${ins.removedColumns.slice(0, 4).join(', ')}`
        );
      }

      if (repeatedDoctorImpact !== 0) {
        const pointsResult = await persistPointsTransaction({
          employeeId: selectedStaff.id,
          employeeName: selectedStaff.name,
          branch: selectedStaff.branch,
          branchId: selectedStaff.branch_id ?? null,
          operation: repeatedDoctorImpact > 0 ? 'bonus' : 'deduction',
          rule: null,
          pointsToStore: Math.abs(repeatedDoctorImpact),
          basePoints: Math.abs(result.doctorPointsImpact),
          repeatCount: previousCount,
          multiplier,
          finalPoints: Math.abs(repeatedDoctorImpact),
          reasonLabel: `تقييم محادثة عميل - النتيجة ${result.finalScore}/100`,
          userNote: [
            form.reviewerNotes || form.notes || `تقييم محادثة ${result.finalScore}/100`,
            result.repeatErrorType ? `review_error:${result.repeatErrorType}` : '',
            result.mainNegativeReason
              ? `سبب التأثير: ${result.mainNegativeReason}`
              : result.mainPositiveReason,
            reviewRowId ? `review_id:${reviewRowId}` : '',
          ]
            .filter(Boolean)
            .join(' | '),
          createdByName: selectedReviewer.name || user?.name || 'مراجع',
          createdById: selectedReviewer.id || user?.id || '',
          createdByRole: selectedReviewer.role || user?.role || '',
          status: result.impactStatus === 'approved' ? 'approved' : 'pending',
          cycle: reviewCycle,
          source: 'conversation_evaluation',
          sourceModule: 'conversation_evaluation',
          sourceRecordId: reviewRowId ?? null,
          description: form.reviewerNotes || form.notes || finalTraining,
        });

        if (pointsResult.error) {
          toast.warning(`تم حفظ التقييم، لكن لم يتم حفظ تأثير النقاط: ${pointsResult.error}`);
        } else if (result.impactStatus === 'approved') {
          await applyStaffDelta(
            selectedStaff.id,
            canonicalSnapshotPoints(selectedStaff),
            canonicalMaxPoints(selectedStaff),
            repeatedDoctorImpact > 0
              ? Math.abs(repeatedDoctorImpact)
              : -Math.abs(repeatedDoctorImpact),
            selectedStaff.name,
            selectedStaff.branch
          );
        }
      }

      const currentUserProfile = getCurrentUserProfile();
      // Non-critical post-save actions: log activity, notify employee, create followup.
      try {
        await logActivity(
          currentUserProfile.id,
          currentUserProfile.name,
          'تقييم محادثة',
          'تقييم المحادثات',
          `درجة ${result.finalScore}/100 - ${selectedStaff.name}`,
          selectedStaff.branch || '',
          {
            user_role: currentUserProfile.role,
            target_type: 'conversation_review',
            target_id: reviewRowId || '',
          }
        );
      } catch (err) {
        console.warn('[reviews] logActivity failed', err);
      }

      try {
        await notifyEmployee({
          title: result.finalScore < 70 ? 'تقييم محادثة يحتاج مراجعة' : 'تم حفظ تقييم محادثة',
          message:
            result.finalScore < 70
              ? `درجتك ${result.finalScore}/100. يرجى مراجعة التقييم لتجنب تكرار الخطأ.`
              : `تقييم المحادثة ${result.finalScore}/100. ${result.finalScore >= 90 ? 'أداء ممتاز.' : 'راجع الملاحظات للتحسين.'}`,
          type: 'conversation_review',
          priority: result.finalScore < 70 ? 'high' : 'normal',
          recipient_staff_id: selectedStaff.id,
          branch: selectedStaff.branch,
          target_type: 'conversation_review',
          target_id: reviewRowId || '',
          target_route: reviewRowId ? `/reviews?id=${reviewRowId}` : '/reviews',
          requires_action: result.finalScore < 70,
          created_by: currentUserProfile.id,
          created_by_name: currentUserProfile.name,
          metadata: {
            staff_name: selectedStaff.name,
            score: result.finalScore,
            points_impact: repeatedDoctorImpact,
            positive_note: result.mainPositiveReason,
            improvement_note: result.mainNegativeReason,
          },
        });
      } catch (err) {
        console.warn('[reviews] notifyEmployee failed', err);
        toast.warning('تم حفظ التقييم، لكن إشعار الموظف فشل. راجع سجلات الخادم.');
      }

      if (result.finalScore < 70 && (form.customerName || form.customerPhone || form.customerCode)) {
        try {
          await insertSafe('followups', {
            customer_id: form.customerId || null,
            customer_name: form.customerName || 'عميل يحتاج متابعة جودة',
            customer_phone: form.customerPhone || null,
            customer_code: form.customerCode || null,
            branch: selectedStaff.branch || null,
            followup_status: 'pending',
            status: 'pending',
            priority: result.hasSevereError ? 'عاجل' : 'مهم',
            followup_reason: 'تقييم محادثة سلبي يحتاج متابعة',
            followup_summary: `تقييم محادثة ${result.finalScore}/100 بواسطة ${currentUserProfile.name}. ${result.mainNegativeReason || finalTraining}`,
            assigned_staff_id: selectedStaff.id,
            responsible_name: selectedStaff.name,
            source: 'conversation_review',
            source_record_id: reviewRowId || null,
            created_by: currentUserProfile.id,
            created_by_name: currentUserProfile.name,
            created_at: new Date().toISOString(),
          });
        } catch (err) {
          console.warn('[reviews] insert followup failed', err);
          toast.warning('تم حفظ التقييم، لكن لم تتم إضافة متابعة الجودة تلقائيًا.');
        }
      }

      try {
        await loadReviewHistory();
      } catch (err) {
        console.warn('[reviews] loadReviewHistory failed', err);
      }

      try {
        window.localStorage.removeItem(REVIEW_DRAFT_KEY);
        setDraftSavedAt(null);
      } catch {}

      toast.success('تم حفظ تقييم المحادثة وتحديث سجل التقييمات بنجاح');
      return true;
    } catch (error) {
      toast.error(`تعذر الحفظ الكامل: ${(error as Error).message}`);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const startNewReview = () => {
    setForm({ ...emptyReviewForm, reviewerId: user?.id || '', conversationDate: isoInputNow() });
    setReviewState(defaultReviewState());
    setSevereErrors(defaultSevereErrors());
    setCustSearch('');
    setCustHits([]);
    setRepeatInfo(null);
    setDraftSavedAt(null);
    window.localStorage.removeItem(REVIEW_DRAFT_KEY);
    toast.success('تم فتح تقييم جديد');
  };

  const openEdit = (row: ConversationReviewHistoryRow) => {
    setEditingReview(row);
    setEditForm({
      staff_id: row.staff_id || row.doctor_id || '',
      staff_name: row.staff_name || row.doctor_name || '',
      customer_name: row.customer_name || '',
      customer_code: row.customer_code || '',
      customer_phone: row.customer_phone || '',
      final_score: String(scoreOf(row) || ''),
      point_impact: String(impactOf(row) || '0'),
      reviewer_notes: row.reviewer_notes || '',
      training_recommendation: row.training_recommendation || '',
      manager_note: row.manager_review_notes || '',
    });
  };

  const saveEdit = async (): Promise<boolean> => {
    if (!editingReview?.id) return false;
    if (!canManageReviews) {
      toast.error('التعديل متاح للمدير العام فقط');
      return false;
    }
    setSaving(true);
    try {
      const score = Math.max(0, Math.min(100, Number(editForm.final_score || 0)));
      const impact = Number(editForm.point_impact || 0);
      const payload = {
        staff_id: asUuid(editForm.staff_id),
        doctor_id: asUuid(editForm.staff_id),
        staff_name: editForm.staff_name.trim() || null,
        doctor_name: editForm.staff_name.trim() || null,
        customer_name: editForm.customer_name.trim() || null,
        customer_code: editForm.customer_code.trim() || null,
        customer_phone: editForm.customer_phone.trim() || null,
        final_score: score,
        total_score: score,
        point_impact: impact,
        doctor_points_impact: impact,
        reviewer_notes: editForm.reviewer_notes,
        training_recommendation: editForm.training_recommendation,
        manager_review_notes: editForm.manager_note,
        manager_reviewed_by: user?.name || 'مدير عام',
        manager_reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      await updateSafe('conversation_sales_reviews', editingReview.id, payload);
      await loadReviewHistory();
      setEditingReview(null);
      toast.success('تم تعديل تقييم المحادثة بواسطة المدير العام');
      return true;
    } catch (error) {
      toast.error(`تعذر تعديل التقييم: ${(error as Error).message}`);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const openManagerReview = (row: ConversationReviewHistoryRow) => {
    setManagerReviewTarget(row);
    setManagerForm({
      score: String(row.manager_review_score || '100'),
      notes: '',
      strengths: '',
      improvements: '',
    });
  };

  const saveManagerReview = async (): Promise<boolean> => {
    if (!managerReviewTarget) return true;
    if (!canManageReviews) {
      toast.error('تقييم مسئول خدمة العملاء متاح للمدير العام فقط');
      return false;
    }
    setManagerSaving(true);
    try {
      const score = Math.max(0, Math.min(100, Number(managerForm.score || 0)));
      const payload = {
        source_review_id: managerReviewTarget.id || null,
        linked_review_id: managerReviewTarget.id || null,
        reviewer_id: asUuid(managerReviewTarget.reviewer_id),
        reviewer_name: managerReviewTarget.reviewer_name || null,
        reviewer_role: managerReviewTarget.reviewer_role || null,
        reviewed_staff_id: asUuid(managerReviewTarget.staff_id || managerReviewTarget.doctor_id),
        reviewed_staff_name: managerReviewTarget.staff_name || managerReviewTarget.doctor_name || null,
        manager_id: asUuid(user?.id),
        manager_name: user?.name || 'مدير عام',
        score,
        review_score: score,
        notes: managerForm.notes,
        manager_notes: managerForm.notes,
        strengths: managerForm.strengths,
        improvements: managerForm.improvements,
        branch: managerReviewTarget.branch || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      await insertSafe('customer_service_manager_reviews', payload);
      if (managerReviewTarget.id) {
        await updateSafe('conversation_sales_reviews', managerReviewTarget.id, {
          manager_review_score: score,
          manager_review_notes: managerForm.notes,
          manager_reviewed_by: user?.name || 'مدير عام',
          manager_reviewed_at: new Date().toISOString(),
        });
      }
      await loadReviewHistory();
      setManagerReviewTarget(null);
      toast.success('تم حفظ تقييم مدير خدمة العملاء/المراجع');
      return true;
    } catch (error) {
      const message = (error as Error).message || '';
      if (/could not find the table|does not exist|schema cache/i.test(message)) {
        toast.error('جدول تقييم المراجع غير موجود بعد. شغّل migration: 20260625_create_customer_service_manager_reviews.sql');
      } else {
        toast.error(`تعذر حفظ تقييم المراجع: ${message}`);
      }
      return false;
    } finally {
      setManagerSaving(false);
    }
  };

  const reviewIsDirty = useMemo(() => {
    if (managerReviewTarget) {
      return Boolean(
        managerForm.notes.trim() ||
          managerForm.strengths.trim() ||
          managerForm.improvements.trim() ||
          managerForm.score !== '100'
      );
    }
    if (editingReview) return true;
    const defaultState = defaultReviewState();
    const defaultSevere = defaultSevereErrors();
    const criteriaChanged = JSON.stringify(reviewState) !== JSON.stringify(defaultState);
    const severeChanged = JSON.stringify(severeErrors) !== JSON.stringify(defaultSevere);
    const formTouched = Boolean(
      form.staffId ||
        form.customerName.trim() ||
        form.customerCode.trim() ||
        form.customerPhone.trim() ||
        form.reviewerNotes.trim() ||
        form.evaluationReason.trim() ||
        form.invoiceNo.trim()
    );
    return criteriaChanged || severeChanged || formTouched;
  }, [editingReview, form, managerForm, managerReviewTarget, reviewState, severeErrors]);

  const saveForNavigation = useCallback(async () => {
    if (managerReviewTarget) return saveManagerReview();
    if (editingReview) return saveEdit();
    return save();
  }, [editingReview, managerReviewTarget, saveEdit, saveManagerReview, save]);

  usePendingFormNavigationGuard({
    isDirty: reviewIsDirty,
    isSaving: saving || managerSaving,
    onSave: saveForNavigation,
  });

  return (
    <div className="w-full max-w-full space-y-5 overflow-hidden" dir="rtl">
      <div className="rounded-3xl border border-teal-500/30 bg-gradient-to-l from-slate-950 via-slate-900 to-teal-950/40 p-5 shadow-xl">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-teal-500/15 flex items-center justify-center text-teal-300 border border-teal-400/30">
              <Star size={24} />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-black text-white drop-shadow">
                تقييم المحادثات وعمليات البيع
              </h1>
              <p className="text-slate-200 text-sm mt-1">
                الهيدر والجداول محسنة للثيم الغامق + تفاصيل كاملة + تعديل المدير العام + تقييم مراجع
                خدمة العملاء.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={loadReviewHistory}
              disabled={historyLoading}
              className="btn-secondary flex items-center gap-2"
            >
              <RefreshCw size={16} className={historyLoading ? 'animate-spin' : ''} />
              تحديث السجل
            </button>
            <button
              type="button"
              onClick={startNewReview}
              className="btn-primary flex items-center gap-2"
            >
              <Star size={16} />
              تقييم جديد
            </button>
          </div>
        </div>
      </div>

      <section className="stat-card border border-teal-500/20 bg-teal-500/5 space-y-4">
        <div className="flex items-center gap-2">
          <ListChecks className="text-teal-400" size={20} />
          <div>
            <h2 className="text-white font-bold text-lg">سجل تقييم المحادثات</h2>
            <p className="text-slate-300 text-sm">
              اضغط على أي محادثة لفتح تفاصيل التقييم كاملة، أو استخدم أزرار المدير العام للتعديل
              والتقييم.
            </p>
          </div>
        </div>

        {historyError && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-amber-100 text-sm">
            تعذر تحميل سجل التقييمات. تأكد من تشغيل SQL المرفق. تفاصيل الخطأ: {historyError}
          </div>
        )}

        <div className="grid md:grid-cols-4 gap-3">
          <Metric label="عدد التقييمات المسجلة" value={`${reviewHistory.length}`} tone="teal" />
          <Metric
            label="متوسط آخر تقييمات"
            value={`${reviewHistory.length ? Math.round(reviewHistory.reduce((sum, row) => sum + scoreOf(row), 0) / reviewHistory.length) : 0}/100`}
            tone="blue"
          />
          <Metric
            label="تقييمات أقل من 70"
            value={`${reviewHistory.filter((row) => scoreOf(row) < 70).length}`}
            tone="red"
          />
          <Metric label="فروع تم تقييمها" value={`${historyStats.length}`} tone="slate" />
        </div>

        {historyStats.length > 0 && (
          <div className="rounded-xl border border-[#2d4063] bg-[#16253f] p-3">
            <div className="flex items-center gap-2 text-slate-100 font-bold mb-3">
              <BarChart3 size={17} className="text-teal-400" />
              تقييم المحادثات حسب الفرع
            </div>
            <div className="grid md:grid-cols-3 gap-2">
              {historyStats.slice(0, 6).map((row) => (
                <div
                  key={row.branch}
                  className="rounded-xl border border-[#2d4063] bg-[#0f1b2e] p-3"
                >
                  <div className="text-white font-bold">{row.branch}</div>
                  <div className="grid grid-cols-2 gap-2 mt-2 text-xs text-slate-200">
                    <span>
                      العدد: <b className="num text-white">{row.count}</b>
                    </span>
                    <span>
                      المتوسط: <b className="num text-white">{row.avg}/100</b>
                    </span>
                    <span>
                      أقل من 70: <b className="num text-red-300">{row.low}</b>
                    </span>
                    <span>
                      خصومات: <b className="num text-red-300">{row.negative}</b>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid gap-3 min-[1100px]:hidden">
          {reviewHistory.slice(0, 30).map((row, index) => {
            const score = scoreOf(row);
            const impact = impactOf(row);
            return (
              <article key={row.id || index} className="rounded-2xl border border-slate-700 bg-[#0b1728] p-4 text-slate-100">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="line-clamp-2 text-base font-black text-white" title={row.customer_name || 'غير محدد'}>
                      {row.customer_name || 'غير محدد'}
                    </h3>
                    <p className="mt-1 text-xs text-slate-400">{formatDateTime(row.created_at)}</p>
                  </div>
                  <span className={score >= 90 ? 'badge-success text-xs' : score >= 70 ? 'badge-warning text-xs' : 'badge-danger text-xs'}>
                    {score}/100
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-300">
                  <Info label="المراجع" value={row.reviewer_name || '-'} />
                  <Info label="الدكتور" value={row.staff_name || row.doctor_name || '-'} />
                  <Info label="الفرع" value={row.branch || '-'} />
                  <Info label="النقاط" value={impact > 0 ? `+${impact}` : String(impact)} />
                  <Info label="حالة المراجع" value={row.manager_review_score ? `${row.manager_review_score}/100` : 'لم يقيم'} />
                  <Info label="الفاتورة" value={row.invoice_number || '-'} />
                </div>
                <ReviewActions row={row} canManage={canManageReviews} onDetails={setSelectedReview} onEdit={openEdit} onManagerReview={openManagerReview} />
              </article>
            );
          })}
        </div>

        <div className="relative hidden w-full max-w-full overflow-x-auto overscroll-x-contain rounded-xl border border-slate-700 bg-[#0b1728] shadow-inner [scrollbar-color:#22d3ee_#0f172a] [scrollbar-width:thin] min-[1100px]:block">
          <table className="w-full min-w-[1080px] table-fixed text-[13px] text-slate-100 min-[1500px]:text-sm">
            <thead className="sticky top-0 z-20 border-b border-slate-700 bg-[#102640] text-cyan-100 shadow-sm">
              <tr>
                <th className="w-[130px] p-2 text-right font-black min-[1500px]:p-3">التاريخ</th>
                <th className="w-[130px] p-2 text-right font-black min-[1500px]:p-3">المراجع</th>
                <th className="w-[145px] p-2 text-right font-black min-[1500px]:p-3">الدكتور المقيم</th>
                <th className="w-[105px] p-2 text-right font-black min-[1500px]:p-3">الفرع</th>
                <th className="w-[190px] p-2 text-right font-black min-[1500px]:p-3">العميل</th>
                <th className="hidden w-[135px] p-2 text-right font-black xl:table-cell min-[1500px]:p-3">التفاصيل</th>
                <th className="w-[90px] p-2 text-right font-black min-[1500px]:p-3">التقييم</th>
                <th className="w-[80px] p-2 text-right font-black min-[1500px]:p-3">النقاط</th>
                <th className="hidden w-[110px] p-2 text-right font-black xl:table-cell min-[1500px]:p-3">تقييم المراجع</th>
                <th className="sticky left-0 z-30 w-[140px] border-r border-slate-700 bg-[#102640] p-2 text-right font-black shadow-[8px_0_18px_rgba(2,6,23,0.45)] min-[1500px]:p-3">الإجراءات</th>
              </tr>
            </thead>
            <tbody>
              {reviewHistory.slice(0, 30).map((row, index) => {
                const score = scoreOf(row);
                const impact = impactOf(row);
                return (
                  <tr
                    key={row.id || index}
                    onClick={() => setSelectedReview(row)}
                    className="group cursor-pointer border-t border-slate-700/80 bg-[#0b1728] transition-colors hover:bg-teal-950/30"
                  >
                    <td className="whitespace-normal p-2 text-slate-300 min-[1500px]:p-3">
                      {formatDateTime(row.created_at)}
                    </td>
                    <td className="p-2 font-bold text-slate-100 min-[1500px]:p-3"><span className="line-clamp-2" title={row.reviewer_name || 'غير محدد'}>{row.reviewer_name || 'غير محدد'}</span></td>
                    <td className="p-2 font-bold text-slate-100 min-[1500px]:p-3">
                      <span className="line-clamp-2" title={row.staff_name || row.doctor_name || 'غير محدد'}>
                      {row.staff_name || row.doctor_name || 'غير محدد'}
                      </span>
                    </td>
                    <td className="p-2 text-slate-300 min-[1500px]:p-3"><span className="line-clamp-2" title={row.branch || '-'}>{row.branch || '-'}</span></td>
                    <td className="p-2 text-slate-100 min-[1500px]:p-3">
                      <div className="line-clamp-2" title={row.customer_name || 'غير محدد'}>{row.customer_name || 'غير محدد'}</div>
                      {(row.customer_code || row.customer_phone) && (
                        <div className="text-xs text-slate-400">
                          {row.customer_code || row.customer_phone}
                        </div>
                      )}
                    </td>
                    <td className="hidden p-2 text-slate-300 xl:table-cell min-[1500px]:p-3">
                      <div className="line-clamp-2" title={`${row.invoice_number || '-'} · ${row.evaluation_kind || row.conversation_type || '-'}`}>
                        {row.invoice_number || '-'} · {row.evaluation_kind || row.conversation_type || '-'}
                      </div>
                    </td>
                    <td className="p-2 min-[1500px]:p-3">
                      <span
                        className={
                          score >= 90
                            ? 'badge-success text-xs'
                            : score >= 70
                              ? 'badge-warning text-xs'
                              : 'badge-danger text-xs'
                        }
                      >
                        {score}/100
                      </span>
                    </td>
                    <td className={`p-2 num font-black min-[1500px]:p-3 ${impact >= 0 ? 'text-teal-300' : 'text-red-300'}`}>
                      {impact > 0 ? `+${impact}` : impact}
                    </td>
                    <td className="hidden p-2 xl:table-cell min-[1500px]:p-3">
                      {row.manager_review_score ? (
                        <span className="badge-info text-xs">{row.manager_review_score}/100</span>
                      ) : (
                        <span className="inline-flex rounded-full border border-amber-400/40 bg-amber-500/15 px-2.5 py-1 text-xs font-black text-amber-200">لم يقيم</span>
                      )}
                    </td>
                    <td className="sticky left-0 z-10 w-[140px] border-r border-slate-700 bg-[#0b1728] p-2 shadow-[8px_0_18px_rgba(2,6,23,0.4)] transition-colors group-hover:bg-[#0d2630] min-[1500px]:p-3">
                      <ReviewActions row={row} canManage={canManageReviews} onDetails={setSelectedReview} onEdit={openEdit} onManagerReview={openManagerReview} />
                    </td>
                  </tr>
                );
              })}
              {!historyLoading && reviewHistory.length === 0 && (
                <tr>
                  <td colSpan={11} className="p-6 text-center text-slate-300">
                    لا يوجد تقييمات محفوظة حتى الآن.
                  </td>
                </tr>
              )}
              {historyLoading && (
                <tr>
                  <td colSpan={11} className="p-6 text-center text-slate-300">
                    جاري تحميل سجل التقييمات...
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Metric
          label="تقييم المحادثة"
          value={`${result.finalScore}/100`}
          tone={result.finalScore >= 90 ? 'teal' : result.finalScore >= 70 ? 'amber' : 'red'}
        />
        <Metric
          label="تأثير النقاط"
          value={result.impactLabel}
          tone={result.doctorPointsImpact >= 0 ? 'teal' : 'red'}
        />
        <Metric
          label="البنود المطبقة"
          value={`${result.totalApplicableItems}/${REVIEW_CRITERIA.length}`}
          tone="blue"
        />
        <Metric
          label="توصية التدريب"
          value={finalTraining.split(' ').slice(0, 3).join(' ')}
          tone="slate"
        />
      </div>

      <section className="stat-card space-y-4">
        <div className="section-title text-sm">بيانات المحادثة</div>
        <div className="grid md:grid-cols-3 gap-3">
          <Field label="من يقيم؟">
            <select
              className="input-dark"
              value={form.reviewerId}
              onChange={(e) => setForm((f) => ({ ...f, reviewerId: e.target.value }))}
            >
              <option value="">اختر المراجع</option>
              {reviewers.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name} - {row.role}
                </option>
              ))}
            </select>
          </Field>
          <Field label="الدكتور / الموظف المقيم">
            <select
              className="input-dark"
              value={form.staffId}
              onChange={(e) => setForm((f) => ({ ...f, staffId: e.target.value }))}
            >
              <option value="">اختر الدكتور أو الموظف</option>
              {staffOptions.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name} - {row.role} - {row.branch}
                </option>
              ))}
            </select>
          </Field>
          <Field label="نوع المحادثة">
            <select
              className="input-dark"
              value={form.evaluationKind}
              onChange={(e) => setForm((f) => ({ ...f, evaluationKind: e.target.value }))}
            >
              {EVAL_KINDS.map((kind) => (
                <option key={kind}>{kind}</option>
              ))}
            </select>
          </Field>
          <Field label="سبب التقييم">
            <select
              className="input-dark"
              value={form.evaluationReason}
              onChange={(e) => setForm((f) => ({ ...f, evaluationReason: e.target.value }))}
            >
              {EVAL_REASONS.map((reason) => (
                <option key={reason}>{reason}</option>
              ))}
            </select>
          </Field>
          <Field label="تاريخ المحادثة">
            <input
              className="input-dark"
              type="datetime-local"
              value={form.conversationDate}
              onChange={(e) => setForm((f) => ({ ...f, conversationDate: e.target.value }))}
            />
          </Field>
          <Field label="رقم الفاتورة">
            <input
              className="input-dark"
              value={form.invoiceNo}
              onChange={(e) => setForm((f) => ({ ...f, invoiceNo: e.target.value }))}
              placeholder="اختياري"
            />
          </Field>
        </div>
      </section>

      <section className="stat-card space-y-3">
        <div className="section-title text-sm">العميل</div>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
            <input
              className="input-dark pr-10"
              value={custSearch}
              onChange={(e) => setCustSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && loadCustomersHits()}
              placeholder="ابحث بكود العميل أو الاسم أو الهاتف"
            />
          </div>
          <button type="button" onClick={loadCustomersHits} className="btn-secondary">
            بحث
          </button>
        </div>
        {custHits.length > 0 && (
          <div className="grid md:grid-cols-2 gap-2">
            {custHits.map((customer) => (
              <button
                key={customer.id}
                type="button"
                className="rounded-xl border border-[#2d4063] bg-[#16253f] p-3 text-right hover:border-teal-500/40"
                onClick={() => {
                  setForm((f) => ({
                    ...f,
                    customerId: customer.id,
                    customerCode: customer.customer_code || '',
                    customerName: customer.name || '',
                    customerPhone: customer.phone || '',
                  }));
                  setCustSearch(customer.name || customer.customer_code || '');
                  setCustHits([]);
                }}
              >
                <div className="text-white font-semibold text-sm">
                  {customer.name || 'عميل بدون اسم'}
                </div>
                <div className="text-slate-300 text-xs mt-1">
                  {customer.customer_code || 'بدون كود'} - {customer.phone || 'بدون هاتف'}
                </div>
              </button>
            ))}
          </div>
        )}
        <div className="grid md:grid-cols-3 gap-3">
          <Field label="اسم العميل">
            <input
              className="input-dark"
              value={form.customerName}
              onChange={(e) => setForm((f) => ({ ...f, customerName: e.target.value }))}
            />
          </Field>
          <Field label="كود العميل">
            <input
              className="input-dark"
              value={form.customerCode}
              onChange={(e) => setForm((f) => ({ ...f, customerCode: e.target.value }))}
            />
          </Field>
          <Field label="هاتف العميل">
            <input
              className="input-dark"
              value={form.customerPhone}
              onChange={(e) => setForm((f) => ({ ...f, customerPhone: e.target.value }))}
            />
          </Field>
        </div>
      </section>

      <section className="stat-card space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div className="section-title text-sm">توقيت الرد والمتابعة</div>
          <button
            type="button"
            onClick={applyTiming}
            className="btn-secondary flex items-center gap-2"
          >
            <CheckCircle2 size={16} />
            تطبيق التوقيت على البنود
          </button>
        </div>
        <div className="grid md:grid-cols-4 gap-3">
          <Field label="أول رسالة من العميل">
            <input
              className="input-dark"
              type="datetime-local"
              value={form.firstCustomerMessageAt}
              onChange={(e) => setForm((f) => ({ ...f, firstCustomerMessageAt: e.target.value }))}
            />
          </Field>
          <Field label="أول رد من الموظف">
            <input
              className="input-dark"
              type="datetime-local"
              value={form.firstStaffReplyAt}
              onChange={(e) => setForm((f) => ({ ...f, firstStaffReplyAt: e.target.value }))}
            />
          </Field>
          <Field label="وعد بالمتابعة؟">
            <select
              className="input-dark"
              value={form.followUpPromised ? 'yes' : 'no'}
              onChange={(e) =>
                setForm((f) => ({ ...f, followUpPromised: e.target.value === 'yes' }))
              }
            >
              <option value="no">لا</option>
              <option value="yes">نعم</option>
            </select>
          </Field>
          <Info
            label="مدة أول رد"
            value={responseMinutes == null ? 'غير محسوبة' : `${responseMinutes} دقيقة`}
          />
          {form.followUpPromised && (
            <>
              <Field label="وقت الوعد بالمتابعة">
                <input
                  className="input-dark"
                  type="datetime-local"
                  value={form.followUpPromisedAt}
                  onChange={(e) => setForm((f) => ({ ...f, followUpPromisedAt: e.target.value }))}
                />
              </Field>
              <Field label="وقت الرجوع للعميل">
                <input
                  className="input-dark"
                  type="datetime-local"
                  value={form.followUpReturnedAt}
                  onChange={(e) => setForm((f) => ({ ...f, followUpReturnedAt: e.target.value }))}
                />
              </Field>
              <Info
                label="مدة الرجوع"
                value={followupDelayMinutes == null ? 'لم يرجع' : `${followupDelayMinutes} دقيقة`}
              />
            </>
          )}
        </div>
      </section>

      <section className="space-y-3">
        {REVIEW_CRITERIA.map((criterion) => {
          const itemState = reviewState[criterion.key];
          return (
            <div
              key={criterion.key}
              className={`stat-card border ${itemState.applies ? 'border-teal-500/20' : 'border-[#2d4063]'}`}
            >
              <div className="flex flex-col md:flex-row md:items-start gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="text-white font-bold text-sm">{criterion.label}</div>
                    <span className="badge-info text-xs">{criterion.maxPoints} نقطة</span>
                    {!itemState.applies && <span className="badge-muted text-xs">لا ينطبق</span>}
                  </div>
                  <p className="text-slate-300 text-xs mt-1 leading-relaxed">{criterion.hint}</p>
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-200">
                  <input
                    type="checkbox"
                    checked={itemState.applies}
                    onChange={(e) => setCriterionApplies(criterion.key, e.target.checked)}
                  />
                  ينطبق
                </label>
              </div>
              {itemState.applies && (
                <div className="grid md:grid-cols-2 gap-3 mt-4">
                  <select
                    className="input-dark"
                    value={itemState.choice}
                    onChange={(e) => setCriterionChoice(criterion.key, e.target.value)}
                  >
                    {criterion.choices.map((choice) => (
                      <option key={choice.value} value={choice.value}>
                        {choice.label} - {choice.pointsEarned}/{criterion.maxPoints}
                      </option>
                    ))}
                  </select>
                  <input
                    className="input-dark"
                    value={itemState.notes || ''}
                    onChange={(e) => setCriterionNotes(criterion.key, e.target.value)}
                    placeholder="ملاحظة على البند (اختياري)"
                  />
                </div>
              )}
            </div>
          );
        })}
      </section>

      <section className="stat-card border border-red-500/20 space-y-3">
        <div className="flex items-center gap-2 text-red-300 font-bold">
          <AlertTriangle size={18} />
          الأخطاء الجسيمة والخصومات الإضافية
        </div>
        <div className="grid md:grid-cols-2 gap-2">
          {(
            Object.entries(SEVERE_ERRORS) as Array<
              [SevereErrorKey, (typeof SEVERE_ERRORS)[SevereErrorKey]]
            >
          ).map(([key, error]) => (
            <label
              key={key}
              className="flex items-center gap-2 rounded-xl border border-[#2d4063] bg-[#16253f] p-3 text-sm text-slate-200"
            >
              <input
                type="checkbox"
                checked={severeErrors[key]}
                onChange={(e) => setSevere(key, e.target.checked)}
              />
              <span className="flex-1">{error.label}</span>
              <span className="text-red-300 font-bold num">{error.points}</span>
            </label>
          ))}
        </div>
      </section>

      <section className="stat-card border border-teal-500/30 bg-teal-500/5 space-y-4">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="text-teal-400" size={20} />
          <h2 className="text-white font-bold text-lg">ملخص تقييم المحادثة</h2>
        </div>

        <div className="grid md:grid-cols-3 gap-3">
          <Info
            label="الدكتور"
            value={
              selectedStaff ? `${selectedStaff.name} - ${selectedStaff.branch}` : 'لم يتم الاختيار'
            }
          />
          <Info label="العميل" value={form.customerName || 'غير محدد'} />
          <Info label="المراجع" value={selectedReviewer ? selectedReviewer.name : 'غير محدد'} />
          <Info label="رقم الفاتورة" value={form.invoiceNo || 'غير مسجل'} />
          <Info label="نوع المحادثة" value={form.evaluationKind} />
          <Info label="دورة النقاط" value={monthCycle} />
        </div>

        <ReviewItemsTable items={result.reviewItems} />

        <div className="grid md:grid-cols-5 gap-3">
          <Metric label="المطبقة" value={`${result.totalApplicableItems}`} tone="teal" />
          <Metric label="غير المطبقة" value={`${result.totalNotApplicableItems}`} tone="slate" />
          <Metric label="المكتسبة" value={`${result.earnedPoints}`} tone="teal" />
          <Metric label="الممكنة" value={`${result.totalApplicablePoints}`} tone="blue" />
          <Metric
            label="النتيجة"
            value={`${result.finalScore}/100`}
            tone={result.finalScore >= 90 ? 'teal' : result.finalScore >= 70 ? 'amber' : 'red'}
          />
        </div>

        <div className="grid md:grid-cols-2 gap-3">
          <div className="rounded-2xl bg-[#16253f] border border-[#2d4063] p-5 text-center">
            <div className="text-slate-300 text-sm">تقييم المحادثة</div>
            <div
              className={`num text-5xl font-black mt-2 ${result.finalScore >= 90 ? 'text-teal-400' : result.finalScore >= 70 ? 'text-amber-400' : 'text-red-400'}`}
            >
              {result.finalScore}
            </div>
            <div className="text-slate-300 text-xs mt-1">من 100 - {result.level}</div>
          </div>
          <div className="rounded-2xl bg-[#16253f] border border-[#2d4063] p-5 text-center">
            <div className="text-slate-300 text-sm">تأثيرها على نقاط الدكتور</div>
            <div
              className={`num text-5xl font-black mt-2 ${result.doctorPointsImpact >= 0 ? 'text-teal-400' : 'text-red-400'}`}
            >
              {result.impactLabel}
            </div>
            <div className="text-slate-300 text-xs mt-1">قبل تكرار نفس الخطأ داخل الدورة</div>
          </div>
        </div>

        <div className="rounded-xl bg-[#16253f] border border-[#2d4063] p-4 text-sm text-slate-200 leading-relaxed space-y-2">
          <div>
            <span className="text-slate-400">سبب التأثير:</span> {result.impactReason}
          </div>
          <div>
            <span className="text-slate-400">أهم سبب للخصم:</span>{' '}
            {result.mainNegativeReason || 'لا يوجد'}
          </div>
          <div>
            <span className="text-slate-400">أهم نقطة إيجابية:</span>{' '}
            {result.mainPositiveReason || 'لا يوجد'}
          </div>
          <div>
            <span className="text-slate-400">خصومات إضافية:</span>{' '}
            {result.extraPenalties.length
              ? result.extraPenalties.map((p) => `${p.label} (${p.points})`).join('، ')
              : 'لا توجد'}
          </div>
        </div>

        <div className="rounded-xl bg-amber-500/10 border border-amber-500/25 p-4">
          <div className="text-amber-300 font-bold text-sm mb-2">التوصية التدريبية</div>
          <p className="text-slate-100 text-sm leading-relaxed">{finalTraining}</p>
          <textarea
            className="input-dark mt-3 min-h-20"
            value={form.trainingRecommendationManual}
            onChange={(e) =>
              setForm((f) => ({ ...f, trainingRecommendationManual: e.target.value }))
            }
            placeholder="تعديل التوصية يدويًا عند الحاجة"
          />
        </div>

        <textarea
          className="input-dark min-h-24"
          value={form.reviewerNotes}
          onChange={(e) => setForm((f) => ({ ...f, reviewerNotes: e.target.value }))}
          placeholder="ملاحظات المراجع النهائية"
        />

        {repeatInfo && result.repeatErrorType && (
          <div className="rounded-xl bg-red-500/10 border border-red-500/25 p-3 text-red-200 text-sm">
            تم اكتشاف تكرار داخل الدورة: السابق {repeatInfo.count} مرة، المضاعف المطبق x
            {repeatInfo.multiplier}.
          </div>
        )}

        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="btn-primary w-full justify-center text-base py-4 flex items-center gap-2"
        >
          <Save size={18} />
          {saving ? 'جاري حفظ التقييم...' : 'حفظ التقييم'}
        </button>
      </section>

      {selectedReview && (
        <ReviewDetailsModal
          row={selectedReview}
          onClose={closeSelectedReview}
          onEdit={() => {
            openEdit(selectedReview);
            closeSelectedReview();
          }}
          onManagerReview={() => {
            openManagerReview(selectedReview);
            closeSelectedReview();
          }}
          canManage={canManageReviews}
        />
      )}

      {editingReview && (
        <Modal title="تعديل تقييم المحادثة - المدير العام" onClose={() => setEditingReview(null)}>
          <div className="grid md:grid-cols-2 gap-3">
            <Field label="الدكتور / الموظف الصحيح">
              <select
                className="input-dark"
                value={editForm.staff_id}
                onChange={(e) => {
                  const selected = staffOptions.find((item) => item.id === e.target.value);
                  setEditForm((f) => ({ ...f, staff_id: e.target.value, staff_name: selected?.name || f.staff_name }));
                }}
              >
                <option value="">اختيار بالاسم يدويًا</option>
                {staffOptions.map((item) => <option key={item.id} value={item.id}>{item.name} — {item.branch}</option>)}
              </select>
            </Field>
            <Field label="اسم الدكتور الظاهر">
              <input className="input-dark" value={editForm.staff_name} onChange={(e) => setEditForm((f) => ({ ...f, staff_name: e.target.value }))} />
            </Field>
            <Field label="اسم العميل الصحيح">
              <input className="input-dark" value={editForm.customer_name} onChange={(e) => setEditForm((f) => ({ ...f, customer_name: e.target.value }))} />
            </Field>
            <Field label="كود العميل">
              <input className="input-dark" value={editForm.customer_code} onChange={(e) => setEditForm((f) => ({ ...f, customer_code: e.target.value }))} />
            </Field>
            <Field label="هاتف العميل">
              <input className="input-dark" value={editForm.customer_phone} onChange={(e) => setEditForm((f) => ({ ...f, customer_phone: e.target.value }))} />
            </Field>
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            <Field label="النتيجة من 100">
              <input
                className="input-dark"
                type="number"
                min={0}
                max={100}
                value={editForm.final_score}
                onChange={(e) => setEditForm((f) => ({ ...f, final_score: e.target.value }))}
              />
            </Field>
            <Field label="تأثير النقاط">
              <input
                className="input-dark"
                type="number"
                value={editForm.point_impact}
                onChange={(e) => setEditForm((f) => ({ ...f, point_impact: e.target.value }))}
              />
            </Field>
          </div>
          <Field label="ملاحظات المراجع بعد التعديل">
            <textarea
              className="input-dark min-h-24"
              value={editForm.reviewer_notes}
              onChange={(e) => setEditForm((f) => ({ ...f, reviewer_notes: e.target.value }))}
            />
          </Field>
          <Field label="التوصية التدريبية">
            <textarea
              className="input-dark min-h-24"
              value={editForm.training_recommendation}
              onChange={(e) =>
                setEditForm((f) => ({ ...f, training_recommendation: e.target.value }))
              }
            />
          </Field>
          <Field label="سبب تعديل المدير العام">
            <textarea
              className="input-dark min-h-20"
              value={editForm.manager_note}
              onChange={(e) => setEditForm((f) => ({ ...f, manager_note: e.target.value }))}
              placeholder="مثال: تم مراجعة التسجيل وتعديل درجة بند فهم طلب العميل"
            />
          </Field>
          <button
            type="button"
            onClick={saveEdit}
            disabled={saving}
            className="btn-primary w-full justify-center flex items-center gap-2"
          >
            <ShieldCheck size={18} />
            حفظ تعديل المدير العام
          </button>
        </Modal>
      )}

      {managerReviewTarget && (
        <Modal
          title="تقييم مدير خدمة العملاء / المراجع"
          onClose={() => setManagerReviewTarget(null)}
        >
          <div className="rounded-xl bg-[#16253f] border border-[#2d4063] p-3 text-sm text-slate-200">
            <div>
              المراجع:{' '}
              <b className="text-white">{managerReviewTarget.reviewer_name || 'غير محدد'}</b>
            </div>
            <div>
              التقييم المرتبط:{' '}
              {managerReviewTarget.staff_name || managerReviewTarget.doctor_name || '-'} -{' '}
              {managerReviewTarget.final_score || managerReviewTarget.total_score || 0}/100
            </div>
          </div>
          <Field label="تقييم المراجع من 100">
            <input
              className="input-dark"
              type="number"
              min={0}
              max={100}
              value={managerForm.score}
              onChange={(e) => setManagerForm((f) => ({ ...f, score: e.target.value }))}
            />
          </Field>
          <Field label="نقاط قوة في تقييم المراجع">
            <textarea
              className="input-dark min-h-20"
              value={managerForm.strengths}
              onChange={(e) => setManagerForm((f) => ({ ...f, strengths: e.target.value }))}
            />
          </Field>
          <Field label="نقاط تحتاج تحسين">
            <textarea
              className="input-dark min-h-20"
              value={managerForm.improvements}
              onChange={(e) => setManagerForm((f) => ({ ...f, improvements: e.target.value }))}
            />
          </Field>
          <Field label="ملاحظات المدير العام">
            <textarea
              className="input-dark min-h-24"
              value={managerForm.notes}
              onChange={(e) => setManagerForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </Field>
          <button
            type="button"
            onClick={saveManagerReview}
            disabled={managerSaving}
            className="btn-primary w-full justify-center flex items-center gap-2"
          >
            <UserCheck size={18} />
            حفظ تقييم المراجع
          </button>
        </Modal>
      )}
    </div>
  );
}

function ReviewDetailsModal({
  row,
  onClose,
  onEdit,
  onManagerReview,
  canManage,
}: {
  row: ConversationReviewHistoryRow;
  onClose: () => void;
  onEdit: () => void;
  onManagerReview: () => void;
  canManage: boolean;
}) {
  const items = rowReviewItems(row);
  return (
    <Modal title="تفاصيل تقييم المحادثة كاملة" onClose={onClose}>
      <div className="grid md:grid-cols-3 gap-3">
        <Info label="الدكتور / الموظف" value={row.staff_name || row.doctor_name || 'غير محدد'} />
        <Info label="المراجع" value={row.reviewer_name || 'غير محدد'} />
        <Info label="العميل" value={row.customer_name || 'غير محدد'} />
        <Info label="الفرع" value={row.branch || '-'} />
        <Info label="رقم الفاتورة" value={row.invoice_number || '-'} />
        <Info label="التاريخ" value={formatDateTime(row.conversation_date || row.created_at)} />
        <Info label="النوع" value={row.evaluation_kind || row.conversation_type || '-'} />
        <Info label="النتيجة" value={`${scoreOf(row)}/100`} />
        <Info label="تأثير النقاط" value={`${impactOf(row)}`} />
      </div>
      <div className="rounded-xl bg-[#16253f] border border-[#2d4063] p-4 text-sm text-slate-200 leading-relaxed space-y-2">
        <div>
          <span className="text-slate-400">أهم سبب خصم:</span>{' '}
          {row.main_negative_reason || 'لا يوجد'}
        </div>
        <div>
          <span className="text-slate-400">أهم نقطة إيجابية:</span>{' '}
          {row.main_positive_reason || 'لا يوجد'}
        </div>
        <div>
          <span className="text-slate-400">ملاحظات المراجع:</span> {row.reviewer_notes || '-'}
        </div>
        <div>
          <span className="text-slate-400">التوصية التدريبية:</span>{' '}
          {row.training_recommendation || '-'}
        </div>
        {row.manager_review_score && (
          <div>
            <span className="text-slate-400">تقييم المدير للمراجع:</span> {row.manager_review_score}
            /100 - {row.manager_review_notes || ''}
          </div>
        )}
      </div>
      <ReviewItemsTable items={items} />
      {canManage && (
        <div className="grid md:grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onEdit}
            className="btn-secondary justify-center flex items-center gap-2"
          >
            <Pencil size={16} />
            تعديل تقييم المحادثة
          </button>
          <button
            type="button"
            onClick={onManagerReview}
            className="btn-secondary justify-center flex items-center gap-2"
          >
            <UserCheck size={16} />
            تقييم المراجع
          </button>
        </div>
      )}
    </Modal>
  );
}

function ReviewItemsTable({ items }: { items: any[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-[#2d4063] bg-slate-950/30">
      <table className="w-full min-w-[760px] text-sm">
        <thead className="bg-slate-950 text-slate-50 border-b border-teal-500/30">
          <tr>
            <th className="p-3 text-right font-black">البند</th>
            <th className="p-3 text-right font-black">الحالة</th>
            <th className="p-3 text-right font-black">الاختيار</th>
            <th className="p-3 text-right font-black">النقاط</th>
            <th className="p-3 text-right font-black">ملاحظة</th>
          </tr>
        </thead>
        <tbody>
          {(items || []).map((item: any, index: number) => (
            <tr key={item.key || index} className="border-t border-[#2d4063]/70">
              <td className="p-3 text-white">{item.label || item.key || '-'}</td>
              <td className="p-3">
                {item.applies !== false ? (
                  <span className="badge-success text-xs">ينطبق</span>
                ) : (
                  <span className="badge-muted text-xs">لا ينطبق</span>
                )}
              </td>
              <td className="p-3 text-slate-200">
                {item.selectedOption || item.choice || 'لا ينطبق'}
              </td>
              <td className="p-3 text-slate-200 num">
                {item.pointsEarned != null ? `${item.pointsEarned}/${item.maxPoints ?? ''}` : '-'}
              </td>
              <td className="p-3 text-slate-300">{item.notes || '-'}</td>
            </tr>
          ))}
          {(!items || items.length === 0) && (
            <tr>
              <td colSpan={5} className="p-5 text-center text-slate-300">
                لا توجد بنود تفصيلية محفوظة لهذا التقييم.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[100] bg-slate-950/75 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto"
      dir="rtl"
      role="dialog"
      aria-modal="true"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="w-full max-w-5xl rounded-3xl border border-teal-500/30 bg-[#0f1b2e] shadow-2xl p-5 space-y-4"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-[#2d4063] pb-3">
          <h2 className="text-white text-xl font-black">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-[#2d4063] p-2 text-slate-200 hover:bg-slate-800"
          >
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1 text-sm">
      <span className="text-slate-200 font-semibold">{label}</span>
      {children}
    </label>
  );
}

function ReviewActions({
  row,
  canManage,
  onDetails,
  onEdit,
  onManagerReview,
}: {
  row: ConversationReviewHistoryRow;
  canManage: boolean;
  onDetails: (row: ConversationReviewHistoryRow) => void;
  onEdit: (row: ConversationReviewHistoryRow) => void;
  onManagerReview: (row: ConversationReviewHistoryRow) => void;
}) {
  return (
    <details className="relative" onClick={(event) => event.stopPropagation()}>
      <summary className="list-none rounded-xl border border-slate-600 bg-slate-900 px-3 py-2 text-center text-xs font-black text-cyan-100 hover:bg-slate-800 [&::-webkit-details-marker]:hidden">
        الإجراءات
      </summary>
      <div className="absolute left-0 z-40 mt-2 w-44 overflow-hidden rounded-xl border border-slate-700 bg-slate-950 shadow-2xl">
        <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-right text-xs font-bold text-slate-100 hover:bg-slate-800" onClick={() => onDetails(row)}>
          <Eye size={14} /> عرض التفاصيل
        </button>
        {canManage ? (
          <>
            <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-right text-xs font-bold text-slate-100 hover:bg-slate-800" onClick={() => onEdit(row)}>
              <Pencil size={14} /> تعديل التقييم
            </button>
            <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-right text-xs font-bold text-slate-100 hover:bg-slate-800" onClick={() => onManagerReview(row)}>
              <UserCheck size={14} /> تقييم المراجع
            </button>
          </>
        ) : null}
      </div>
    </details>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[#2d4063] bg-[#16253f] p-3">
      <div className="text-slate-300 text-xs">{label}</div>
      <div className="text-white font-bold text-sm mt-1">{value}</div>
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone: 'teal' | 'red' | 'amber' | 'blue' | 'slate';
}) {
  const toneClass =
    tone === 'teal'
      ? 'text-teal-300'
      : tone === 'red'
        ? 'text-red-300'
        : tone === 'amber'
          ? 'text-amber-300'
          : tone === 'blue'
            ? 'text-blue-300'
            : 'text-slate-100';
  return (
    <div className="stat-card py-4">
      <div className="text-slate-300 text-xs">{label}</div>
      <div className={`font-black num mt-1 text-xl ${toneClass}`}>{value}</div>
    </div>
  );
}
