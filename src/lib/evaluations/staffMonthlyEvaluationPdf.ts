import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import type { StaffEvaluationSectionV3 } from '@/lib/evaluations/staffEvaluationProfilesV3';

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

/**
 * نصائح محددة وقابلة للتنفيذ لكل محور، تُعرض تلقائيًا في التقرير لأي محور
 * حصل على 3 نجوم أو أقل — عشان الدكتور يخرج من التقرير عارف بالظبط
 * "أعمل إيه بالظبط الشهر الجاي" مش بس درجة رقمية.
 */
const SECTION_IMPROVEMENT_TIPS: Record<string, string[]> = {
  discipline: [
    'التزم بمواعيد الشيفتات، ولو حصل تأخير لا مفر منه أبلغ مسؤول الفرع فورًا مش بعد بدء الشيفت.',
    'سلّم الشيفت بتقرير واضح ومكتوب: المخزون الناقص، الحالات المعلقة، وأي ملاحظة للمسؤول التالي.',
    'اتبع تعليمات إدارة الفرع فور صدورها حتى لو وصلت شفهيًا، ولا تنتظر تعميم رسمي.',
  ],
  conversations: [
    'ابدأ كل محادثة بترحيب واضح، واسأل عن اسم العميل فورًا لو مش مسجّل بالفعل.',
    'رد على استفسارات العميل خلال أقل من دقيقتين وقت الذروة — التأخير بيفقد فرصة البيع.',
    'أغلق كل محادثة بسؤال "محتاج حاجة تانية؟" وسجّل أي طلب معلّق كمتابعة فورًا.',
  ],
  dispensing: [
    'اعمل مراجعة ثانية (Double-check) على الاسم والتركيز والجرعة قبل التسليم مباشرة، خاصة الأدوية المركّزة.',
    'اشرح طريقة الاستخدام والاحتياطات بصوت مسموع للعميل، مش بس مكتوبة على العلبة.',
    'لو مش متأكد من تفاعل دوائي محتمل، راجع مع الصيدلي الأول قبل الصرف، مش بعده.',
  ],
  followups_requests: [
    'سجّل كل طلب عميل فور حدوثه على التطبيق مباشرة، مش في آخر اليوم أو من الذاكرة.',
    'حدد موعد تنفيذ واضح لكل متابعة والتزم بيه بدل ما تفضل مفتوحة بلا تاريخ.',
    'وثّق نتيجة كل متابعة بوضوح (اتنفذ / العميل رفض / محتاج وقت أطول) عشان أي حد يقدر يكمل مكانك.',
  ],
  sales_quality: [
    'اسأل عن الاحتياج الفعلي للعميل قبل ما تقترح أي بديل أو إضافة، مش العكس.',
    'اقترح بديل واحد مناسب مرتبط باحتياج العميل، مش قائمة طويلة تحس العميل إنها ضغط بيع.',
    'راجع الفاتورة مع العميل قبل الدفع للتأكد إنها مطابقة تمامًا للمطلوب.',
  ],
  inventory: [
    'بلّغ عن أي صنف قارب على النفاد فور ملاحظته، مش وقت ما ينفد فعليًا.',
    'راجع تواريخ الصلاحية بشكل دوري وأبلغ فورًا عن أي صنف قريب من الانتهاء.',
    'ساهم في بيع الأصناف الراكدة باقتراحها كبديل مناسب كل ما فيه فرصة حقيقية تناسب احتياج العميل.',
  ],
  development: [
    'اطلب من مديرك ملاحظات دورية بدل ما تستنى التقييم الشهري بس.',
    'لو نفس الملاحظة اتكررت أكتر من مرة، اعمل خطوة عملية واحدة ملموسة لمعالجتها فورًا.',
    'شارك في أي تدريب داخلي متاح حتى لو مش إجباري — بيفرق فعليًا في تقييمك القادم.',
  ],
};

