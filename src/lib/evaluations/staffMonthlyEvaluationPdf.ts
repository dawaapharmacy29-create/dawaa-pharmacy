import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import type { StaffEvaluationSectionV3 } from '@/lib/evaluations/staffEvaluationProfilesV3';
import { CRITICAL_GATE_CAPS, type CriticalGateType } from '@/lib/evaluations/incentiveTiers';

export type StaffMonthlyEvaluationPdfInput = {
  staffName: string;
  staffRole: string;
  branch: string;
  cycleDisplayLabel: string;
  evaluatorName: string;
  overallScore: number;
  grade: string;
  sections: StaffEvaluationSectionV3[];
  strengths: string[];
  developmentPoints: string[];
  managerNotes: string;
  pointsFinal?: number | null;
  pointsTarget?: number | null;
  incentiveEgp?: number | null;
  financialSource?: 'settled_statement' | 'points_truth';
  approvedAt: string; snapshotHash: string; criticalGates: string[];
  evidence: { reviewsStatus: string; followupsStatus: string; attendanceStatus: string; conversationReviews: number; conversationAverage: number | null; followupsCompleted: number; followupsTotal: number; attendanceFinalizedDays: number; attendanceClassifiedDays: number; attendancePendingDays: number; attendanceConflictDays: number; attendanceLateCases: number; attendanceLateMinutes: number; attendanceAbsenceCases: number; medicalErrors: number; invoiceErrors: number; };
};

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function starMeaning(score: number) {
  return ['', 'ضعيف جدًا', 'يحتاج تحسين', 'مقبول', 'جيد جدًا', 'ممتاز'][score] || 'لم يتم التقييم';
}

