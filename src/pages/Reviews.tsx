import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, BarChart3, CheckCircle2, Clock, ListChecks, RefreshCw, Save, Search, Star, Trash2 } from "lucide-react";
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
} from "@/lib/conversationReviews";
import { supabase } from "@/lib/supabase";
import { useAuth, getCurrentUserProfile } from "@/hooks/useAuth";
import { toast } from "sonner";
import { useSupabaseQuery, logActivity } from "@/hooks/useSupabaseQuery";
import { applyStaffDelta, persistPointsTransaction } from "@/lib/pointsPersistence";
import { getCycleForDate } from "@/lib/pharmacy-cycle";
import type { Customer } from "@/types/database";
import { getCustomers } from "@/lib/api/customers";
import { toNumber } from "@/lib/utils";
import { isActiveStaffFilter } from "@/lib/staffActiveFilter";
import { mergeStaffChoices, reviewerChoices } from "@/lib/staffFallback";
import { TABLES } from "@/lib/supabaseTables";
import { canonicalMaxPoints, canonicalSnapshotPoints } from "@/lib/pointsLedger";
import { notifyEmployee } from "@/lib/notificationService";

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
  reviewer_name?: string | null;
  reviewer_role?: string | null;
  staff_name?: string | null;
  staff_role?: string | null;
  doctor_name?: string | null;
  branch?: string | null;
  customer_name?: string | null;
  customer_code?: string | null;
  customer_phone?: string | null;
  invoice_number?: string | null;
  evaluation_kind?: string | null;
  conversation_type?: string | null;
  evaluation_reason?: string | null;
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
}

interface ReviewDraftPayload {
  form: typeof emptyReviewForm;
  reviewState: ConversationReviewState;
  severeErrors: SevereErrorsState;
  custSearch: string;
  savedAt: string;
}

const EVAL_KINDS = ["واتساب", "مكالمة", "داخل الفرع", "متابعة عميل", "شكوى", "عملية بيع", "مراجعة فاتورة"];
const EVAL_REASONS = ["مراجعة عشوائية", "شكوى عميل", "متابعة جودة", "عملية بيع مهمة", "عميل VIP", "خطأ فاتورة", "تقييم تدريب", "مراجعة أداء شهرية"];

const REVIEW_DRAFT_KEY = "dawaa_conversation_review_draft_v2";

const emptyReviewForm = {
  reviewerId: "",
  staffId: "",
  customerId: "",
  customerCode: "",
  customerName: "",
  customerPhone: "",
  evaluationKind: "واتساب",
  evaluationReason: "مراجعة عشوائية",
  invoiceNo: "",
  conversationDate: "",
  firstCustomerMessageAt: "",
  firstStaffReplyAt: "",
  followUpPromised: false,
  followUpPromisedAt: "",
  followUpReturnedAt: "",
  notes: "",
  reviewerNotes: "",
  trainingRecommendationManual: "",
};

function asUuid(value?: string | null) {
  if (!value) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(value) ? value : null;
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
  if (minutes <= 5) return "within_5";
  if (minutes <= 10) return "five_to_10";
  if (minutes <= 20) return "ten_to_20";
  if (minutes <= 30) return "over_20";
  return "over_30";
}

