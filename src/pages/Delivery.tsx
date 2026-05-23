import { useMemo, useState } from "react";
import { Star, Truck, AlertTriangle } from "lucide-react";
import { useSupabaseQuery } from "@/hooks/useSupabaseQuery";
import { supabase } from "@/lib/supabase";
import { formatCurrency } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { calculateIncentive } from "@/lib/points";
import { INITIAL_POINTS } from "@/lib/constants";
import { isDeliveryInvoice } from "@/lib/analyticsFromInvoices";
import { logActivity } from "@/hooks/useSupabaseQuery";
import { getCurrentCycle } from "@/lib/pharmacy-cycle";
import { effectiveCyclePoints, pointRecordDelta } from "@/lib/pointsLedger";
import { TABLES } from "@/lib/supabaseTables";

interface SalesInv {
  id: string;
  amount: number | null;
  invoice_type: string | null;
  delivery_staff: string | null;
  branch: string | null;
}

interface StaffDel {
  id: string;
  name: string;
  branch: string;
  role: string;
  points: number | null;
  max_points: number | null;
}

interface PointRecord {
  id?: string;
  staff_id?: string | null;
  employee_id?: string | null;
  employee_name?: string | null;
  type: string;
  points: number;
  points_delta?: number | null;
  manager_note: string | null;
  status?: string | null;
  month_cycle?: string | null;
  created_at?: string | null;
}

const ISSUES = ["تأخير", "أسلوب غير لائق", "خطأ عنوان", "خطأ تحصيل", "عدم تحديث حالة الطلب", "تسليم غير صحيح", "شكوى عميل"] as const;
const SEVERITIES = ["بسيطة", "متوسطة", "كبيرة", "حرجة"] as const;

