import { getPaidStatement, type PaidStatement } from './paidStatementService';

const escape = (v: unknown) => String(v ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const money = (v: unknown) => Number(v).toLocaleString('ar-EG',{minimumFractionDigits:2,maximumFractionDigits:2});
const hours = (v: unknown) => Number(v).toLocaleString('ar-EG',{maximumFractionDigits:2});

export async function buildPaidStatementPdf(staffId: string, monthCycle: string) {
  const data: PaidStatement = await getPaidStatement(staffId, monthCycle);
  const pc = data.snapshot.payroll_components;
  const ai = data.snapshot.automated_incentives;
  const earnings: [string, number | undefined][] = [
    ['الراتب الأساسي',pc.base_salary],['حافز الأداء الشهري',pc.monthly_incentive_earned ?? pc.monthly_incentive],
    ['حافز قائمة الأصناف',pc.list_incentive],['الأجر الإضافي',pc.overtime],
    ['حوافز آلية أخرى',ai.automated_total_egp],['حوافز يدوية',pc.manual_incentives],
    ['تسويات يدوية',pc.manual_adjustment_input],['تسويات دورات سابقة',pc.post_paid_adjustments_total],
  ];
  const deductions: [string, number | undefined][] = [
    ['عجز أو أصناف منتهية',pc.expiry_shortage_deduction],['خصم عام',pc.branch_general_deduction],
    ['خصم فردي',pc.individual_deduction],['خصومات أخرى',pc.other_deduction],
  ];
  const auto: [string, number | undefined][] = [
    ['الأداء',ai.performance_incentive_egp],['التارجت',ai.target_bonus_egp],
    ['متابعة العملاء',ai.followup_threshold_bonus_egp],['طلبات العملاء',ai.customer_request_threshold_bonus_egp],
    ['نجم الفرع',ai.branch_star_bonus_egp],['مسابقة الدكاترة',ai.competition_bonus_egp],
    ['تقييم الإدارة',ai.manager_evaluation_incentive_egp],['النقاط',ai.points_incentive_egp],
  ];
  const rows = (items: [string, number | undefined][]) => items.filter(([,v])=>v!=null)
    .map(([name,value])=>`<tr><td>${escape(name)}</td><td>${escape(money(value))} ج</td></tr>`).join('');
  const host = document.createElement('div');
  host.style.cssText='position:fixed;left:-10000px;top:0;width:794px';
  host.dir='rtl';
  host.innerHTML=`<main style="width:794px;box-sizing:border-box;padding:36px;background:#fff;color:#182936;font-family:Tahoma,Arial,sans-serif;direction:rtl">
    <header style="border-bottom:3px solid #087e79;padding-bottom:14px"><div style="font-size:23px;font-weight:800">صيدليات دواء · كشف راتب مدفوع</div>
    <div style="font-size:12px;margin-top:6px">دورة ${escape(data.cycle_start)} إلى ${escape(data.cycle_end)} · ${escape(data.month_cycle)}</div></header>
    <div style="display:flex;justify-content:space-between;margin:18px 0;font-size:13px"><div><b>الموظف:</b> ${escape(data.staff_name)}<br/><b>الفرع:</b> ${escape(data.branch)}</div>
    <div><b>اعتماد:</b> ${escape(new Date(data.approved_at).toLocaleDateString('ar-EG'))}<br/><b>دفع:</b> ${escape(new Date(data.paid_at).toLocaleDateString('ar-EG'))}</div></div>
    <section style="border:1px solid #d6e3e2;border-radius:10px;padding:14px;margin-bottom:18px;font-size:14px"><b>الساعات المسجلة في كشف الاعتماد</b><br/>عمل: ${escape(hours(data.worked_hours))} ساعة · إضافي: ${escape(hours(data.overtime_hours))} ساعة</section>
    <h2 style="font-size:16px;color:#087e79">المستحقات</h2><table>${rows(earnings)}</table>
    <h2 style="font-size:16px;color:#087e79;margin-top:18px">تفصيل الحوافز الآلية</h2><table>${rows(auto)}</table>
    <div style="font-size:11px;color:#687c83;margin-top:4px">تفصيل الحوافز الآلية جزء من إجماليها بالأعلى؛ لا يُجمع مرة ثانية.</div>
    <h2 style="font-size:16px;color:#a84444;margin-top:18px">الخصومات</h2><table>${rows(deductions)}</table>
    <div style="margin-top:20px;border-top:2px solid #087e79;padding:14px;background:#eef8f6;font-size:20px;font-weight:800">صافي الراتب المدفوع: ${escape(money(data.net_salary))} ج</div>
    <footer style="margin-top:20px;font-size:10px;color:#687c83">البيانات المالية والساعات مأخوذة من نسخة الاعتماد المجمدة. رقم الكشف: ${escape(data.id)} · نسخة الحساب: ${escape(data.freeze_version)}. تفاصيل الأيام والبصمات تُراجع من تقرير الحضور المنفصل.</footer>
  </main>`;
  host.querySelectorAll('table').forEach(table=>{(table as HTMLElement).style.cssText='width:100%;border-collapse:collapse;font-size:12px';table.querySelectorAll('td').forEach(td=>{td.style.cssText='padding:7px;border-bottom:1px solid #e4e9ea';});});
  document.body.appendChild(host);
  try {
    const [{default:html2canvas},{jsPDF}] = await Promise.all([import('html2canvas'),import('jspdf')]);
    const canvas=await html2canvas(host.firstElementChild as HTMLElement,{scale:2,backgroundColor:'#fff',logging:false});
    const pdf=new jsPDF('p','mm','a4');
    const width=190, height=canvas.height*width/canvas.width, page=277;
    const png=canvas.toDataURL('image/png');
    for(let offset=0;offset<height;offset+=page){if(offset)pdf.addPage();pdf.addImage(png,'PNG',10,10-offset,width,height);}
    return {pdf,fileName:`كشف-راتب-مدفوع-${data.month_cycle}-${data.staff_id}.pdf`};
  } finally {host.remove();}
}