function followupChoice(minutes: number | null, promised: boolean) {
  if (!promised) return null;
  if (minutes == null) return "never";
  if (minutes <= 5) return "within_5";
  if (minutes <= 10) return "five_to_10";
  if (minutes <= 20) return "over_10";
  return "over_20";
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

function boolFromChoice(key: ReviewCriterionKey, choice: string, yesValues: string[]) {
  return yesValues.includes(choiceLabel(key, choice)) || yesValues.includes(choice);
}

function scoreOf(row: ConversationReviewHistoryRow) {
  return toNumber(row.final_score ?? row.total_score ?? 0);
}

function impactOf(row: ConversationReviewHistoryRow) {
  return toNumber(row.doctor_points_impact ?? row.point_impact ?? 0);
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value.slice(0, 16);
  return d.toLocaleString("ar-EG", { dateStyle: "short", timeStyle: "short" });
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

async function insertConversationReviewSafe(payload: Record<string, unknown>) {
  let currentPayload = { ...payload };
  const removedColumns: string[] = [];
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const ins = await supabase.from("conversation_sales_reviews").insert(currentPayload).select("id").single();
    if (!ins.error) return { id: ins.data?.id as string | undefined, removedColumns };
    const missing = missingColumnName(ins.error.message);
    if (missing && Object.prototype.hasOwnProperty.call(currentPayload, missing)) {
      delete currentPayload[missing];
      removedColumns.push(missing);
      continue;
    }
    throw new Error(`failed insert conversation_sales_reviews: ${ins.error.message}`);
  }
  throw new Error("failed insert conversation_sales_reviews: schema mismatch too large");
}

export default function Reviews() {
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);
  const [reviewState, setReviewState] = useState<ConversationReviewState>(defaultReviewState());
  const [severeErrors, setSevereErrors] = useState<SevereErrorsState>(defaultSevereErrors());
  const [custSearch, setCustSearch] = useState("");
  const [custHits, setCustHits] = useState<Customer[]>([]);
  const [repeatInfo, setRepeatInfo] = useState<{ count: number; multiplier: number } | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [reviewHistory, setReviewHistory] = useState<ConversationReviewHistoryRow[]>([]);
  const [draftRestored, setDraftRestored] = useState(false);
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const [form, setForm] = useState(() => ({
    ...emptyReviewForm,
    reviewerId: user?.id || "",
    conversationDate: isoInputNow(),
  }));

  const { data: staff } = useSupabaseQuery<StaffOpt>({ table: "staff", filters: isActiveStaffFilter(), realtimeEnabled: false });
  const staffOptions = useMemo(() => mergeStaffChoices(staff), [staff]);
  const reviewers = useMemo(() => {
    const choices = reviewerChoices(staff);
    if (user && !choices.some((row) => row.id === user.id)) {
      return [{ id: user.id, name: user.name, role: user.role, branch: user.branch || "", points: null, max_points: null }, ...choices];
    }
    return choices;
  }, [staff, user]);

  const selectedStaff = staffOptions.find((s) => s.id === form.staffId) || null;

  const loadReviewHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const { data, error } = await supabase
        .from("conversation_sales_reviews")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(80);
      if (error) throw error;
      setReviewHistory((data || []) as ConversationReviewHistoryRow[]);
    } catch (error) {
      setHistoryError((error as Error).message);
      setReviewHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

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
      if (draft.form) setForm((current) => ({ ...current, ...draft.form, reviewerId: draft.form?.reviewerId || current.reviewerId || user?.id || "" }));
      if (draft.reviewState) setReviewState(draft.reviewState);
      if (draft.severeErrors) setSevereErrors(draft.severeErrors);
      if (typeof draft.custSearch === "string") setCustSearch(draft.custSearch);
      if (draft.savedAt) setDraftSavedAt(draft.savedAt);
    } catch {
      // تجاهل أي مسودة تالفة وعدم تعطيل الصفحة
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

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (!form.staffId && !form.customerName && !form.invoiceNo && !form.notes && !form.reviewerNotes) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [form]);
  const selectedReviewer = reviewers.find((s) => s.id === form.reviewerId) || reviewers[0] || null;
  const responseMinutes = useMemo(() => minutesBetween(form.firstCustomerMessageAt, form.firstStaffReplyAt), [form.firstCustomerMessageAt, form.firstStaffReplyAt]);
  const followupDelayMinutes = useMemo(() => minutesBetween(form.followUpPromisedAt, form.followUpReturnedAt), [form.followUpPromisedAt, form.followUpReturnedAt]);
  const result = useMemo(() => evaluateConversationReview(reviewState, severeErrors), [reviewState, severeErrors]);
  const finalTraining = form.trainingRecommendationManual || result.trainingRecommendation;
  const conversationDate = form.conversationDate || isoInputNow();
  const reviewCycle = useMemo(() => getCycleForDate(new Date(conversationDate)), [conversationDate]);
  const monthCycle = useMemo(() => monthCycleFromDate(conversationDate), [conversationDate]);
  const historyStats = useMemo(() => {
    const byBranch = new Map<string, { branch: string; count: number; total: number; low: number; positive: number; negative: number }>();
    for (const row of reviewHistory) {
      const branch = row.branch || "غير محدد";
      const score = scoreOf(row);
      const impact = impactOf(row);
      const entry = byBranch.get(branch) || { branch, count: 0, total: 0, low: 0, positive: 0, negative: 0 };
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
            notes: waitChoice === "never" ? "تم وعد العميل بالمتابعة ولم يتم الرجوع له" : `مدة الرجوع بعد الوعد: ${followupDelayMinutes} دقيقة`,
          }
        : { ...current.followup_after_wait, applies: false },
    }));
    toast.success("تم تطبيق توقيت الرد والمتابعة على بنود التقييم");
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
        .select("id,description,month_cycle")
        .eq("staff_id", selectedStaff.id)
        .eq("month_cycle", monthCycle)
        .ilike("description", `%review_error:${result.repeatErrorType}%`);
      if (!error) return data?.length || 0;
    } catch {
      // fallback below
    }

    const { data } = await supabase
      .from(TABLES.employeeTransactions)
      .select("id,description,created_at")
      .eq("staff_id", selectedStaff.id)
      .gte("created_at", `${reviewCycle.start.toISOString().slice(0, 10)}T00:00:00`)
      .lte("created_at", `${reviewCycle.end.toISOString().slice(0, 10)}T23:59:59`)
      .ilike("description", `%review_error:${result.repeatErrorType}%`);
    return data?.length || 0;
  };

  const save = async () => {
    if (!selectedStaff) {
      toast.error("اختر الدكتور أو الموظف الذي يتم تقييمه");
      return;
    }
    if (!selectedReviewer) {
      toast.error("اختر من يقوم بالتقييم");
      return;
    }
    if (result.totalApplicableItems === 0 || result.totalApplicablePoints === 0) {
      toast.error("فعّل بند واحد على الأقل قبل حفظ التقييم");
      return;
    }

    setSaving(true);
    try {
      const previousCount = await countPreviousReviewErrors();
      const multiplier = result.doctorPointsImpact < 0 && result.repeatErrorType ? previousCount + 1 : 1;
      const repeatedDoctorImpact = result.doctorPointsImpact < 0 ? -Math.abs(result.doctorPointsImpact) * multiplier : result.doctorPointsImpact;
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
        first_customer_message_at: form.firstCustomerMessageAt ? new Date(form.firstCustomerMessageAt).toISOString() : null,
        first_staff_reply_at: form.firstStaffReplyAt ? new Date(form.firstStaffReplyAt).toISOString() : null,
        first_response_minutes: responseMinutes,
        response_speed_score: getScore("first_response_speed", selectedChoices),
        greeting_score: getScore("greeting", selectedChoices),
        greeting_message_used: selectedChoices.greeting.applies ? choiceLabel("greeting", selectedChoices.greeting.choice) : null,
        doctor_name_used_in_greeting: selectedChoices.greeting.applies && ["official_full", "close_with_name"].includes(selectedChoices.greeting.choice),
        doctor_name_used: selectedChoices.doctor_name.applies && selectedChoices.doctor_name.choice !== "none",
        doctor_name_score: getScore("doctor_name", selectedChoices),
        customer_name_used: selectedChoices.customer_name.applies && selectedChoices.customer_name.choice === "used",
        customer_name_score: getScore("customer_name", selectedChoices),
        tone_language_score: getScore("tone", selectedChoices),
        bad_tone_flag: selectedChoices.tone.applies && ["dry", "bad", "very_bad", "insult"].includes(selectedChoices.tone.choice),
        severe_bad_tone_flag: selectedChoices.tone.applies && selectedChoices.tone.choice === "insult",
        understanding_score: getScore("understanding", selectedChoices),
        rushed_response_flag: selectedChoices.understanding.applies && selectedChoices.understanding.choice === "rushed",
        misunderstood_customer_flag: selectedChoices.understanding.applies && ["wrong", "caused_error"].includes(selectedChoices.understanding.choice),
        follow_up_promised: form.followUpPromised || selectedChoices.followup_after_wait.applies,
        follow_up_delay_minutes: followupDelayMinutes,
        follow_up_score: getScore("followup_after_wait", selectedChoices),
        consultation_quality_score: getScore("consultation_quality", selectedChoices),
        dosage_explanation_score: getScore("dosage_explanation", selectedChoices),
        alternative_handling_score: getScore("unavailable_items", selectedChoices),
        bad_alternative_flag: selectedChoices.unavailable_items.applies && selectedChoices.unavailable_items.choice === "bad_alternative",
        sales_quality_score: getScore("sales_closing", selectedChoices),
        upsell_cross_sell_score: getScore("cross_sell_upsell", selectedChoices),
        complaint_handling_score: getScore("angry_customer", selectedChoices),
        order_confirmation_score: getScore("order_confirmation", selectedChoices),
        closing_message_score: getScore("closing_message", selectedChoices),
        closing_message_used: selectedChoices.closing_message.applies && ["official", "near_official"].includes(selectedChoices.closing_message.choice),
        has_complaint: Boolean(selectedChoices.angry_customer.applies || severeErrors.insult),
        has_medical_error: Boolean(severeErrors.medical_error || result.reviewItems.some((item) => item.errorType === "medical_error")),
        has_invoice_error: Boolean(severeErrors.invoice_error),
        has_delivery_issue: Boolean(severeErrors.delivery_error),
        reviewer_notes: form.reviewerNotes || form.notes,
        training_recommendation: finalTraining,
      };

      const ins = await insertConversationReviewSafe(payload);
      const reviewRowId = ins.id;
      if (ins.removedColumns.length) {
        toast.warning(`تم حفظ التقييم، لكن قاعدة البيانات ينقصها أعمدة اختيارية: ${ins.removedColumns.slice(0, 4).join(", ")}`);
      }

      if (repeatedDoctorImpact !== 0) {
        const pointsResult = await persistPointsTransaction({
          employeeId: selectedStaff.id,
          employeeName: selectedStaff.name,
          branch: selectedStaff.branch,
          branchId: selectedStaff.branch_id ?? null,
          operation: repeatedDoctorImpact > 0 ? "bonus" : "deduction",
          rule: null,
          pointsToStore: Math.abs(repeatedDoctorImpact),
          basePoints: Math.abs(result.doctorPointsImpact),
          repeatCount: previousCount,
          multiplier,
          finalPoints: Math.abs(repeatedDoctorImpact),
          reasonLabel: `تقييم محادثة عميل - النتيجة ${result.finalScore}/100`,
          userNote: [
            form.reviewerNotes || form.notes || `تقييم محادثة ${result.finalScore}/100`,
            result.repeatErrorType ? `review_error:${result.repeatErrorType}` : "",
            result.mainNegativeReason ? `سبب التأثير: ${result.mainNegativeReason}` : result.mainPositiveReason,
            reviewRowId ? `review_id:${reviewRowId}` : "",
          ]
            .filter(Boolean)
            .join(" | "),
          createdByName: selectedReviewer.name || user?.name || "مراجع",
          createdById: selectedReviewer.id || user?.id || "",
          createdByRole: selectedReviewer.role || user?.role || "",
          status: result.impactStatus === "approved" ? "approved" : "pending",
          cycle: reviewCycle,
          source: "conversation_evaluation",
          sourceModule: "conversation_evaluation",
          sourceRecordId: reviewRowId ?? null,
          description: form.reviewerNotes || form.notes || finalTraining,
        });

        if (pointsResult.error) {
          toast.warning(`تم حفظ التقييم، لكن لم يتم حفظ تأثير النقاط: ${pointsResult.error}`);
        } else if (result.impactStatus === "approved") {
          await applyStaffDelta(
            selectedStaff.id,
            canonicalSnapshotPoints(selectedStaff),
            canonicalMaxPoints(selectedStaff),
            repeatedDoctorImpact > 0 ? Math.abs(repeatedDoctorImpact) : -Math.abs(repeatedDoctorImpact),
            selectedStaff.name,
            selectedStaff.branch,
          );
        }

        if (!pointsResult.error) {
          const currentUserProfile = getCurrentUserProfile();
          await logActivity(
            currentUserProfile.id,
            currentUserProfile.name,
            repeatedDoctorImpact > 0 ? "إضافة مكافأة من تقييم محادثة" : "إضافة خصم من تقييم محادثة",
            "النقاط",
            `${selectedStaff.name} - تأثير ${repeatedDoctorImpact > 0 ? "+" : ""}${repeatedDoctorImpact} نقطة من تقييم ${result.finalScore}/100`,
            selectedStaff.branch || "",
            {
              user_role: user?.role,
              target_type: "point_record",
              target_id: pointsResult.id || reviewRowId || "",
            }
          );
        }
      }

      const currentUserProfile = getCurrentUserProfile();
      await logActivity(currentUserProfile.id, currentUserProfile.name, "تقييم محادثة", "تقييم المحادثات", `درجة ${result.finalScore}/100 - ${selectedStaff.name}`, selectedStaff.branch || "", {
        user_role: currentUserProfile.role,
        target_type: "conversation_review",
        target_id: reviewRowId || "",
      });

      await notifyEmployee({
        title: result.finalScore < 70 ? "تقييم محادثة يحتاج مراجعة" : "تم حفظ تقييم محادثة",
        message: result.finalScore < 70
          ? `درجتك ${result.finalScore}/100. يرجى مراجعة التقييم لتجنب تكرار الخطأ.`
          : `تقييم المحادثة ${result.finalScore}/100. ${result.finalScore >= 90 ? "أداء ممتاز." : "راجع الملاحظات للتحسين."}`,
        type: "conversation_review",
        priority: result.finalScore < 70 ? "high" : "normal",
        recipient_staff_id: selectedStaff.id,
        branch: selectedStaff.branch,
        target_type: "conversation_review",
        target_id: reviewRowId || "",
        target_route: reviewRowId ? `/reviews?id=${reviewRowId}` : "/reviews",
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

      await loadReviewHistory();
      window.localStorage.removeItem(REVIEW_DRAFT_KEY);
      setDraftSavedAt(null);
      toast.success("تم حفظ تقييم المحادثة وتحديث سجل التقييمات بنجاح");
    } catch (error) {
      toast.error(`تعذر الحفظ الكامل: ${(error as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const startNewReview = () => {
    setForm({ ...emptyReviewForm, reviewerId: user?.id || "", conversationDate: isoInputNow() });
    setReviewState(defaultReviewState());
    setSevereErrors(defaultSevereErrors());
    setCustSearch("");
    setCustHits([]);
    setRepeatInfo(null);
    setDraftSavedAt(null);
    window.localStorage.removeItem(REVIEW_DRAFT_KEY);
    toast.success("تم فتح تقييم جديد");
  };

  return (
    <div className="space-y-5 max-w-6xl">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-teal-500/15 flex items-center justify-center text-teal-400">
          <Star size={22} />
        </div>
        <div>
          <h1 className="page-title">تقييم المحادثات وعمليات البيع</h1>
          <p className="text-slate-400 text-sm">تقييم ديناميكي يحسب البنود المطبقة فقط ويربط النتيجة بنقاط الدكتور.</p>
        </div>
      </div>

      <section className="stat-card border border-teal-500/20 bg-teal-500/5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div className="flex items-center gap-2">
            <ListChecks className="text-teal-400" size={20} />
            <div>
              <h2 className="text-white font-bold text-lg">سجل تقييم المحادثات</h2>
              <p className="text-slate-400 text-sm">آخر التقييمات المحفوظة: المراجع، الدكتور، العميل، الفرع، الفاتورة، النتيجة، وتأثير النقاط.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {draftSavedAt && <span className="badge-info text-xs">تم حفظ مسودة تلقائيًا {formatDateTime(draftSavedAt)}</span>}
            <button type="button" onClick={loadReviewHistory} disabled={historyLoading} className="btn-secondary flex items-center gap-2">
              <RefreshCw size={16} className={historyLoading ? "animate-spin" : ""} />
              تحديث السجل
            </button>
            <button type="button" onClick={startNewReview} className="btn-secondary flex items-center gap-2">
              <Trash2 size={16} />
              تقييم جديد
            </button>
          </div>
        </div>

        {historyError && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-amber-100 text-sm">
            تعذر تحميل سجل التقييمات. تأكد من تشغيل ملف <b>CONVERSATION_REVIEWS_HISTORY_FIX.sql</b>. تفاصيل الخطأ: {historyError}
          </div>
        )}

        <div className="grid md:grid-cols-4 gap-3">
          <Metric label="عدد التقييمات المسجلة" value={`${reviewHistory.length}`} tone="teal" />
          <Metric label="متوسط آخر تقييمات" value={`${reviewHistory.length ? Math.round(reviewHistory.reduce((sum, row) => sum + scoreOf(row), 0) / reviewHistory.length) : 0}/100`} tone="blue" />
          <Metric label="تقييمات أقل من 70" value={`${reviewHistory.filter((row) => scoreOf(row) < 70).length}`} tone="red" />
          <Metric label="فروع تم تقييمها" value={`${historyStats.length}`} tone="slate" />
        </div>

        {historyStats.length > 0 && (
          <div className="rounded-xl border border-[#2d4063] bg-[#16253f] p-3">
            <div className="flex items-center gap-2 text-slate-200 font-bold mb-3">
              <BarChart3 size={17} className="text-teal-400" />
              تقييم المحادثات حسب الفرع
            </div>
            <div className="grid md:grid-cols-3 gap-2">
              {historyStats.slice(0, 6).map((row) => (
                <div key={row.branch} className="rounded-xl border border-[#2d4063] bg-[#0f1b2e] p-3">
                  <div className="text-white font-bold">{row.branch}</div>
                  <div className="grid grid-cols-2 gap-2 mt-2 text-xs text-slate-300">
                    <span>العدد: <b className="num text-white">{row.count}</b></span>
                    <span>المتوسط: <b className="num text-white">{row.avg}/100</b></span>
                    <span>أقل من 70: <b className="num text-red-300">{row.low}</b></span>
                    <span>خصومات: <b className="num text-red-300">{row.negative}</b></span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="overflow-x-auto rounded-xl border border-[#2d4063]">
          <table className="w-full min-w-[1100px] text-sm">
            <thead className="bg-[#16253f] text-slate-300">
              <tr>
                <th className="p-3 text-right">التاريخ</th>
                <th className="p-3 text-right">المراجع</th>
                <th className="p-3 text-right">الدكتور المقيم</th>
                <th className="p-3 text-right">الفرع</th>
                <th className="p-3 text-right">العميل</th>
                <th className="p-3 text-right">الفاتورة</th>
                <th className="p-3 text-right">نوع المحادثة</th>
                <th className="p-3 text-right">التقييم</th>
                <th className="p-3 text-right">النقاط</th>
                <th className="p-3 text-right">أهم ملاحظة</th>
              </tr>
            </thead>
            <tbody>
              {reviewHistory.slice(0, 12).map((row, index) => {
                const score = scoreOf(row);
                const impact = impactOf(row);
                return (
                  <tr key={row.id || index} className="border-t border-[#2d4063]/70">
                    <td className="p-3 text-slate-300 whitespace-nowrap">{formatDateTime(row.created_at)}</td>
                    <td className="p-3 text-white">{row.reviewer_name || "غير محدد"}</td>
                    <td className="p-3 text-white">{row.staff_name || row.doctor_name || "غير محدد"}</td>
                    <td className="p-3 text-slate-300">{row.branch || "-"}</td>
                    <td className="p-3 text-slate-300">
                      <div>{row.customer_name || "غير محدد"}</div>
                      {(row.customer_code || row.customer_phone) && <div className="text-xs text-slate-500">{row.customer_code || row.customer_phone}</div>}
                    </td>
                    <td className="p-3 text-slate-300 num">{row.invoice_number || "-"}</td>
                    <td className="p-3 text-slate-300">{row.evaluation_kind || row.conversation_type || "-"}</td>
                    <td className="p-3">
                      <span className={score >= 90 ? "badge-success text-xs" : score >= 70 ? "badge-warning text-xs" : "badge-danger text-xs"}>{score}/100</span>
                    </td>
                    <td className={`p-3 num font-bold ${impact >= 0 ? "text-teal-300" : "text-red-300"}`}>{impact > 0 ? `+${impact}` : impact}</td>
                    <td className="p-3 text-slate-400 max-w-[260px] truncate" title={row.main_negative_reason || row.main_positive_reason || row.reviewer_notes || ""}>
                      {row.main_negative_reason || row.main_positive_reason || row.reviewer_notes || "-"}
                    </td>
                  </tr>
                );
              })}
              {!historyLoading && reviewHistory.length === 0 && (
                <tr>
                  <td colSpan={10} className="p-6 text-center text-slate-400">لا يوجد تقييمات محفوظة حتى الآن.</td>
                </tr>
              )}
              {historyLoading && (
                <tr>
                  <td colSpan={10} className="p-6 text-center text-slate-400">جاري تحميل سجل التقييمات...</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Metric label="تقييم المحادثة" value={`${result.finalScore}/100`} tone={result.finalScore >= 90 ? "teal" : result.finalScore >= 70 ? "amber" : "red"} />
        <Metric label="تأثير النقاط" value={result.impactLabel} tone={result.doctorPointsImpact >= 0 ? "teal" : "red"} />
        <Metric label="البنود المطبقة" value={`${result.totalApplicableItems}/${REVIEW_CRITERIA.length}`} tone="blue" />
        <Metric label="توصية التدريب" value={finalTraining.split(" ").slice(0, 3).join(" ")} tone="slate" />
      </div>

      <section className="stat-card space-y-4">
        <div className="section-title text-sm">بيانات المحادثة</div>
        <div className="grid md:grid-cols-3 gap-3">
          <Field label="من يقيم؟">
            <select className="input-dark" value={form.reviewerId} onChange={(e) => setForm((f) => ({ ...f, reviewerId: e.target.value }))}>
              <option value="">اختر المراجع</option>
              {reviewers.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name} - {row.role}
                </option>
              ))}
            </select>
          </Field>
          <Field label="الدكتور / الموظف المقيم">
            <select className="input-dark" value={form.staffId} onChange={(e) => setForm((f) => ({ ...f, staffId: e.target.value }))}>
              <option value="">اختر الدكتور أو الموظف</option>
              {staffOptions.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name} - {row.role} - {row.branch}
                </option>
              ))}
            </select>
          </Field>
          <Field label="نوع المحادثة">
            <select className="input-dark" value={form.evaluationKind} onChange={(e) => setForm((f) => ({ ...f, evaluationKind: e.target.value }))}>
              {EVAL_KINDS.map((kind) => (
                <option key={kind}>{kind}</option>
              ))}
            </select>
          </Field>
          <Field label="سبب التقييم">
            <select className="input-dark" value={form.evaluationReason} onChange={(e) => setForm((f) => ({ ...f, evaluationReason: e.target.value }))}>
              {EVAL_REASONS.map((reason) => (
                <option key={reason}>{reason}</option>
              ))}
            </select>
          </Field>
          <Field label="تاريخ المحادثة">
            <input className="input-dark" type="datetime-local" value={form.conversationDate} onChange={(e) => setForm((f) => ({ ...f, conversationDate: e.target.value }))} />
          </Field>
          <Field label="رقم الفاتورة">
            <input className="input-dark" value={form.invoiceNo} onChange={(e) => setForm((f) => ({ ...f, invoiceNo: e.target.value }))} placeholder="اختياري" />
          </Field>
        </div>
      </section>

      <section className="stat-card space-y-3">
        <div className="section-title text-sm">العميل</div>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
            <input className="input-dark pr-10" value={custSearch} onChange={(e) => setCustSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && loadCustomersHits()} placeholder="ابحث بكود العميل أو الاسم أو الهاتف" />
          </div>
          <button type="button" onClick={loadCustomersHits} className="btn-secondary">بحث</button>
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
                    customerCode: customer.customer_code || "",
                    customerName: customer.name || "",
                    customerPhone: customer.phone || "",
                  }));
                  setCustSearch(customer.name || customer.customer_code || "");
                  setCustHits([]);
                }}
              >
                <div className="text-white font-semibold text-sm">{customer.name || "عميل بدون اسم"}</div>
                <div className="text-slate-400 text-xs mt-1">{customer.customer_code || "بدون كود"} - {customer.phone || "بدون هاتف"}</div>
              </button>
            ))}
          </div>
        )}
        <div className="grid md:grid-cols-3 gap-3">
          <input className="input-dark" value={form.customerName} onChange={(e) => setForm((f) => ({ ...f, customerName: e.target.value }))} placeholder="اسم العميل" />
          <input className="input-dark" value={form.customerCode} onChange={(e) => setForm((f) => ({ ...f, customerCode: e.target.value }))} placeholder="كود العميل" />
          <input className="input-dark" value={form.customerPhone} onChange={(e) => setForm((f) => ({ ...f, customerPhone: e.target.value }))} placeholder="هاتف العميل" />
        </div>
      </section>

      <section className="stat-card space-y-4">
        <div className="flex items-center gap-2">
          <Clock className="text-teal-400" size={18} />
          <div className="section-title text-sm">توقيت الرد والمتابعة</div>
        </div>
        <div className="grid md:grid-cols-4 gap-3">
          <Field label="أول رسالة من العميل">
            <input className="input-dark" type="datetime-local" value={form.firstCustomerMessageAt} onChange={(e) => setForm((f) => ({ ...f, firstCustomerMessageAt: e.target.value }))} />
          </Field>
          <Field label="أول رد من الدكتور">
            <input className="input-dark" type="datetime-local" value={form.firstStaffReplyAt} onChange={(e) => setForm((f) => ({ ...f, firstStaffReplyAt: e.target.value }))} />
          </Field>
          <Field label="وعد بالرجوع؟">
            <label className="flex h-12 items-center gap-2 rounded-xl border border-[#2d4063] bg-[#16253f] px-3 text-sm text-slate-300">
              <input type="checkbox" checked={form.followUpPromised} onChange={(e) => setForm((f) => ({ ...f, followUpPromised: e.target.checked }))} />
              قال لحظات / هراجع
            </label>
          </Field>
          <div className="flex items-end">
            <button type="button" className="btn-primary w-full" onClick={applyTiming}>تطبيق التوقيت</button>
          </div>
          <Field label="وقت الوعد">
            <input className="input-dark" type="datetime-local" value={form.followUpPromisedAt} onChange={(e) => setForm((f) => ({ ...f, followUpPromisedAt: e.target.value }))} />
          </Field>
          <Field label="وقت الرجوع">
            <input className="input-dark" type="datetime-local" value={form.followUpReturnedAt} onChange={(e) => setForm((f) => ({ ...f, followUpReturnedAt: e.target.value }))} />
          </Field>
          <Info label="مدة أول رد" value={responseMinutes == null ? "غير محسوبة" : `${responseMinutes} دقيقة`} />
          <Info label="مدة الرجوع" value={!form.followUpPromised ? "لا ينطبق" : followupDelayMinutes == null ? "لم يرجع" : `${followupDelayMinutes} دقيقة`} />
        </div>
      </section>

      <section className="space-y-3">
        {REVIEW_CRITERIA.map((criterion) => {
          const itemState = reviewState[criterion.key];
          return (
            <div key={criterion.key} className={`stat-card border ${itemState.applies ? "border-teal-500/20" : "border-[#2d4063]"}`}>
              <div className="flex flex-col md:flex-row md:items-start gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="text-white font-bold text-sm">{criterion.label}</div>
                    <span className="badge-info text-xs">{criterion.maxPoints} نقطة</span>
                    {!itemState.applies && <span className="badge-muted text-xs">لا ينطبق</span>}
                  </div>
                  <p className="text-slate-400 text-xs mt-1 leading-relaxed">{criterion.hint}</p>
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-300">
                  <input type="checkbox" checked={itemState.applies} onChange={(e) => setCriterionApplies(criterion.key, e.target.checked)} />
                  ينطبق
                </label>
              </div>
              {itemState.applies && (
                <div className="grid md:grid-cols-2 gap-3 mt-4">
                  <select className="input-dark" value={itemState.choice} onChange={(e) => setCriterionChoice(criterion.key, e.target.value)}>
                    {criterion.choices.map((choice) => (
                      <option key={choice.value} value={choice.value}>
                        {choice.label} - {choice.pointsEarned}/{criterion.maxPoints}
                      </option>
                    ))}
                  </select>
                  <input className="input-dark" value={itemState.notes || ""} onChange={(e) => setCriterionNotes(criterion.key, e.target.value)} placeholder="ملاحظة على البند (اختياري)" />
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
          {(Object.entries(SEVERE_ERRORS) as Array<[SevereErrorKey, (typeof SEVERE_ERRORS)[SevereErrorKey]]>).map(([key, error]) => (
            <label key={key} className="flex items-center gap-2 rounded-xl border border-[#2d4063] bg-[#16253f] p-3 text-sm text-slate-300">
              <input type="checkbox" checked={severeErrors[key]} onChange={(e) => setSevere(key, e.target.checked)} />
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
          <Info label="الدكتور" value={selectedStaff ? `${selectedStaff.name} - ${selectedStaff.branch}` : "لم يتم الاختيار"} />
          <Info label="العميل" value={form.customerName || "غير محدد"} />
          <Info label="المراجع" value={selectedReviewer ? selectedReviewer.name : "غير محدد"} />
          <Info label="رقم الفاتورة" value={form.invoiceNo || "غير مسجل"} />
          <Info label="نوع المحادثة" value={form.evaluationKind} />
          <Info label="دورة النقاط" value={monthCycle} />
        </div>

        <div className="overflow-x-auto rounded-xl border border-[#2d4063]">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-[#16253f] text-slate-300">
              <tr>
                <th className="p-3 text-right">البند</th>
                <th className="p-3 text-right">الحالة</th>
                <th className="p-3 text-right">الاختيار</th>
                <th className="p-3 text-right">النقاط</th>
                <th className="p-3 text-right">ملاحظة</th>
              </tr>
            </thead>
            <tbody>
              {result.reviewItems.map((item) => (
                <tr key={item.key} className="border-t border-[#2d4063]/70">
                  <td className="p-3 text-white">{item.label}</td>
                  <td className="p-3">{item.applies ? <span className="badge-success text-xs">ينطبق</span> : <span className="badge-muted text-xs">لا ينطبق</span>}</td>
                  <td className="p-3 text-slate-300">{item.applies ? item.selectedOption : "لا ينطبق"}</td>
                  <td className="p-3 text-slate-300 num">{item.applies ? `${item.pointsEarned}/${item.maxPoints}` : "-"}</td>
                  <td className="p-3 text-slate-400">{item.notes || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid md:grid-cols-5 gap-3">
          <Metric label="المطبقة" value={`${result.totalApplicableItems}`} tone="teal" />
          <Metric label="غير المطبقة" value={`${result.totalNotApplicableItems}`} tone="slate" />
          <Metric label="المكتسبة" value={`${result.earnedPoints}`} tone="teal" />
          <Metric label="الممكنة" value={`${result.totalApplicablePoints}`} tone="blue" />
          <Metric label="النتيجة" value={`${result.finalScore}/100`} tone={result.finalScore >= 90 ? "teal" : result.finalScore >= 70 ? "amber" : "red"} />
        </div>

        <div className="grid md:grid-cols-2 gap-3">
          <div className="rounded-2xl bg-[#16253f] border border-[#2d4063] p-5 text-center">
            <div className="text-slate-400 text-sm">تقييم المحادثة</div>
            <div className={`num text-5xl font-black mt-2 ${result.finalScore >= 90 ? "text-teal-400" : result.finalScore >= 70 ? "text-amber-400" : "text-red-400"}`}>{result.finalScore}</div>
            <div className="text-slate-400 text-xs mt-1">من 100 - {result.level}</div>
          </div>
          <div className="rounded-2xl bg-[#16253f] border border-[#2d4063] p-5 text-center">
            <div className="text-slate-400 text-sm">تأثيرها على نقاط الدكتور</div>
            <div className={`num text-5xl font-black mt-2 ${result.doctorPointsImpact >= 0 ? "text-teal-400" : "text-red-400"}`}>{result.impactLabel}</div>
            <div className="text-slate-400 text-xs mt-1">قبل تكرار نفس الخطأ داخل الدورة</div>
          </div>
        </div>

        <div className="rounded-xl bg-[#16253f] border border-[#2d4063] p-4 text-sm text-slate-300 leading-relaxed space-y-2">
          <div><span className="text-slate-400">سبب التأثير:</span> {result.impactReason}</div>
          <div><span className="text-slate-400">أهم سبب للخصم:</span> {result.mainNegativeReason || "لا يوجد"}</div>
          <div><span className="text-slate-400">أهم نقطة إيجابية:</span> {result.mainPositiveReason || "لا يوجد"}</div>
          <div><span className="text-slate-400">خصومات إضافية:</span> {result.extraPenalties.length ? result.extraPenalties.map((p) => `${p.label} (${p.points})`).join("، ") : "لا توجد"}</div>
          <div className="flex gap-2 flex-wrap pt-1">
            {result.hasSevereError && <span className="badge-danger text-xs">خطأ جسيم</span>}
            {result.forgottenCustomer && <span className="badge-danger text-xs">نسيان عميل</span>}
            {result.missedSalesOpportunity && <span className="badge-warning text-xs">فرصة بيع ضائعة</span>}
            {result.successfulCrossSell && <span className="badge-success text-xs">Cross-selling ناجح</span>}
            {result.handledAngryCustomerWell && <span className="badge-success text-xs">تعامل ممتاز مع شكوى</span>}
          </div>
        </div>

        <div className="rounded-xl bg-amber-500/10 border border-amber-500/25 p-4">
          <div className="text-amber-300 font-bold text-sm mb-2">التوصية التدريبية</div>
          <p className="text-slate-200 text-sm leading-relaxed">{finalTraining}</p>
          <textarea className="input-dark mt-3 min-h-20" value={form.trainingRecommendationManual} onChange={(e) => setForm((f) => ({ ...f, trainingRecommendationManual: e.target.value }))} placeholder="تعديل التوصية يدويًا عند الحاجة" />
        </div>

        <textarea className="input-dark min-h-24" value={form.reviewerNotes} onChange={(e) => setForm((f) => ({ ...f, reviewerNotes: e.target.value }))} placeholder="ملاحظات المراجع النهائية" />

        {repeatInfo && result.repeatErrorType && (
          <div className="rounded-xl bg-red-500/10 border border-red-500/25 p-3 text-red-200 text-sm">
            تم اكتشاف تكرار داخل الدورة: السابق {repeatInfo.count} مرة، المضاعف المطبق x{repeatInfo.multiplier}.
          </div>
        )}

        <button type="button" onClick={save} disabled={saving} className="btn-primary w-full justify-center text-base py-4 flex items-center gap-2">
          <Save size={18} />
          {saving ? "جاري حفظ التقييم..." : "حفظ التقييم"}
        </button>
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1 text-sm">
      <span className="text-slate-300">{label}</span>
      {children}
    </label>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[#2d4063] bg-[#16253f] p-3">
      <div className="text-slate-400 text-xs">{label}</div>
      <div className="text-white font-bold text-sm mt-1">{value}</div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string | number; tone: "teal" | "red" | "amber" | "blue" | "slate" }) {
  const toneClass =
    tone === "teal" ? "text-teal-400" : tone === "red" ? "text-red-400" : tone === "amber" ? "text-amber-400" : tone === "blue" ? "text-blue-400" : "text-slate-200";
  return (
    <div className="stat-card py-4">
      <div className="text-slate-400 text-xs">{label}</div>
      <div className={`font-black num mt-1 text-xl ${toneClass}`}>{value}</div>
    </div>
  );
}