export async function buildStaffMonthlyEvaluationPdf(
  input: StaffMonthlyEvaluationPdfInput
): Promise<{ pdf: jsPDF; fileName: string }> {
  const sectionsHtml = input.sections
    .map((item) => {
      const rubricLine = item.rubric && item.score ? item.rubric[item.score - 1] : '';
      return `
        <div style="border:1px solid #d1d5db;border-radius:10px;padding:12px;margin-bottom:10px;page-break-inside:avoid">
          <div style="display:flex;justify-content:space-between;font-weight:800">
            <span>${escapeHtml(item.title)} <span style="font-weight:600;color:#6b7280;font-size:11px">(الوزن ${item.weight}%)</span></span>
            <span style="color:#0f766e">${item.score ? `${item.score} نجوم — ${starMeaning(item.score)}` : 'لم يتم التقييم'}</span>
          </div>
          ${rubricLine ? `<div style="margin-top:6px;font-size:12px;color:#374151">المعيار المُطبَّق: ${escapeHtml(rubricLine)}</div>` : ''}
          ${item.notes ? `<div style="margin-top:6px;font-size:12px;color:#111827;background:#f9fafb;border-radius:6px;padding:6px 8px">ملاحظة المدير: ${escapeHtml(item.notes)}</div>` : ''}
        </div>`;
    })
    .join('');

  const listHtml = (items: string[], emptyLabel: string) =>
    items.length
      ? `<div style="display:flex;flex-direction:column;gap:7px;font-size:12.5px;line-height:1.75">${items.map((item, index) => `<div style="display:flex;gap:7px;align-items:flex-start"><span style="font-weight:900;color:#0f766e;min-width:18px">${index + 1}.</span><span>${escapeHtml(item)}</span></div>`).join('')}</div>`
      : `<div style="font-size:12px;color:#9ca3af">${escapeHtml(emptyLabel)}</div>`;

  const gateRows = input.criticalGates.map((gate) => CRITICAL_GATE_CAPS[gate as CriticalGateType]?.label || gate).filter(Boolean);
  const evidence = input.evidence;
  const evidenceRows = [
    `مراجعات المحادثات: ${evidence.reviewsStatus === 'available' ? `${evidence.conversationReviews} مراجعة${evidence.conversationAverage == null ? '' : ` · المتوسط ${evidence.conversationAverage}/10`}` : 'المصدر غير متاح'}`,
    `المتابعات: ${evidence.followupsStatus === 'available' ? `${evidence.followupsCompleted}/${evidence.followupsTotal} مكتملة` : 'المصدر غير متاح'}`,
    `الحضور: ${evidence.attendanceStatus === 'available' ? `${evidence.attendanceFinalizedDays} يوم تم حسمه نهائيًا · ${evidence.attendanceClassifiedDays} يوم له تصنيف في سجل الحضور · ${evidence.attendanceLateCases} حالات تأخير (${evidence.attendanceLateMinutes} دقيقة) · ${evidence.attendanceAbsenceCases} غياب` : 'المصدر غير متاح'}`,
    evidence.medicalErrors ? `أخطاء طبية موثقة: ${evidence.medicalErrors}` : '',
    evidence.invoiceErrors ? `أخطاء فاتورة موثقة: ${evidence.invoiceErrors}` : '',
  ].filter(Boolean);
  const approvedAtLabel = input.approvedAt ? new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Cairo' }).format(new Date(input.approvedAt)) : 'غير متاح';
  const financialSourceLabel = input.financialSource === 'settled_statement' ? 'كشف مالي معتمد ومقفل' : 'الحقيقة المالية الحالية من نظام النقاط';

  const incentiveRow =
    input.incentiveEgp != null
      ? `<div>حافز الأداء المركزي: <b>${input.incentiveEgp.toLocaleString('ar-EG')} جنيه</b></div>`
      : '';
  const pointsRow =
    input.pointsFinal != null && input.pointsTarget != null
      ? `<div>النقاط: <b>${input.pointsFinal} / ${input.pointsTarget}</b></div>`
      : '';

  const host = document.createElement('div');
  host.style.position = 'fixed';
  host.style.left = '-9999px';
  host.style.top = '0';
  host.innerHTML = `
    <div dir="rtl" style="width:760px;padding:26px;background:#fff;color:#111827;font-family:Tahoma,Arial,sans-serif">
      <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #0f766e;padding-bottom:12px;margin-bottom:16px">
        <div>
          <div style="font-size:19px;font-weight:900;color:#0f766e">التقييم الشهري — ${escapeHtml(input.staffName)}</div>
          <div style="font-size:12px;color:#6b7280;margin-top:2px">${escapeHtml(input.staffRole)} · ${escapeHtml(input.branch)} · دورة ${escapeHtml(input.cycleDisplayLabel)}</div>
        </div>
        <div style="text-align:left">
          <div style="font-size:28px;font-weight:900;color:#0f766e">${input.overallScore}/100</div>
          <div style="font-size:12px;font-weight:800;color:#6b7280">${escapeHtml(input.grade)}</div>
        </div>
      </div>

      <div style="display:flex;gap:10px;font-size:13px;font-weight:700;color:#111827;margin-bottom:16px">
        <div style="flex:1;border:1px solid #d1d5db;border-radius:8px;padding:8px 10px">قيّمه: ${escapeHtml(input.evaluatorName)}</div>
        ${pointsRow ? `<div style="flex:1;border:1px solid #d1d5db;border-radius:8px;padding:8px 10px">${pointsRow}</div>` : ''}
        ${incentiveRow ? `<div style="flex:1;border:1px solid #d1d5db;border-radius:8px;padding:8px 10px">${incentiveRow}</div>` : ''}
      </div>

      <div style="border:1px solid #99f6e4;background:#f0fdfa;border-radius:10px;padding:10px;margin-bottom:14px;font-size:11px;line-height:1.8"><div><b>حالة التقرير:</b> تقييم شهري معتمد</div><div><b>تاريخ الاعتماد:</b> ${escapeHtml(approvedAtLabel)}</div><div><b>بصمة نسخة التقييم المعتمدة:</b> ${escapeHtml(input.snapshotHash)}</div><div><b>مصدر النقاط والحافز:</b> ${escapeHtml(financialSourceLabel)} — مسار مالي مستقل عن بصمة التقييم</div></div><div style="font-weight:800;margin-bottom:8px">محاور التقييم</div>
      ${sectionsHtml}


      <div style="margin-top:16px;border:1px solid #d1d5db;border-radius:10px;padding:12px"><div style="font-weight:800;margin-bottom:6px">ملخص الأدلة التي دعمت التقييم</div>${listHtml(evidenceRows, 'لا يوجد ملخص أدلة متاح.')}</div><div style="margin-top:12px;border:1px solid ${gateRows.length ? '#fecaca' : '#bbf7d0'};background:${gateRows.length ? '#fef2f2' : '#f0fdf4'};border-radius:10px;padding:12px"><div style="font-weight:800;margin-bottom:6px">المخالفات الحرجة</div>${listHtml(gateRows, 'لا توجد مخالفات حرجة مسجلة في النسخة المعتمدة.')}</div><div style="margin-top:16px;border:1px solid #10b98140;background:#ecfdf5;border-radius:10px;padding:12px">
        <div style="font-weight:800;color:#065f46;margin-bottom:7px">نقاط القوة</div>
        ${listHtml(input.strengths, 'لم يتم تسجيل نقاط قوة محددة.')}
      </div>
      <div style="margin-top:12px;border:1px solid #f59e0b40;background:#fffbeb;border-radius:10px;padding:12px">
        <div style="font-weight:800;color:#92400e;margin-bottom:3px">خطة التطوير</div>
        <div style="font-size:10.5px;color:#78716c;margin-bottom:8px">مرتبة كبنود تنفيذية واضحة للمراجعة في الدورة التالية.</div>
        ${listHtml(input.developmentPoints, 'لم يتم تسجيل نقاط تطوير محددة.')}
      </div>

      <div style="margin-top:16px;border:1px solid #d1d5db;border-radius:10px;padding:12px;min-height:50px">
        <div style="font-weight:800;margin-bottom:5px">ملاحظات المدير العامة</div>
        <div style="white-space:pre-wrap;font-size:12.5px;line-height:1.8">${escapeHtml(input.managerNotes || 'لا توجد ملاحظات إضافية.')}</div>
      </div>

      <div style="margin-top:22px;font-size:10px;color:#6b7280;text-align:center">تم إنشاء التقرير من نظام Dawaa Pharmacy — بصمة الاعتماد تثبت محتوى التقييم المعتمد، بينما النقاط والحافز معروضان من المصدر المالي الموضح أعلاه</div>
    </div>`;
  document.body.appendChild(host);

  try {
    const source = host.firstElementChild as HTMLElement;
    const pageHost = document.createElement('div');
    pageHost.style.cssText = 'position:fixed;left:-12000px;top:0;width:794px;background:#fff';
    document.body.appendChild(pageHost);
    const children = Array.from(source.children) as HTMLElement[];
    const pages: HTMLElement[] = [];
    let current = document.createElement('section');
    current.dir = 'rtl';
    current.style.cssText = 'width:794px;height:1123px;box-sizing:border-box;padding:30px 34px 42px;background:#fff;color:#111827;font-family:Tahoma,Arial,sans-serif;overflow:hidden';
    pageHost.appendChild(current);
    pages.push(current);
    for (const child of children) {
      const clone = child.cloneNode(true) as HTMLElement;
      current.appendChild(clone);
      if (current.scrollHeight > current.clientHeight) {
        current.removeChild(clone);
        current = document.createElement('section');
        current.dir = 'rtl';
        current.style.cssText = 'width:794px;height:1123px;box-sizing:border-box;padding:30px 34px 42px;background:#fff;color:#111827;font-family:Tahoma,Arial,sans-serif;overflow:hidden';
        pageHost.appendChild(current);
        pages.push(current);
        current.appendChild(clone);
        if (current.scrollHeight > current.clientHeight) {
          // Never silently crop an oversized report block. Let the page grow and
          // render it proportionally instead of hiding content behind overflow.
          current.style.height = 'auto';
          current.style.minHeight = '1123px';
          current.style.overflow = 'visible';
        }
      }
    }
    const pdf = new jsPDF('p', 'mm', 'a4');
    for (let index = 0; index < pages.length; index += 1) {
      const canvas = await html2canvas(pages[index], { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
      if (index > 0) pdf.addPage();
      pdf.addImage(canvas.toDataURL('image/png', 1), 'PNG', 0, 0, 210, 297);
    }
    pageHost.remove();
    const safeName = String(input.staffName || 'employee').replace(/[\\/:*?"<>|]/g, '-');
    const fileName = `تقييم-شهري-${safeName}-${input.cycleDisplayLabel.replace(/\s/g, '')}.pdf`;
    return { pdf, fileName };
  } finally {
    host.remove();
  }
}