export default function Delivery() {
  const { user, canManage } = useAuth();
  const canCreateDelivery = canManage || user?.permissions?.create_delivery_evaluation === true;
  const canEditDelivery = canManage || user?.permissions?.edit_delivery_evaluation === true;
  const canApproveDelivery = canManage || user?.permissions?.approve_delivery_deduction === true;
  const cycle = getCurrentCycle();
  const [evalStaffId, setEvalStaffId] = useState("");
  const [issueType, setIssueType] = useState<(typeof ISSUES)[number]>("تأخير");
  const [severity, setSeverity] = useState<(typeof SEVERITIES)[number]>("متوسطة");
  const [pointsSuggest, setPointsSuggest] = useState("15");
  const [notes, setNotes] = useState("");
  const [evalDate, setEvalDate] = useState(() => new Date().toISOString().slice(0, 10));

  const { data: invoices, loading: invLoading } = useSupabaseQuery<SalesInv>({
    table: "sales_invoices",
    orderBy: { column: "invoice_date", ascending: false },
    limit: 6000,
    realtimeEnabled: false,
  });

  const { data: staff } = useSupabaseQuery<StaffDel>({ table: "staff", realtimeEnabled: false });
  const { data: pointRows } = useSupabaseQuery<PointRecord>({ table: TABLES.employeeTransactions, limit: 800, realtimeEnabled: false });

  const deliveryStaffList = useMemo(() => staff.filter((s) => s.role === "توصيل"), [staff]);

  const statsByDeliverer = useMemo(() => {
    const map = new Map<string, { count: number; total: number; branch: string }>();
    for (const inv of invoices) {
      if (!isDeliveryInvoice(inv.invoice_type)) continue;
      const name = String(inv.delivery_staff || "").trim();
      if (!name) continue;
      const cur = map.get(name) || { count: 0, total: 0, branch: inv.branch || "" };
      cur.count += 1;
      cur.total += Number(inv.amount) || 0;
      if (!cur.branch && inv.branch) cur.branch = inv.branch;
      map.set(name, cur);
    }
    return [...map.entries()].sort((a, b) => b[1].count - a[1].count);
  }, [invoices]);

  const enriched = useMemo(() => {
    return statsByDeliverer.map(([name, st]) => {
      const profile = deliveryStaffList.find((s) => name.includes(s.name) || s.name.includes(name));
      const pts = profile ? effectiveCyclePoints(profile, pointRows, cycle) : INITIAL_POINTS;
      const relatedPoints = pointRows.filter((p) => p.staff_id === profile?.id || p.employee_id === profile?.id || p.employee_name === profile?.name || String(p.employee_name || "").includes(name));
      const deductions = relatedPoints.filter((p) => pointRecordDelta(p) < 0).length;
      const bonuses = relatedPoints.filter((p) => pointRecordDelta(p) > 0).length;
      const avgRating = 0;
      return {
        name,
        branch: profile?.branch || st.branch || "—",
        profile,
        invoices: st.count,
        sales: st.total,
        points: pts,
        deductions,
        bonuses,
        avgRating,
        problems: deductions,
      };
    });
  }, [cycle, statsByDeliverer, deliveryStaffList, pointRows]);

  const submitEval = async () => {
    const profile = deliveryStaffList.find((s) => s.id === evalStaffId);
    if (!profile) {
      toast.error("اختر الدليفري");
      return;
    }
    const payload = {
      delivery_staff_name: profile.name,
      branch: profile.branch,
      eval_date: evalDate,
      issue_type: issueType,
      severity,
      suggested_points: Number(pointsSuggest) || 0,
      notes,
      recorded_by_name: user?.name || "",
      recorded_by_role: user?.role || "",
      status: canApproveDelivery ? "approved" : "pending",
    };

    const { error } = await supabase.from("delivery_evaluations").insert(payload as Record<string, unknown>);
    let missingTable = false;
    if (error) {
      if (error.message.toLowerCase().includes("does not exist")) missingTable = true;
      else {
        toast.error(error.message);
        return;
      }
    }
    await logActivity(user?.id || "", user?.name || "", "تقييم دليفري", "التوصيل", `${profile.name} — ${issueType}`, profile.branch || "", { user_role: user?.role });
    toast.success(missingTable ? "أنشئ جدول delivery_evaluations من ملف الهجرة المقترح لتخزين التقييمات في قاعدة البيانات." : "تم حفظ تقييم الدليفري");
    setNotes("");
  };

  if (invLoading) return <div className="space-y-4">{[1, 2, 3].map((i) => <div key={i} className="stat-card h-28 animate-pulse bg-white/5" />)}</div>;

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="w-11 h-11 rounded-xl bg-teal-500/15 flex items-center justify-center text-teal-400">
          <Truck size={22} />
        </div>
        <div>
          <div className="section-title">تقييم الدليفري والتوصيل</div>
          <div className="text-slate-400 text-sm max-w-xl">
            لا يُطلب تسجيل كل طلب يدويًا. عدد فواتير التوصيل وقيمتها يُحسبان من ملفات المبيعات اليومية (sales_invoices). استخدم النموذج لتسجيل المشاكل أو المكافآت الإدارية.
          </div>
        </div>
      </div>

      {enriched.length === 0 && (
        <div className="stat-card flex gap-3 border border-amber-500/20 text-amber-100 text-sm">
          <AlertTriangle className="flex-shrink-0" />
          لا توجد فواتير توصيل في البيانات بعد. استورد ملف مبيعات يومية يحتوي عمود نوع الفاتورة (توصيل) ومندوب التوصيل.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {enriched.map((row) => (
          <div key={row.name} className="stat-card card-glow border border-[#2d4063]">
            <div className="flex justify-between gap-3 mb-3">
              <div>
                <div className="text-white font-bold">{row.profile?.name || row.name}</div>
                <div className="text-slate-400 text-xs mt-1">{row.branch}</div>
              </div>
              <div className="text-left">
                <div className="text-teal-400 font-bold num">{row.points}</div>
                <div className="text-slate-500 text-[10px]">نقاط حالية</div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-white/5 rounded-lg p-2">
                <div className="text-slate-400">فواتير توصيل</div>
                <div className="text-white font-bold num">{row.invoices}</div>
              </div>
              <div className="bg-white/5 rounded-lg p-2">
                <div className="text-slate-400">إجمالي القيمة</div>
                <div className="text-white font-bold num">{formatCurrency(row.sales)}</div>
              </div>
              <div className="bg-white/5 rounded-lg p-2">
                <div className="text-slate-400">خصومات / مكافآت</div>
                <div className="text-slate-200">
                  -{row.deductions} / +{row.bonuses}
                </div>
              </div>
              <div className="bg-white/5 rounded-lg p-2">
                <div className="text-slate-400">حافز متوقع</div>
                <div className="text-teal-300 font-bold num">{formatCurrency(calculateIncentive(row.points))}</div>
              </div>
            </div>
            <div className="mt-3 text-[11px] text-slate-500 flex items-center gap-1">
              <Star size={12} className="text-amber-400" /> متوسط تقييم العملاء غير متوفر بعد في البيانات — يمكن ربطه لاحقًا بتقييمات الواتساب.
            </div>
          </div>
        ))}
      </div>

      <div className="stat-card border border-teal-500/15">
        <div className="section-title mb-4">نموذج تقييم أو مشكلة دليفري</div>
        <div className="grid md:grid-cols-2 gap-3">
          <select value={evalStaffId} onChange={(e) => setEvalStaffId(e.target.value)} className="input-dark">
            <option value="">اختر الدليفري</option>
            {deliveryStaffList.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} — {s.branch}
              </option>
            ))}
          </select>
          <input type="date" value={evalDate} onChange={(e) => setEvalDate(e.target.value)} className="input-dark" />
          <select value={issueType} onChange={(e) => setIssueType(e.target.value as (typeof ISSUES)[number])} className="input-dark">
            {ISSUES.map((i) => (
              <option key={i}>{i}</option>
            ))}
          </select>
          <select value={severity} onChange={(e) => setSeverity(e.target.value as (typeof SEVERITIES)[number])} className="input-dark">
            {SEVERITIES.map((i) => (
              <option key={i}>{i}</option>
            ))}
          </select>
          <input type="number" value={pointsSuggest} onChange={(e) => setPointsSuggest(e.target.value)} className="input-dark" placeholder="النقاط المقترحة" />
        </div>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="input-dark resize-none mt-3" rows={3} placeholder="ملاحظات وتفاصيل" />
        <button type="button" onClick={submitEval} className="btn-primary mt-4">
          حفظ التقييم
        </button>
      </div>
    </div>
  );
}
