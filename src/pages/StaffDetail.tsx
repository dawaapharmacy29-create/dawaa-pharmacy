import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowRight, Eye, Loader2, X } from "lucide-react";
import SalaryCalculator from "@/components/points/SalaryCalculator";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { formatCurrency, toNumber } from "@/lib/utils";
import { calculateIncentive, getPerformanceLevel } from "@/lib/points";
import { getCurrentCycle, isDateInCycle } from "@/lib/pharmacy-cycle";
import { computeStaffPerformance2027, performanceRecommendation } from "@/lib/dawaa2027Data";
import { formatMoney, formatNumber } from "@/lib/dawaa2027";
import { monthCycleFromDate, type ReviewItemSummary } from "@/lib/conversationReviews";
import { canonicalMaxPoints, effectiveCyclePoints, getTransactionShortReason, isApprovedPointRecord, isRecordInCycle, pointRecordDelta, recordBelongsToStaff } from "@/lib/pointsLedger";
import { TABLES } from "@/lib/supabaseTables";
import { getStaffCycleIncentive, type StaffCycleIncentive } from "@/lib/staffIncentiveService";

interface StaffRow {
  id: string;
  name: string;
  role: string;
  branch: string;
  points: number | null;
  max_points: number | null;
}

interface ScheduleRow {
  id?: string;
  day?: string | null;
  weekday?: string | null;
  day_name?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  is_day_off?: boolean | null;
  status?: string | null;
}

interface TimeOffRow {
  id?: string;
  date?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  type?: string | null;
  reason?: string | null;
  notes?: string | null;
  status?: string | null;
}

interface PointRecord {
  id: string;
  staff_id?: string | null;
  employee_id?: string | null;
  employee_name?: string | null;
  type: string;
  points: number;
  points_delta?: number | null;
  reason: string;
  manager_note?: string | null;
  description?: string | null;
  created_by?: string | null;
  created_at: string;
  source_type?: string | null;
  source?: string | null;
  source_id?: string | null;
  month_cycle?: string | null;
  status?: string | null;
}

interface ReviewRow {
  id: string;
  staff_id?: string | null;
  doctor_id?: string | null;
  staff_name?: string | null;
  branch?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  customer_code?: string | null;
  invoice_number?: string | null;
  conversation_type?: string | null;
  evaluation_kind?: string | null;
  conversation_date?: string | null;
  reviewed_at?: string | null;
  created_at?: string | null;
  reviewer_name?: string | null;
  final_score?: number | null;
  level?: string | null;
  conversation_level?: string | null;
  doctor_points_impact?: number | null;
  base_points_impact?: number | null;
  extra_penalty_points?: number | null;
  total_applicable_items?: number | null;
  total_not_applicable_items?: number | null;
  total_applicable_points?: number | null;
  earned_points?: number | null;
  main_positive_reason?: string | null;
  main_negative_reason?: string | null;
  top_positive_reason?: string | null;
  top_deduction_reason?: string | null;
  training_recommendation?: string | null;
  has_medical_error?: boolean | null;
  has_invoice_error?: boolean | null;
  has_delivery_issue?: boolean | null;
  has_complaint?: boolean | null;
  forgotten_customer?: boolean | null;
  missed_sales_opportunity?: boolean | null;
  missed_sale_opportunity?: boolean | null;
  successful_cross_sell?: boolean | null;
  handled_angry_customer_well?: boolean | null;
  excellent_case?: boolean | null;
  reviewer_notes?: string | null;
  month_cycle?: string | null;
  review_items?: ReviewItemSummary[] | null;
  raw_scores?: { result?: { reviewItems?: ReviewItemSummary[] } } | null;
}

interface AssignedIncentiveMedicine {
  id: string;
  product_name: string;
  product_type?: string | null;
  doctor_id?: string | null;
  responsible_doctor?: string | null;
  current_quantity?: number | null;
  sold_quantity?: number | null;
  target_min_percent?: number | null;
  incentive_value?: number | null;
  incentive_type?: string | null;
  incentive_percent?: number | null;
  product_price?: number | null;
  branch?: string | null;
  expiry_date?: string | null;
  active?: boolean | null;
}

interface AssignedStagnantMedicine {
  id: string;
  product_name?: string | null;
  medicine_name?: string | null;
  category?: string | null;
  responsible_doctor_id?: string | null;
  responsible_doctor_name?: string | null;
  responsible_doctor?: string | null;
  total_quantity?: number | null;
  dispensed_quantity?: number | null;
  remaining_quantity?: number | null;
  nearest_expiry_date?: string | null;
  expiry_date?: string | null;
  incentive_per_unit?: number | null;
  branch_name?: string | null;
  branch?: string | null;
  status?: string | null;
}

function dayAfter(date: Date) {
  const next = new Date(date);
  next.setDate(next.getDate() + 1);
  return next.toISOString().slice(0, 10);
}

