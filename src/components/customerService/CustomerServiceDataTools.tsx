import { useState } from 'react';
import { Download, FileSpreadsheet, Info, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { exportToExcel } from '@/lib/exportExcel';

const BATCH_SIZE = 1000;

function safeText(value: unknown) {
  return value == null ? '' : String(value).trim();
}

function dateOnly(value: unknown) {
  const text = safeText(value);
  return text ? text.slice(0, 10) : '';
}

export default function CustomerServiceDataTools() {
  const [exporting, setExporting] = useState(false);

  async function exportFullLog() {
    setExporting(true);
    try {
      const allRows: Record<string, unknown>[] = [];
      for (let from = 0; ; from += BATCH_SIZE) {
        const { data, error } = await supabase
          .from('customer_followup_operations_v2')
          .select('*')
          .order('created_at', { ascending: false })
          .range(from, from + BATCH_SIZE - 1);
        if (error) throw new Error(error.message);
        const batch = (data || []) as Record<string, unknown>[];
        allRows.push(...batch);
        if (batch.length < BATCH_SIZE) break;
      }

      if (!allRows.length) {
        toast.error('لا توجد متابعات متاحة للتصدير');
        return;
      }

      const rows = allRows.map((row) => ({
        'رقم المتابعة': safeText(row.id),
        'اسم العميل': safeText(row.display_customer_name || row.customer_name || row.name),
        'كود العميل': safeText(row.customer_code),
        الهاتف: safeText(row.display_phone || row.customer_phone || row.phone),
        الفرع: safeText(row.branch),
        'الحالة التشغيلية': safeText(row.operational_status),
        'موعد الاستحقاق': safeText(row.due_bucket),
        'سبب المتابعة': safeText(row.followup_reason || row.request_details),
        'ملاحظات المتابعة': safeText(row.followup_notes),
        'الدكتور مقدم الطلب': safeText(row.requested_by_doctor || row.doctor_name || row.assigned_doctor),
        'مسؤول المتابعة': safeText(row.assigned_to_name || row.assigned_to || row.created_by_name),
        النتيجة: safeText(row.result),
        'ملخص النتيجة': safeText(row.result_summary || row.notes),
        'موعد المتابعة القادمة': dateOnly(row.next_followup_date || row.postponed_until),
        'تاريخ الإنشاء': safeText(row.created_at),
        'آخر تحديث': safeText(row.updated_at),
        'آخر نشاط': safeText(row.last_event_at),
        'عدد أحداث السجل': Number(row.events_count || 0),
        'مؤرشف': row.operational_status === 'archived' ? 'نعم' : 'لا',
        'ملغي': row.operational_status === 'cancelled' ? 'نعم' : 'لا',
        'اسم العميل المصحح': '',
        'الكود المصحح': '',
        'الهاتف المصحح': '',
        'الفرع المصحح': '',
        'ملاحظات المراجعة': '',
      }));

      const today = new Date().toLocaleDateString('en-CA');
      await exportToExcel(rows, `سجل_خدمة_العملاء_الكامل_${today}`, 'سجل المتابعات');
      toast.success(`تم تصدير ${rows.length.toLocaleString('ar-EG')} متابعة إلى Excel`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر تصدير سجل خدمة العملاء');
    } finally {
      setExporting(false);
    }
  }

  return (
    <section className="mb-4 rounded-3xl border border-cyan-400/20 bg-cyan-500/[0.06] p-4" dir="rtl">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl bg-cyan-500/15 p-3 text-cyan-200"><Info size={21} /></div>
          <div>
            <h2 className="font-black text-white">توضيح سجل خدمة العملاء</h2>
            <p className="mt-1 max-w-4xl text-sm leading-7 text-slate-300">
              رقم «كل المتابعات» هو إجمالي السجل التاريخي القديم والجديد، ويشمل المكتمل والملغي والمؤرشف، وليس المطلوب تنفيذه اليوم. استخدم بطاقات «مفتوحة» و«اليوم» و«متأخرة» للعمل اليومي.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void exportFullLog()}
          disabled={exporting}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-black text-white hover:bg-emerald-500 disabled:opacity-60"
        >
          {exporting ? <Loader2 size={18} className="animate-spin" /> : <FileSpreadsheet size={18} />}
          {exporting ? 'جاري تجهيز الملف...' : 'تصدير السجل الكامل Excel'}
          {!exporting && <Download size={16} />}
        </button>
      </div>
    </section>
  );
}