export async function buildStaffMonthlyEvaluationPdf(
  input: StaffMonthlyEvaluationPdfInput
): Promise<{ pdf: jsPDF; fileName: string }> {
  const weakSections = input.sections.filter((item) => item.score > 0 && item.score <= 3);

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

  const tipsHtml = weakSections.length
    ? `
      <div style="margin-top:16px;border:1px solid #f59e0b40;background:#fffbeb;border-radius:10px;padding:14px;page-break-inside:avoid">
        <div style="font-weight:800;color:#92400e;margin-bottom:8px">نصائح عملية لتحسين الأداء الشهر الجاي</div>
        ${weakSections
          .map((item) => {
            const tips = SECTION_IMPROVEMENT_TIPS[item.key] || [];
            if (!tips.length) return '';
            return `
              <div style="margin-bottom:8px">
                <div style="font-weight:700;font-size:12px;color:#92400e">${escapeHtml(item.title)}:</div>
                <ul style="margin:4px 0 0;padding-inline-start:18px;font-size:12px;color:#78350f">
                  ${tips.map((tip) => `<li style="margin-bottom:3px">${escapeHtml(tip)}</li>`).join('')}
                </ul>
              </div>`;
          })
          .join('')}
      </div>`
    : `
      <div style="margin-top:16px;border:1px solid #10b98140;background:#ecfdf5;border-radius:10px;padding:14px;text-align:center;font-weight:700;color:#065f46">
        أداء قوي في كل المحاور هذه الدورة — استمر على نفس المستوى وركّز على تثبيته.
      </div>`;

  const listHtml = (items: string[], emptyLabel: string) =>
    items.length
      ? `<ul style="margin:0;padding-inline-start:18px;font-size:13px;line-height:1.9">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
      : `<div style="font-size:12px;color:#9ca3af">${escapeHtml(emptyLabel)}</div>`;

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

      <div style="font-weight:800;margin-bottom:8px">محاور التقييم</div>
      ${sectionsHtml}

      ${tipsHtml}

      <div style="display:flex;gap:12px;margin-top:16px">
        <div style="flex:1;border:1px solid #10b98140;background:#ecfdf5;border-radius:10px;padding:12px">
          <div style="font-weight:800;color:#065f46;margin-bottom:6px">نقاط القوة</div>
          ${listHtml(input.strengths, 'لم يتم تسجيل نقاط قوة محددة.')}
        </div>
        <div style="flex:1;border:1px solid #f59e0b40;background:#fffbeb;border-radius:10px;padding:12px">
          <div style="font-weight:800;color:#92400e;margin-bottom:6px">خطة التطوير</div>
          ${listHtml(input.developmentPoints, 'لم يتم تسجيل نقاط تطوير محددة.')}
        </div>
      </div>

      <div style="margin-top:16px;border:1px solid #d1d5db;border-radius:10px;padding:12px;min-height:50px">
        <div style="font-weight:800;margin-bottom:5px">ملاحظات المدير العامة</div>
        <div style="white-space:pre-wrap;font-size:13px">${escapeHtml(input.managerNotes || 'لا توجد ملاحظات إضافية.')}</div>
      </div>

      <div style="margin-top:22px;font-size:10px;color:#6b7280;text-align:center">تم إنشاء التقرير من نظام Dawaa Pharmacy — سجل تقييم معتمد داخل قاعدة البيانات</div>
    </div>`;
  document.body.appendChild(host);

  try {
    const canvas = await html2canvas(host.firstElementChild as HTMLElement, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false,
    });
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pageWidth = 190;
    const pageHeight = 277;
    const imgHeight = (canvas.height * pageWidth) / canvas.width;
    const imgData = canvas.toDataURL('image/png', 1);
    let heightLeft = imgHeight;
    let position = 10;
    pdf.addImage(imgData, 'PNG', 10, position, pageWidth, imgHeight);
    heightLeft -= pageHeight;
    while (heightLeft > 0) {
      position = 10 - (imgHeight - heightLeft);
      pdf.addPage();
      pdf.addImage(imgData, 'PNG', 10, position, pageWidth, imgHeight);
      heightLeft -= pageHeight;
    }
    const safeName = String(input.staffName || 'employee').replace(/[\\/:*?"<>|]/g, '-');
    const fileName = `تقييم-شهري-${safeName}-${input.cycleDisplayLabel.replace(/\s/g, '')}.pdf`;
    return { pdf, fileName };
  } finally {
    host.remove();
  }
}