export default function StaffDetail() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const [staff, setStaff] = useState<StaffRow | null>(null);
  const [pointsRows, setPointsRows] = useState<PointRecord[]>([]);
  const [incentiveData, setIncentiveData] = useState<StaffCycleIncentive | null>(null);
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [assignedIncentives, setAssignedIncentives] = useState<AssignedIncentiveMedicine[]>([]);
  const [assignedStagnants, setAssignedStagnants] = useState<AssignedStagnantMedicine[]>([]);
  const [invoiceStats, setInvoiceStats] = useState({ count: 0, total: 0 });
  const [salesRows, setSalesRows] = useState<Record<string, unknown>[]>([]);
  const [followupRows, setFollowupRows] = useState<Record<string, unknown>[]>([]);
  const [stagnantDispenseRows, setStagnantDispenseRows] = useState<Record<string, unknown>[]>([]);
  const [listSaleRows, setListSaleRows] = useState<Record<string, unknown>[]>([]);
  const [scheduleRows, setScheduleRows] = useState<ScheduleRow[]>([]);
  const [timeOffRows, setTimeOffRows] = useState<TimeOffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedReview, setSelectedReview] = useState<ReviewRow | null>(null);
  const cycle = getCurrentCycle();
  const activeMonthCycle = monthCycleFromDate(cycle.end);

  useEffect(() => {
    if (!id || !isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function load() {
      setLoading(true);
      const { data: s } = await supabase.from("staff").select("*").eq("id", id).maybeSingle();
      if (cancelled) return;
      const row = (s || null) as StaffRow | null;
      if (!row) {
        setStaff(null);
        setLoading(false);
        return;
      }
      setStaff(row);

      const cycleStart = cycle.start.toISOString().slice(0, 10);
      const cycleEndExclusive = dayAfter(cycle.end);
      const invoiceReq = supabase
        .from("staff_sales_summary")
        .select("*")
        .eq("seller_name", row.name)
        .gte("sale_date", cycleStart)
        .lt("sale_date", cycleEndExclusive)
        .limit(500);
      const incentiveByIdReq = supabase.from("incentive_medicines").select("*").eq("doctor_id", id).limit(200);
      const incentiveByNameReq = supabase.from("incentive_medicines").select("*").eq("responsible_doctor", row.name).limit(200);
      const stagnantByIdReq = supabase.from("stagnant_medicines").select("*").eq("responsible_doctor_id", id).limit(200);
      const stagnantByNameReq = supabase.from("stagnant_medicines").select("*").or(`responsible_doctor_name.eq.${row.name},responsible_doctor.eq.${row.name}`).limit(200);
      const scheduleReq = supabase.from("shift_schedules").select("*").eq("staff_id", id).limit(80);
      const timeOffReq = supabase.from("shift_exceptions").select("*").eq("staff_id", id).order("date", { ascending: false }).limit(80);
      const followupsReq = supabase
        .from("daily_followups")
        .select("*")
        .or(`staff_id.eq.${id},assigned_staff_id.eq.${id},responsible_name.eq.${row.name},assigned_to.eq.${row.name},assigned_doctor.eq.${row.name}`)
        .gte("created_at", cycleStart)
        .lt("created_at", cycleEndExclusive)
        .limit(300);
      const stagnantDispensesReq = supabase
        .from("stagnant_medicine_dispenses")
        .select("*")
        .or(`doctor_id.eq.${id},staff_id.eq.${id},doctor_name.eq.${row.name},responsible_doctor_name.eq.${row.name},staff_name.eq.${row.name}`)
        .gte("created_at", cycleStart)
        .lt("created_at", cycleEndExclusive)
        .limit(300);
      const listSalesReq = supabase
        .from("incentive_medicine_sales")
        .select("*")
        .or(`doctor_id.eq.${id},staff_id.eq.${id},doctor_name.eq.${row.name},responsible_doctor.eq.${row.name},staff_name.eq.${row.name}`)
        .gte("created_at", cycleStart)
        .lt("created_at", cycleEndExclusive)
        .limit(300);

      const [invRes, incentiveById, incentiveByName, stagnantById, stagnantByName, scheduleRes, timeOffRes, followupsRes, stagnantDispensesRes, listSalesRes] = await Promise.all([
        invoiceReq,
        incentiveByIdReq,
        incentiveByNameReq,
        stagnantByIdReq,
        stagnantByNameReq,
        scheduleReq,
        timeOffReq,
        followupsReq,
        stagnantDispensesReq,
        listSalesReq,
      ]);

      // استخدام getStaffCycleIncentive لجمع البيانات من جميع المصادر
      const incentiveResult = await getStaffCycleIncentive({ staffId: id, staffName: row.name, branch: row.branch });
      setIncentiveData(incentiveResult);

      // تحويل incentiveData إلى pointRows للعرض فقط
      const pointRowsByKey = new Map<string, PointRecord>();
      for (const record of incentiveResult.rewardTransactions.concat(incentiveResult.deductionTransactions).concat(incentiveResult.pendingTransactions)) {
        const signedPoints = record.normalizedDelta;
        const rawPoints = Math.abs(signedPoints);
        pointRowsByKey.set(record.id || `${record.source_type}:${record.source_id}`, {
          ...record,
          employee_id: record.employee_id || record.staff_id || id,
          employee_name: record.employee_name || row.name,
          type: signedPoints > 0 ? "bonus" : signedPoints < 0 ? "deduction" : record.type,
          points: rawPoints,
          points_delta: signedPoints,
          manager_note: record.manager_note || record.description || null,
          status: record.status || "approved",
        } as PointRecord);
      }
      const pointRows = Array.from(pointRowsByKey.values())
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 150);
      let reviewRows: ReviewRow[] = [];
      const byId = await supabase
        .from("conversation_sales_reviews")
        .select("*")
        .or(`staff_id.eq.${id},doctor_id.eq.${id}`)
        .order("created_at", { ascending: false })
        .limit(150);
      if (!byId.error) {
        reviewRows = (byId.data || []) as ReviewRow[];
      } else {
        const fallback = await supabase.from("conversation_sales_reviews").select("*").eq("staff_name", row.name).order("created_at", { ascending: false }).limit(150);
        reviewRows = (fallback.data || []) as ReviewRow[];
      }

      if (cancelled) return;
      setPointsRows(pointRows);
      setReviews(reviewRows);
      const incentiveMap = new Map<string, AssignedIncentiveMedicine>();
      for (const item of ([...(incentiveById.data || []), ...(incentiveByName.data || [])] as AssignedIncentiveMedicine[])) {
        if (item.id) incentiveMap.set(item.id, item);
      }
      const stagnantMap = new Map<string, AssignedStagnantMedicine>();
      for (const item of ([...(stagnantById.data || []), ...(stagnantByName.data || [])] as AssignedStagnantMedicine[])) {
        if (item.id) stagnantMap.set(item.id, item);
      }
      setAssignedIncentives(Array.from(incentiveMap.values()));
      setAssignedStagnants(Array.from(stagnantMap.values()));
      setScheduleRows(((scheduleRes && !scheduleRes.error ? scheduleRes.data : []) || []) as ScheduleRow[]);
      setTimeOffRows(((timeOffRes && !timeOffRes.error ? timeOffRes.data : []) || []) as TimeOffRow[]);

      const invRows = ((invRes && !invRes.error ? invRes.data : []) || []) as Record<string, unknown>[];
      setSalesRows(invRows);
      setFollowupRows(((followupsRes && !followupsRes.error ? followupsRes.data : []) || []) as Record<string, unknown>[]);
      setStagnantDispenseRows(((stagnantDispensesRes && !stagnantDispensesRes.error ? stagnantDispensesRes.data : []) || []) as Record<string, unknown>[]);
      setListSaleRows(((listSalesRes && !listSalesRes.error ? listSalesRes.data : []) || []) as Record<string, unknown>[]);
      const invoiceCount = invRows.reduce((sum, item) => sum + toNumber(item.invoices_count || item.invoice_count), 0);
      const salesTotal = invRows.reduce((sum, item) => sum + toNumber(item.net_total || item.net_sales || item.sales_total), 0);
      setInvoiceStats({ count: invoiceCount, total: salesTotal });

      const reviewToOpen = searchParams.get("review");
      if (reviewToOpen) {
        const found = reviewRows.find((row) => row.id === reviewToOpen);
        if (found) setSelectedReview(found);
      }
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [id, searchParams, cycle.end, cycle.start]);

  const cyclePointsRows = useMemo(() => {
    if (!staff) return [];
    return pointsRows.filter((row) => (
      isApprovedPointRecord(row) &&
      isRecordInCycle(row, cycle) &&
      recordBelongsToStaff(row, staff)
    ));
  }, [cycle, pointsRows, staff]);

  const cycleReviews = useMemo(() => {
    return reviews.filter((row) => {
      if (row.month_cycle) return row.month_cycle === activeMonthCycle;
      const date = row.conversation_date || row.reviewed_at || row.created_at;
      return date ? isDateInCycle(new Date(date), cycle) : false;
    });
  }, [activeMonthCycle, cycle, reviews]);

  const grouped = useMemo(() => {
    if (!staff || !incentiveData) return { bonuses: [] as PointRecord[], deductions: [] as PointRecord[], bonusPts: 0, deductionPts: 0 };
    const bonuses = incentiveData.rewardTransactions as PointRecord[];
    const deductions = incentiveData.deductionTransactions as PointRecord[];
    return {
      bonuses,
      deductions,
      bonusPts: incentiveData.approvedRewardPoints,
      deductionPts: incentiveData.approvedDeductionPoints,
    };
  }, [incentiveData, staff]);

  const reviewStats = useMemo(() => {
    const count = cycleReviews.length;
    const avg = count ? Math.round(cycleReviews.reduce((s, r) => s + toNumber(r.final_score), 0) / count) : 0;
    const excellent = cycleReviews.filter((r) => toNumber(r.final_score) >= 90).length;
    const weak = cycleReviews.filter((r) => toNumber(r.final_score) < 70).length;
    const forgotten = cycleReviews.filter((r) => r.forgotten_customer).length;
    const missedSales = cycleReviews.filter((r) => r.missed_sales_opportunity || r.missed_sale_opportunity).length;
    const crossSell = cycleReviews.filter((r) => r.successful_cross_sell).length;
    const handledComplaints = cycleReviews.filter((r) => r.handled_angry_customer_well).length;
    const impact = cycleReviews.reduce((s, r) => s + toNumber(r.doctor_points_impact), 0);
    const positives = cycleReviews.map((r) => r.main_positive_reason || r.top_positive_reason).filter(Boolean) as string[];
    const negatives = cycleReviews.map((r) => r.main_negative_reason || r.top_deduction_reason).filter(Boolean) as string[];
    const training = cycleReviews.map((r) => r.training_recommendation).filter(Boolean) as string[];
    return {
      count,
      avg,
      excellent,
      weak,
      forgotten,
      missedSales,
      crossSell,
      handledComplaints,
      impact,
      topPositive: positives[0] || "لا يوجد نمط واضح بعد",
      topNegative: negatives[0] || "لا يوجد نمط واضح بعد",
      training: training[0] || "استمرار متابعة جودة الترحيب وسرعة الرد وإغلاق الطلبات.",
    };
  }, [cycleReviews]);

  const performance2027 = useMemo(() => {
    if (!staff) return null;
    return computeStaffPerformance2027({
      staff: staff as unknown as Record<string, unknown>,
      invoices: salesRows,
      transactions: pointsRows as unknown as Record<string, unknown>[],
      followups: followupRows,
      listSales: listSaleRows,
      stagnantDispenses: stagnantDispenseRows,
    });
  }, [staff, salesRows, pointsRows, followupRows, listSaleRows, stagnantDispenseRows]);

  const assignedMedicineStats = useMemo(() => {
    const incentivePotential = assignedIncentives.reduce((sum, item) => sum + incentiveUnitValue(item) * toNumber(item.current_quantity), 0);
    const incentiveEarned = assignedIncentives.reduce((sum, item) => sum + incentiveUnitValue(item) * toNumber(item.sold_quantity), 0);
    const stagnantRemaining = assignedStagnants.reduce((sum, item) => sum + toNumber(item.remaining_quantity), 0);
    const stagnantDispensed = assignedStagnants.reduce((sum, item) => sum + toNumber(item.dispensed_quantity), 0);
    return { incentivePotential, incentiveEarned, stagnantRemaining, stagnantDispensed };
  }, [assignedIncentives, assignedStagnants]);

  const openPointDetails = async (row: PointRecord) => {
    const source = row.source_type || row.source;
    if ((source === "conversation_evaluation" || source === "conversation_review" || source === "conversation_sales_reviews") && row.source_id) {
      const local = reviews.find((review) => review.id === row.source_id);
      if (local) {
        setSelectedReview(local);
        return;
      }
      const { data } = await supabase.from("conversation_sales_reviews").select("*").eq("id", row.source_id).maybeSingle();
      if (data) setSelectedReview(data as ReviewRow);
    }
  };

  if (!isSupabaseConfigured) {
    return <div className="stat-card text-slate-400 text-center py-16 text-sm">فعّل Supabase لعرض ملف الموظف.</div>;
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-400">
        <Loader2 className="animate-spin text-teal-400" />
        جاري تحميل ملف الموظف...
      </div>
    );
  }

  if (!staff) {
    return (
      <div className="stat-card text-center py-16 space-y-4">
        <div className="text-slate-400">لم يتم العثور على الموظف.</div>
        <Link to="/team" className="btn-secondary inline-flex items-center gap-2">
          <ArrowRight size={14} /> العودة للفريق
        </Link>
      </div>
    );
  }

  const staffIncentive = incentiveData || { finalPoints: 500, incentiveValue: 1500, approvedRewardPoints: 0, approvedDeductionPoints: 0, pendingRewardPoints: 0, pendingDeductionPoints: 0, rewardTransactions: [], deductionTransactions: [], pendingTransactions: [], excludedTransactions: [], sourceBreakdown: [], warnings: [] };
  const pts = staffIncentive.finalPoints;
  const max = canonicalMaxPoints(staff);

  return (
    <div className="space-y-5 max-w-6xl">
      <div className="flex items-center gap-3">
        <Link to="/team" className="text-slate-400 hover:text-teal-400 text-sm">الفريق</Link>
        <span className="text-slate-600">/</span>
        <span className="text-white font-bold">{staff.name}</span>
      </div>

      <div className="stat-card border border-teal-500/20">
        <div className="flex flex-col md:flex-row md:items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-teal-500/15 flex items-center justify-center text-teal-400 text-2xl font-bold">{staff.name[0]}</div>
          <div className="flex-1">
            <div className="text-white font-bold text-xl">{staff.name}</div>
            <div className="text-slate-400 text-sm mt-1">{staff.role} - {staff.branch}</div>
            <div className="text-slate-500 text-xs mt-1">الدورة الحالية: {activeMonthCycle} من 26 إلى 25</div>
          </div>
          <div className="text-left">
            <div className={`text-3xl font-bold num ${pts >= 450 ? "text-teal-400" : pts >= 350 ? "text-amber-400" : "text-red-400"}`}>{pts}</div>
            <div className="text-slate-500 text-xs">/ {max} نقطة</div>
            <div className="text-slate-400 text-xs mt-2">{getPerformanceLevel(pts)}</div>
            <div className="text-teal-400 text-xs mt-1 num">حافز تقريبي {calculateIncentive(pts).toLocaleString("ar-EG")} ج</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MiniStat label="فواتير مسجلة" value={String(invoiceStats.count)} />
        <MiniStat label="إجمالي مبيعات" value={formatCurrency(invoiceStats.total)} />
        <MiniStat label="مكافآت الدورة" value={`+${grouped.bonusPts}`} />
        <MiniStat label="خصومات الدورة" value={`-${grouped.deductionPts}`} />
      </div>

      {performance2027 && <section className="stat-card space-y-4 border border-teal-500/20">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="section-title text-sm">ملف أداء 2027 المرتبط بالفواتير والعملاء</div>
            <div className="mt-1 text-xs text-slate-400">يقرأ المبيعات من staff_sales_summary مع متابعات ورواكد ولستة محدودة داخل دورة 26 إلى 25.</div>
          </div>
          <span className="badge-info">{performance2027.cycleLabel}</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <MiniStat label="عدد الفواتير" value={formatNumber(performance2027.invoiceCount)} />
          <MiniStat label="مبيعات الدورة" value={formatMoney(performance2027.totalSales)} />
          <MiniStat label="متوسط الفاتورة" value={formatMoney(performance2027.avgInvoice)} />
          <MiniStat label="عملاء مختلفون" value={formatNumber(performance2027.uniqueCustomers)} />
          <MiniStat label="متابعات مغلقة" value={`${performance2027.completedFollowups}/${performance2027.followupCount}`} />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-[#2d4063] p-4">
            <div className="text-white font-bold text-sm mb-3">أهم العملاء حسب قيمة مشترياتهم من الموظف</div>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {performance2027.topCustomers.map((item) => <div key={item.name} className="flex items-center justify-between rounded-xl bg-white/5 p-3 text-sm">
                <div><div className="font-bold text-white">{item.name}</div><div className="text-xs text-slate-500">{item.invoices} فاتورة · آخر شراء {formatDate(item.lastPurchase)}</div></div>
                <div className="text-left"><div className="font-bold text-teal-300">{formatMoney(item.sales)}</div><div className="text-xs text-slate-500">متوسط {formatMoney(item.avg)}</div></div>
              </div>)}
              {!performance2027.topCustomers.length && <div className="text-slate-500 text-sm">لا توجد فواتير مرتبطة باسم الموظف داخل الدورة. راجع اسم الدكتور في ملف الفواتير.</div>}
            </div>
          </div>
          <div className="rounded-xl border border-[#2d4063] p-4">
            <div className="text-white font-bold text-sm mb-3">أكبر الفواتير قيمة</div>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {performance2027.biggestInvoices.map((item) => <div key={`${item.invoiceNumber}-${item.amount}`} className="rounded-xl bg-white/5 p-3 text-sm">
                <div className="flex items-center justify-between"><div className="font-bold text-white">{item.customerName || "عميل غير محدد"}</div><div className="font-bold text-teal-300">{formatMoney(item.amount)}</div></div>
                <div className="mt-1 text-xs text-slate-500">فاتورة {item.invoiceNumber} · {formatDate(item.date)} · {item.branch}</div>
              </div>)}
              {!performance2027.biggestInvoices.length && <div className="text-slate-500 text-sm">لا توجد فواتير لعرضها.</div>}
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4">
          <div className="text-amber-200 font-bold text-sm mb-2">توصيات تنفيذية للمدير والموظف</div>
          <ul className="space-y-1 text-xs leading-6 text-amber-100/90">
            {[...performance2027.warnings, ...performanceRecommendation(performance2027)].slice(0, 6).map((line) => <li key={line}>• {line}</li>)}
            {performance2027.warnings.length === 0 && performanceRecommendation(performance2027).length === 0 && <li>• الأداء مستقر، استمر في تحسين متوسط الفاتورة والمتابعات.</li>}
          </ul>
        </div>
      </section>}

      <section className="stat-card space-y-4">
        <div className="section-title text-sm">ملف التشغيل والحضور</div>
        <div className="grid md:grid-cols-3 gap-3">
          <InfoCard label="عدد أيام الجدول المسجلة" value={`${scheduleRows.length} يوم`} />
          <InfoCard label="إجازات/استثناءات مسجلة" value={`${timeOffRows.length} سجل`} />
          <InfoCard label="آخر إذن أو إجازة" value={formatLatestTimeOff(timeOffRows)} />
        </div>
        <div className="grid lg:grid-cols-2 gap-4">
          <div className="rounded-xl border border-[#2d4063] p-4">
            <div className="text-white font-bold text-sm mb-3">مواعيد العمل المختصرة</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {scheduleRows.slice(0, 8).map((item, index) => (
                <div key={item.id || index} className="bg-white/5 rounded-xl p-3 text-xs">
                  <div className="text-slate-400">{item.day_name || item.weekday || item.day || `يوم ${index + 1}`}</div>
                  <div className="text-white font-bold mt-1">
                    {item.is_day_off || item.status === "off" ? "إجازة" : `${item.start_time || "-"} — ${item.end_time || "-"}`}
                  </div>
                </div>
              ))}
              {scheduleRows.length === 0 && <div className="text-slate-500 text-sm col-span-full">لا يوجد جدول محفوظ لهذا الموظف.</div>}
            </div>
          </div>
          <div className="rounded-xl border border-[#2d4063] p-4">
            <div className="text-white font-bold text-sm mb-3">آخر الإذونات والإجازات</div>
            <div className="space-y-2 max-h-44 overflow-y-auto">
              {timeOffRows.slice(0, 6).map((item, index) => (
                <div key={item.id || index} className="bg-white/5 rounded-xl p-3 text-xs">
                  <div className="text-white font-bold">{item.type || item.reason || "إذن/إجازة"}</div>
                  <div className="text-slate-400 mt-1">{formatDate(item.date || item.start_date)} {item.end_date ? `— ${formatDate(item.end_date)}` : ""}</div>
                  {(item.notes || item.status) && <div className="text-slate-500 mt-1">{item.notes || item.status}</div>}
                </div>
              ))}
              {timeOffRows.length === 0 && <div className="text-slate-500 text-sm">لا توجد إذونات أو إجازات مسجلة.</div>}
            </div>
          </div>
        </div>
      </section>

      <SalaryCalculator
        staffName={staff.name}
        role={staff.role}
        branch={staff.branch}
        cycleLabel={cycle.label}
        currentPoints={pts}
        maxPoints={max}
        rewardPoints={grouped.bonusPts}
        penaltyPoints={grouped.deductionPts}
        records={cyclePointsRows}
      />

      <section className="stat-card space-y-4">
        <div className="section-title text-sm">الأصناف المسندة للدكتور في الدورة</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MiniStat label="أصناف الحوافز" value={String(assignedIncentives.length)} />
          <MiniStat label="حوافز محققة" value={formatCurrency(assignedMedicineStats.incentiveEarned)} />
          <MiniStat label="أصناف الرواكد" value={String(assignedStagnants.length)} />
          <MiniStat label="رواكد متبقية" value={String(assignedMedicineStats.stagnantRemaining)} />
        </div>
        <div className="grid lg:grid-cols-2 gap-4">
          <AssignedTable
            title="أدوية الحوافز المطلوبة"
            emptyText="لا توجد أصناف حوافز مسندة لهذا الدكتور."
            rows={assignedIncentives.map((item) => ({
              id: item.id,
              name: item.product_name,
              meta: item.product_type || item.branch || "-",
              quantity: `${toNumber(item.sold_quantity)} / ${toNumber(item.current_quantity)}`,
              value: formatCurrency(incentiveUnitValue(item)),
              date: formatDate(item.expiry_date),
              href: "/incentive-medicines",
            }))}
          />
          <AssignedTable
            title="الأدوية الراكدة المطلوبة"
            emptyText="لا توجد أصناف راكدة مسندة لهذا الدكتور."
            rows={assignedStagnants.map((item) => ({
              id: item.id,
              name: item.product_name || item.medicine_name || "-",
              meta: item.category || item.branch_name || item.branch || "-",
              quantity: `${toNumber(item.dispensed_quantity)} / ${toNumber(item.total_quantity)}`,
              value: formatCurrency(toNumber(item.incentive_per_unit)),
              date: formatDate(item.nearest_expiry_date || item.expiry_date),
              href: `/stagnant-medicines?id=${item.id}`,
            }))}
          />
        </div>
      </section>

      <section className="stat-card space-y-4">
        <div className="section-title text-sm">تقييمات المحادثات داخل الدورة</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MiniStat label="عدد المحادثات" value={String(reviewStats.count)} />
          <MiniStat label="متوسط التقييم" value={`${reviewStats.avg}/100`} />
          <MiniStat label="محادثات ممتازة" value={String(reviewStats.excellent)} />
          <MiniStat label="محادثات ضعيفة" value={String(reviewStats.weak)} />
          <MiniStat label="نسيان عميل" value={String(reviewStats.forgotten)} />
          <MiniStat label="فرص بيع ضائعة" value={String(reviewStats.missedSales)} />
          <MiniStat label="Cross-selling ناجح" value={String(reviewStats.crossSell)} />
          <MiniStat label="أثر النقاط" value={String(reviewStats.impact)} />
        </div>
        <div className="grid md:grid-cols-3 gap-3">
          <InfoCard label="أهم نقطة قوة" value={reviewStats.topPositive} />
          <InfoCard label="أهم نقطة تحتاج تطوير" value={reviewStats.topNegative} />
          <InfoCard label="توصية تدريب الشهر" value={reviewStats.training} />
        </div>
        <div className="overflow-x-auto rounded-xl border border-[#2d4063]">
          <table className="w-full min-w-[840px] text-sm">
            <thead className="bg-[#16253f] text-slate-300">
              <tr>
                <th className="p-3 text-right">التاريخ</th>
                <th className="p-3 text-right">العميل</th>
                <th className="p-3 text-right">الفاتورة</th>
                <th className="p-3 text-right">النوع</th>
                <th className="p-3 text-right">التقييم</th>
                <th className="p-3 text-right">النقاط</th>
                <th className="p-3 text-right">السبب</th>
                <th className="p-3 text-right">المراجع</th>
                <th className="p-3 text-right">تفاصيل</th>
              </tr>
            </thead>
            <tbody>
              {cycleReviews.map((review) => (
                <tr key={review.id} className="border-t border-[#2d4063]/70">
                  <td className="p-3 text-slate-300">{formatDate(review.conversation_date || review.reviewed_at || review.created_at)}</td>
                  <td className="p-3 text-white">{review.customer_name || "غير محدد"}</td>
                  <td className="p-3 text-slate-300">{review.invoice_number || "-"}</td>
                  <td className="p-3 text-slate-300">{review.conversation_type || review.evaluation_kind || "-"}</td>
                  <td className="p-3 font-bold num">{toNumber(review.final_score)}/100</td>
                  <td className={`p-3 font-bold num ${toNumber(review.doctor_points_impact) >= 0 ? "text-teal-400" : "text-red-400"}`}>
                    {toNumber(review.doctor_points_impact) > 0 ? "+" : ""}{toNumber(review.doctor_points_impact)}
                  </td>
                  <td className="p-3 text-slate-300">{review.main_negative_reason || review.top_deduction_reason || review.main_positive_reason || "-"}</td>
                  <td className="p-3 text-slate-300">{review.reviewer_name || "-"}</td>
                  <td className="p-3">
                    <button className="btn-secondary py-1 px-2 text-xs" onClick={() => setSelectedReview(review)}>
                      <Eye size={14} /> عرض
                    </button>
                  </td>
                </tr>
              ))}
              {cycleReviews.length === 0 && (
                <tr>
                  <td colSpan={9} className="p-6 text-center text-slate-500">لا توجد تقييمات محادثات في هذه الدورة.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid md:grid-cols-2 gap-4">
        <RecordsBox title="المكافآت الأخيرة" rows={grouped.bonuses.slice(0, 10)} sign="+" tone="teal" onOpen={openPointDetails} />
        <RecordsBox title="الخصومات الأخيرة" rows={grouped.deductions.slice(0, 10)} sign="-" tone="red" onOpen={openPointDetails} />
      </div>

      <div className="stat-card bg-teal-500/5 border border-teal-500/15">
        <div className="section-title text-sm mb-2">توصيات تحسين</div>
        <p className="text-slate-300 text-sm leading-relaxed">
          راجع تقييمات المحادثات القابلة للفتح، وركز على البنود المتكررة داخل الدورة. أي تقييم مرتبط بسجل نقاط يمكن فتحه لمعرفة العميل والبنود والسبب والتوصية التدريبية.
        </p>
      </div>

      {selectedReview && <ReviewDetailsModal review={selectedReview} onClose={() => setSelectedReview(null)} />}
    </div>
  );
}

function RecordsBox({ title, rows, sign, tone, onOpen }: { title: string; rows: PointRecord[]; sign: "+" | "-"; tone: "teal" | "red"; onOpen: (row: PointRecord) => void }) {
  return (
    <div className="stat-card">
      <div className="section-title text-sm mb-3">{title}</div>
      <ul className="space-y-2 text-sm">
        {rows.map((r) => {
          const source = r.source_type || r.source;
          const isReview = source === "conversation_evaluation" || source === "conversation_review" || source === "conversation_sales_reviews";
          const points = Math.abs(toNumber(r.points_delta) || toNumber(r.points));
          return (
            <li key={r.id} className="flex justify-between gap-2 border-b border-[#2d4063]/50 pb-2">
              <button
                type="button"
                onClick={() => isReview && onOpen(r)}
                className={`text-right truncate ${isReview ? "text-teal-300 hover:text-teal-200 underline underline-offset-4" : "text-slate-300"}`}
                disabled={!isReview}
              >
                {getTransactionShortReason(r)}
              </button>
              <span className={`${tone === "teal" ? "text-teal-400" : "text-red-400"} font-bold num`}>
                {sign}{points}
              </span>
            </li>
          );
        })}
        {rows.length === 0 && <li className="text-slate-500 text-xs">لا توجد سجلات في هذه الدورة.</li>}
      </ul>
    </div>
  );
}

function AssignedTable({
  title,
  emptyText,
  rows,
}: {
  title: string;
  emptyText: string;
  rows: Array<{ id: string; name: string; meta: string; quantity: string; value: string; date: string; href: string }>;
}) {
  return (
    <div className="rounded-xl border border-[#2d4063] overflow-hidden">
      <div className="bg-[#16253f] px-4 py-3 text-white font-bold text-sm">{title}</div>
      <div className="divide-y divide-[#2d4063]/70">
        {rows.map((row) => (
          <Link key={row.id} to={row.href} className="grid grid-cols-5 gap-2 p-3 text-sm hover:bg-white/5 transition-colors">
            <div className="col-span-2">
              <div className="text-white font-bold">{row.name}</div>
              <div className="text-slate-500 text-xs mt-1">{row.meta}</div>
            </div>
            <div className="text-slate-300 num">{row.quantity}</div>
            <div className="text-teal-300 num">{row.value}</div>
            <div className="text-slate-400 text-xs">{row.date}</div>
          </Link>
        ))}
        {rows.length === 0 && <div className="p-4 text-slate-500 text-sm">{emptyText}</div>}
      </div>
    </div>
  );
}

function ReviewDetailsModal({ review, onClose }: { review: ReviewRow; onClose: () => void }) {
  const items = (Array.isArray(review.review_items) && review.review_items.length ? review.review_items : review.raw_scores?.result?.reviewItems || []) as ReviewItemSummary[];
  const impact = toNumber(review.doctor_points_impact);
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="w-full max-w-5xl max-h-[90vh] overflow-y-auto rounded-2xl bg-[#1B2B4B] border border-[#2d4063] shadow-2xl">
        <div className="sticky top-0 bg-[#1B2B4B] border-b border-[#2d4063] p-4 flex items-center gap-3">
          <div className="flex-1">
            <div className="text-white font-bold text-lg">تفاصيل تقييم المحادثة</div>
            <div className="text-slate-400 text-xs mt-1">قراءة فقط - نفس الملخص المحفوظ مع سجل النقاط</div>
          </div>
          <button className="btn-secondary px-3" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid md:grid-cols-3 gap-3">
            <InfoCard label="الدكتور" value={review.staff_name || "-"} />
            <InfoCard label="العميل" value={review.customer_name || "-"} />
            <InfoCard label="الفرع" value={review.branch || "-"} />
            <InfoCard label="الفاتورة" value={review.invoice_number || "-"} />
            <InfoCard label="المراجع" value={review.reviewer_name || "-"} />
            <InfoCard label="التاريخ" value={formatDate(review.conversation_date || review.reviewed_at || review.created_at)} />
          </div>
          <div className="grid md:grid-cols-4 gap-3">
            <MiniStat label="تقييم المحادثة" value={`${toNumber(review.final_score)}/100`} />
            <MiniStat label="التأثير الأساسي" value={`${toNumber(review.base_points_impact)}`} />
            <MiniStat label="خصومات إضافية" value={`${toNumber(review.extra_penalty_points)}`} />
            <MiniStat label="إجمالي تأثير النقاط" value={`${impact > 0 ? "+" : ""}${impact}`} />
          </div>
          <div className="rounded-xl bg-[#16253f] border border-[#2d4063] p-4 text-sm text-slate-300 leading-relaxed space-y-2">
            <div><span className="text-slate-400">سبب الخصم أو المكافأة:</span> {review.main_negative_reason || review.top_deduction_reason || review.main_positive_reason || review.top_positive_reason || "-"}</div>
            <div><span className="text-slate-400">التوصية التدريبية:</span> {review.training_recommendation || "-"}</div>
            <div><span className="text-slate-400">ملاحظات المراجع:</span> {review.reviewer_notes || "-"}</div>
            <div className="flex gap-2 flex-wrap">
              {review.has_medical_error && <span className="badge-danger text-xs">خطأ طبي</span>}
              {review.has_invoice_error && <span className="badge-danger text-xs">خطأ فاتورة</span>}
              {review.has_delivery_issue && <span className="badge-danger text-xs">خطأ دليفري</span>}
              {review.forgotten_customer && <span className="badge-danger text-xs">نسيان عميل</span>}
              {(review.missed_sales_opportunity || review.missed_sale_opportunity) && <span className="badge-warning text-xs">فرصة بيع ضائعة</span>}
              {review.successful_cross_sell && <span className="badge-success text-xs">Cross-selling ناجح</span>}
              {review.handled_angry_customer_well && <span className="badge-success text-xs">تعامل جيد مع شكوى</span>}
              {review.excellent_case && <span className="badge-success text-xs">حالة ممتازة</span>}
            </div>
          </div>
          <div className="overflow-x-auto rounded-xl border border-[#2d4063]">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-[#16253f] text-slate-300">
                <tr>
                  <th className="p-3 text-right">البند</th>
                  <th className="p-3 text-right">ينطبق؟</th>
                  <th className="p-3 text-right">الاختيار</th>
                  <th className="p-3 text-right">النقاط</th>
                  <th className="p-3 text-right">ملاحظة</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.key} className="border-t border-[#2d4063]/70">
                    <td className="p-3 text-white">{item.label}</td>
                    <td className="p-3">{item.applies ? "نعم" : "لا ينطبق"}</td>
                    <td className="p-3 text-slate-300">{item.applies ? item.selectedOption : "-"}</td>
                    <td className="p-3 text-slate-300 num">{item.applies ? `${item.pointsEarned}/${item.maxPoints}` : "-"}</td>
                    <td className="p-3 text-slate-400">{item.notes || "-"}</td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr>
                    <td className="p-6 text-center text-slate-500" colSpan={5}>لا توجد تفاصيل بنود محفوظة لهذا التقييم.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function incentiveUnitValue(item: Pick<AssignedIncentiveMedicine, "incentive_type" | "incentive_value" | "incentive_percent" | "product_price">) {
  if (item.incentive_type === "percent") {
    return (toNumber(item.product_price) * toNumber(item.incentive_percent)) / 100;
  }
  return toNumber(item.incentive_value);
}

function formatLatestTimeOff(rows: TimeOffRow[]) {
  const latest = rows[0];
  if (!latest) return "لا يوجد";
  return `${latest.type || latest.reason || "إجازة/إذن"} — ${formatDate(latest.date || latest.start_date)}`;
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-card py-3">
      <div className="text-slate-400 text-xs">{label}</div>
      <div className="text-white font-bold text-sm mt-1">{value}</div>
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-[#16253f] border border-[#2d4063] p-3">
      <div className="text-slate-400 text-xs">{label}</div>
      <div className="text-white font-bold text-sm mt-1 leading-relaxed">{value}</div>
    </div>
  );
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("ar-EG", { year: "numeric", month: "short", day: "numeric" });
}
