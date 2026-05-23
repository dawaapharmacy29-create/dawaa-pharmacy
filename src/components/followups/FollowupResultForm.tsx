import { useMemo, useState } from "react";
import { CheckCircle, Loader2 } from "lucide-react";
import { FOLLOWUP_REACTIONS, nextFollowupDays, reactionScore, type CustomerReaction } from "@/lib/followups";
import { SCRIPT_OPTIONS, type ScriptKey } from "@/lib/followupScripts";
import { updateFollowupStatus } from "@/lib/api/followups";
import { toast } from "sonner";
import type { DailyFollowup } from "@/types/database";

interface FollowupResultFormProps {
  followup: DailyFollowup;
  defaultScript?: ScriptKey;
  onSaved?: (followup: DailyFollowup) => void;
}

const channels = ["واتساب", "مكالمة", "داخل الفرع"] as const;

export default function FollowupResultForm({ followup, defaultScript = "medium", onSaved }: FollowupResultFormProps) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    channel: "واتساب",
    scriptUsed: defaultScript,
    summary: "",
    reaction: "interested" as CustomerReaction,
    orderCreated: false,
    orderValue: "",
    needsFollowup: false,
    nextFollowupDate: "",
    hasComplaint: false,
    updatedCustomerData: false,
    notes: "",
  });

  const score = reactionScore(form.reaction);
  const suggestedNextDate = useMemo(() => {
    const days = nextFollowupDays(form.reaction);
    if (!days) return "";
    const date = new Date(Date.now() + days * 86400000);
    return date.toISOString().slice(0, 10);
  }, [form.reaction]);

  const save = async () => {
    if (!form.summary.trim()) {
      toast.error("اكتب ملخص ما حدث في المتابعة");
      return;
    }

    setSaving(true);
    try {
      const nextDate = form.needsFollowup ? (form.nextFollowupDate || suggestedNextDate) : "";
      const report = [
        followup.notes || "",
        "----- نتيجة المتابعة -----",
        `قناة التواصل: ${form.channel}`,
        `السكريبت المستخدم: ${SCRIPT_OPTIONS.find((item) => item.value === form.scriptUsed)?.label || form.scriptUsed}`,
        `ملخص ما حدث: ${form.summary}`,
        `رد فعل العميل: ${FOLLOWUP_REACTIONS.find((item) => item.value === form.reaction)?.label || form.reaction}`,
        `reaction_score: ${score}`,
        `تم إنشاء أوردر: ${form.orderCreated ? "نعم" : "لا"}`,
        `قيمة الأوردر: ${Number(form.orderValue || 0)}`,
        `يحتاج متابعة أخرى: ${form.needsFollowup ? "نعم" : "لا"}`,
        `المتابعة القادمة: ${nextDate || "لا يوجد"}`,
        `توجد شكوى: ${form.hasComplaint ? "نعم" : "لا"}`,
        `تم تحديث بيانات العميل: ${form.updatedCustomerData ? "نعم" : "لا"}`,
        `ملاحظات: ${form.notes || "لا توجد"}`,
      ].filter(Boolean).join("\n");

      const status = form.orderCreated ? "طلب أوردر" : form.reaction === "no_answer" ? "لم يرد" : "تم التواصل";
      const updated = await updateFollowupStatus(followup.id, {
        status,
        notes: report,
        contact_method: form.channel,
        followup_summary: form.summary,
        followup_result: FOLLOWUP_REACTIONS.find((item) => item.value === form.reaction)?.label || form.reaction,
        next_followup_date: nextDate || null,
        request_type: form.orderCreated ? "customer_order" : null,
        request_details: form.orderCreated ? `أوردر من المتابعة بقيمة ${Number(form.orderValue || 0)} ج.م` : null,
        request_status: form.orderCreated ? "open" : null,
        purchase_after_followup: Boolean(form.orderCreated),
        purchase_amount: Number(form.orderValue || 0),
        closed_at: status === "تم التواصل" || status === "طلب أوردر" ? new Date().toISOString() : null,
      });
      toast.success("تم حفظ نتيجة المتابعة");
      onSaved?.(updated);
    } catch (error) {
      toast.error(`تعذر حفظ المتابعة: ${(error as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-[#1B2B4B] border border-[#2d4063] rounded-2xl p-5">
      <div className="section-title mb-3">تسجيل نتيجة المتابعة</div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="text-slate-300 text-sm">
          قناة التواصل
          <select value={form.channel} onChange={(event) => setForm((f) => ({ ...f, channel: event.target.value }))} className="input-dark mt-1">
            {channels.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label className="text-slate-300 text-sm">
          السكريبت المستخدم
          <select value={form.scriptUsed} onChange={(event) => setForm((f) => ({ ...f, scriptUsed: event.target.value as ScriptKey }))} className="input-dark mt-1">
            {SCRIPT_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label className="text-slate-300 text-sm md:col-span-2">
          ملخص ما حدث
          <textarea value={form.summary} onChange={(event) => setForm((f) => ({ ...f, summary: event.target.value }))} rows={3} className="input-dark mt-1 resize-none" />
        </label>
        <label className="text-slate-300 text-sm">
          رد فعل العميل
          <select value={form.reaction} onChange={(event) => setForm((f) => ({ ...f, reaction: event.target.value as CustomerReaction }))} className="input-dark mt-1">
            {FOLLOWUP_REACTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <div className="bg-white/5 rounded-xl p-3">
          <div className="text-slate-400 text-xs">reaction_score</div>
          <div className="text-white font-bold text-xl num">{score}/5</div>
        </div>
        <label className="text-slate-300 text-sm">
          قيمة الأوردر
          <input value={form.orderValue} onChange={(event) => setForm((f) => ({ ...f, orderValue: event.target.value }))} className="input-dark mt-1" inputMode="decimal" />
        </label>
        <label className="text-slate-300 text-sm">
          تاريخ المتابعة القادمة
          <input type="date" value={form.nextFollowupDate || suggestedNextDate} onChange={(event) => setForm((f) => ({ ...f, nextFollowupDate: event.target.value, needsFollowup: true }))} className="input-dark mt-1" />
        </label>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-4">
        {[
          ["orderCreated", "هل تم إنشاء أوردر؟"],
          ["needsFollowup", "هل يحتاج متابعة أخرى؟"],
          ["hasComplaint", "هل توجد شكوى؟"],
          ["updatedCustomerData", "هل تم تحديث بيانات العميل؟"],
        ].map(([key, label]) => (
          <label key={key} className="flex items-center gap-2 text-slate-300 text-sm bg-white/5 rounded-xl p-3">
            <input type="checkbox" checked={Boolean(form[key as keyof typeof form])} onChange={(event) => setForm((f) => ({ ...f, [key]: event.target.checked }))} />
            {label}
          </label>
        ))}
      </div>
      <textarea value={form.notes} onChange={(event) => setForm((f) => ({ ...f, notes: event.target.value }))} rows={2} className="input-dark mt-3 resize-none" placeholder="ملاحظات إضافية" />
      <button onClick={save} disabled={saving} className="btn-primary w-full mt-3 flex items-center justify-center gap-2">
        {saving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
        حفظ نتيجة المتابعة
      </button>
    </div>
  );
}
