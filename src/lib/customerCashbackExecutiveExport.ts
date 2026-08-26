import type { CashbackComparisonPayload, CashbackComparisonRow } from '@/lib/customerCashbackAnalyticsExport';

export type CashbackOperationsPeriod = {
  period_start: string; period_end: string; total: number; notified: number; settled: number; partial: number;
  handled: number; pending: number; notification_rate: number | null; handled_rate: number | null;
  settlement_rate: number | null; redemption_rate: number | null; total_points: number; redeemed: number;
  remaining: number; avg_notify_hours: number | null; avg_settle_hours: number | null;
};
export type CashbackOperationsPayload = {
  branch: string; current: CashbackOperationsPeriod | null; previous: CashbackOperationsPeriod | null;
  curve: Array<{ day: number; notified: number; settled: number }>;
  previous_curve: Array<{ day: number; notified: number; settled: number }>;
  measurement_note?: string;
};

type Args = {
  rows: CashbackComparisonRow[];
  payload: CashbackComparisonPayload;
  branchLabel: string;
  operations: CashbackOperationsPayload[];
};

const COLOR = {
  navy: '0F172A', teal: '0F766E', cyan: '0891B2', green: '166534', red: 'B91C1C', purple: '7C3AED',
  slate: '64748B', amber: 'D97706', white: 'FFFFFF', line: 'CBD5E1', light: 'F8FAFC', greenBg: 'DCFCE7',
  redBg: 'FEE2E2', blueBg: 'DBEAFE', amberBg: 'FEF3C7',
};
const TREND: Record<string, string> = { new: 'عميل جديد', growing: 'نمو', stable: 'مستقر', declining: 'تراجع', inactive: 'توقف' };

function safeFilename(value: string) { return value.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '_'); }
function download(buffer: ArrayBuffer, filename: string) {
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}
function styleHeader(row: any) {
  row.height = 30; row.eachCell((cell: any) => {
    cell.font = { bold: true, color: { argb: COLOR.white } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.teal } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = { bottom: { style: 'medium', color: { argb: COLOR.navy } } };
  });
}
function dashboardTitle(ws: any, text: string, sub: string) {
  ws.mergeCells('A1:H2'); const t = ws.getCell('A1'); t.value = text; t.font = { bold: true, size: 18, color: { argb: COLOR.white } };
  t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.navy } }; t.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.mergeCells('A4:H4'); const s = ws.getCell('A4'); s.value = sub; s.font = { bold: true, color: { argb: COLOR.slate } }; s.alignment = { horizontal: 'center' };
}
function addKpis(ws: any, kpis: Array<[string, number | null, boolean?]>, startRow = 6) {
  kpis.forEach(([label, value, isPct], idx) => {
    const col = (idx % 4) * 2 + 1, row = startRow + Math.floor(idx / 4) * 3;
    ws.mergeCells(row, col, row, col + 1); ws.mergeCells(row + 1, col, row + 1, col + 1);
    const a = ws.getCell(row, col), b = ws.getCell(row + 1, col); a.value = label; b.value = value;
    a.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.teal } }; a.font = { bold: true, color: { argb: COLOR.white } };
    b.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F0FDFA' } }; b.font = { bold: true, size: 15, color: { argb: COLOR.navy } };
    a.alignment = b.alignment = { horizontal: 'center', vertical: 'middle' }; b.numFmt = isPct ? '0.00"%"' : '#,##0.00';
  });
}
function baseCanvas(title: string) {
  const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 480; const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, 1200, 480); ctx.fillStyle = '#0F172A'; ctx.font = 'bold 30px Arial'; ctx.textAlign = 'center'; ctx.direction = 'rtl'; ctx.fillText(title, 600, 44);
  return { canvas, ctx };
}
function barChart(title: string, labels: string[], values: number[], colors: string[]) {
  const { canvas, ctx } = baseCanvas(title); const left = 80, top = 85, w = 1070, h = 305; const max = Math.max(1, ...values.map(v => Math.abs(Number(v || 0))));
  ctx.strokeStyle = '#CBD5E1'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(left, top); ctx.lineTo(left, top + h); ctx.lineTo(left + w, top + h); ctx.stroke();
  const step = w / Math.max(1, labels.length), bw = Math.min(135, step * .55);
  labels.forEach((label, i) => { const value = Number(values[i] || 0), bh = Math.abs(value) / max * 260, x = left + i * step + (step - bw) / 2, y = top + h - bh;
    ctx.fillStyle = colors[i % colors.length]; ctx.fillRect(x, y, bw, bh); ctx.fillStyle = '#0F172A'; ctx.font = 'bold 18px Arial'; ctx.textAlign = 'center'; ctx.fillText(value.toLocaleString('en-US', { maximumFractionDigits: 1 }), x + bw / 2, Math.max(100, y - 8)); ctx.font = '17px Arial'; ctx.fillText(label, x + bw / 2, top + h + 34); });
  return canvas.toDataURL('image/png');
}
function lineChart(title: string, labels: string[], series: Array<{ name: string; values: number[]; color: string }>) {
  const { canvas, ctx } = baseCanvas(title); const left = 80, top = 85, w = 1070, h = 300; const max = Math.max(1, ...series.flatMap(s => s.values.map(v => Number(v || 0))));
  ctx.strokeStyle = '#CBD5E1'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(left, top); ctx.lineTo(left, top + h); ctx.lineTo(left + w, top + h); ctx.stroke();
  series.forEach(s => { ctx.strokeStyle = s.color; ctx.lineWidth = 4; ctx.beginPath(); s.values.forEach((v, i) => { const x = left + (i / Math.max(1, labels.length - 1)) * w, y = top + h - Number(v || 0) / max * h; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke(); });
  ctx.font = '15px Arial'; ctx.fillStyle = '#475569'; ctx.textAlign = 'center'; labels.forEach((l, i) => { if (i % 2 === 0 || labels.length < 9) ctx.fillText(l, left + i / Math.max(1, labels.length - 1) * w, top + h + 30); });
  let x = 80; series.forEach(s => { ctx.fillStyle = s.color; ctx.fillRect(x, 445, 20, 7); ctx.fillStyle = '#0F172A'; ctx.textAlign = 'left'; ctx.fillText(s.name, x + 26, 452); x += 245; });
  return canvas.toDataURL('image/png');
}
function addChart(workbook: any, ws: any, png: string, col: number, row: number) {
  const id = workbook.addImage({ base64: png, extension: 'png' }); ws.addImage(id, { tl: { col, row }, ext: { width: 555, height: 222 } });
}

export async function exportCustomerCashbackExecutiveWorkbook({ rows, payload, branchLabel, operations }: Args) {
  const { Workbook } = await import('exceljs'); const wb = new Workbook(); wb.creator = 'Dawaa Pharmacy'; wb.company = 'Dawaa Pharmacy'; wb.subject = 'Customer Points Executive Report'; wb.created = new Date();
  const summary = payload.summary || {}, periods = payload.periods;
  const dash = wb.addWorksheet('Dashboard تنفيذي', { views: [{ rightToLeft: true }] }); dash.columns = [22, 17, 22, 17, 22, 17, 22, 17].map(width => ({ width }));
  dashboardTitle(dash, `صيدليات دواء — تقرير نقاط العملاء — ${branchLabel}`, `تحليل 3 شهور: ${periods.current_start} → ${periods.current_end} مقارنة بـ ${periods.previous_start} → ${periods.previous_end}`);
  addKpis(dash, [
    ['نقاط الحالية', Number(summary.current_points || 0)], ['نقاط السابقة', Number(summary.previous_points || 0)], ['نمو النقاط', summary.points_growth_pct == null ? null : Number(summary.points_growth_pct), true], ['نمو المشتريات', summary.purchases_growth_pct == null ? null : Number(summary.purchases_growth_pct), true],
    ['عملاء جدد', Number(summary.new_customers || 0)], ['عملاء نمو', Number(summary.growing_customers || 0)], ['عملاء تراجع', Number(summary.declining_customers || 0)], ['عملاء توقف', Number(summary.inactive_customers || 0)],
  ]);
  addChart(wb, dash, barChart('تطور إجمالي النقاط', ['السابقة', 'الحالية'], [Number(summary.previous_points || 0), Number(summary.current_points || 0)], ['#64748B', '#0F766E']), 0, 12);
  addChart(wb, dash, barChart('اتجاه العملاء', ['جدد', 'نمو', 'مستقر', 'تراجع', 'توقف'], [Number(summary.new_customers || 0), Number(summary.growing_customers || 0), Number(summary.stable_customers || 0), Number(summary.declining_customers || 0), Number(summary.inactive_customers || 0)], ['#1D4ED8', '#166534', '#D97706', '#DC2626', '#991B1B']), 4, 12);

  if (operations.length === 1 && operations[0].current) {
    const op = operations[0], c = op.current;
    addKpis(dash, [['إجمالي عملاء التشغيل', c.total], ['تم التعامل', c.handled], ['نسبة التعامل', c.handled_rate, true], ['تم التبليغ', c.notified], ['سحب جزئي', c.partial], ['تمت التسوية', c.settled], ['نسبة التسوية', c.settlement_rate, true], ['المتبقي', c.remaining]], 26);
    addChart(wb, dash, barChart('حالة التنفيذ الحالية', ['إجمالي', 'تم التعامل', 'تم التبليغ', 'جزئي', 'تسوية', 'متبقي عملاء'], [c.total, c.handled, c.notified, c.partial, c.settled, c.pending], ['#64748B', '#0891B2', '#0F766E', '#7C3AED', '#166534', '#B91C1C']), 0, 33);
    const total = Math.max(1, c.total), prevTotal = Math.max(1, op.previous?.total || 1);
    const series: Array<{ name: string; values: number[]; color: string }> = [
      { name: 'تبليغ الحالية %', values: op.curve.map(x => x.notified * 100 / total), color: '#0F766E' }, { name: 'تسوية الحالية %', values: op.curve.map(x => x.settled * 100 / total), color: '#166534' },
    ];
    if (op.previous) { series.push({ name: 'تبليغ السابقة %', values: op.previous_curve.map(x => x.notified * 100 / prevTotal), color: '#64748B' }, { name: 'تسوية السابقة %', values: op.previous_curve.map(x => x.settled * 100 / prevTotal), color: '#7C3AED' }); }
    addChart(wb, dash, lineChart('سرعة الإنجاز خلال أول 14 يوم', op.curve.map(x => `يوم ${x.day}`), series), 4, 33);
  } else if (operations.length > 1) {
    addChart(wb, dash, barChart('نسبة التعامل حسب الفرع %', operations.map(o => o.branch.replace('فرع ', '')), operations.map(o => Number(o.current?.handled_rate || 0)), ['#0F766E', '#0891B2']), 0, 27);
    addChart(wb, dash, barChart('نسبة التسوية حسب الفرع %', operations.map(o => o.branch.replace('فرع ', '')), operations.map(o => Number(o.current?.settlement_rate || 0)), ['#166534', '#7C3AED']), 4, 27);
  }

  const ops = wb.addWorksheet('الأداء التشغيلي', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
  ops.columns = [22, 22, 15, 15, 16, 15, 16, 14, 15, 16, 18, 18, 18, 18].map(width => ({ width }));
  ops.addRow(['الفرع', 'الدورة', 'إجمالي العملاء', 'تم التعامل', 'نسبة التعامل %', 'تم التبليغ', 'نسبة التبليغ %', 'سحب جزئي', 'تمت التسوية', 'نسبة التسوية %', 'النقاط', 'المسحوب', 'المتبقي', 'متوسط أيام التبليغ']); styleHeader(ops.getRow(1));
  operations.forEach(o => { const c = o.current; if (!c) return; ops.addRow([o.branch, `${c.period_start} → ${c.period_end}`, c.total, c.handled, c.handled_rate, c.notified, c.notification_rate, c.partial, c.settled, c.settlement_rate, c.total_points, c.redeemed, c.remaining, c.avg_notify_hours == null ? null : c.avg_notify_hours / 24]);
    if (o.previous) { const p = o.previous; ops.addRow([`${o.branch} — السابقة`, `${p.period_start} → ${p.period_end}`, p.total, p.handled, p.handled_rate, p.notified, p.notification_rate, p.partial, p.settled, p.settlement_rate, p.total_points, p.redeemed, p.remaining, p.avg_notify_hours == null ? null : p.avg_notify_hours / 24]); }
  });
  [5, 7, 10].forEach(n => ops.getColumn(n).numFmt = '0.00"%"'); [11, 12, 13, 14].forEach(n => ops.getColumn(n).numFmt = '#,##0.00');
  ops.addRow([]); ops.addRow(['منهج السرعة', operations[0]?.measurement_note || 'من إغلاق الدورة حتى التبليغ/التسوية.']); ops.addRow(['المقارنة التشغيلية', 'الدورات التاريخية غير الموثوقة لا تستخدم كمرجع. أول دورة رسمية صحيحة تصبح Baseline، ومن الدورة التالية تظهر مقارنة السرعة تلقائيًا.']);

  operations.forEach(o => { const c = o.current; if (!c) return; const curve = wb.addWorksheet(`سرعة ${o.branch.replace('فرع ', '')}`.slice(0, 31), { views: [{ rightToLeft: true }] }); curve.columns = [12, 20, 20, 18, 18, 20, 20].map(width => ({ width })); curve.addRow(['اليوم', 'تبليغ تراكمي', 'تسوية تراكمية', 'تبليغ %', 'تسوية %', 'تبليغ سابق %', 'تسوية سابقة %']); styleHeader(curve.getRow(1)); const prevTotal = Math.max(1, o.previous?.total || 1);
    o.curve.forEach((x, i) => curve.addRow([x.day, x.notified, x.settled, x.notified * 100 / Math.max(1, c.total), x.settled * 100 / Math.max(1, c.total), o.previous ? Number(o.previous_curve[i]?.notified || 0) * 100 / prevTotal : null, o.previous ? Number(o.previous_curve[i]?.settled || 0) * 100 / prevTotal : null])); [4,5,6,7].forEach(n => curve.getColumn(n).numFmt = '0.00"%"'); });

  const compare = wb.addWorksheet('مقارنة العملاء', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
  compare.columns = [{ header:'الفرع',key:'branch',width:18},{header:'الكود',key:'code',width:14},{header:'العميل',key:'name',width:30},{header:'الهاتف',key:'phone',width:18},{header:'النسبة %',key:'rate',width:12},{header:'مشتريات الحالية',key:'cp',width:18},{header:'مشتريات السابقة',key:'pp',width:18},{header:'نمو المشتريات %',key:'pg',width:17},{header:'فواتير الحالية',key:'ci',width:15},{header:'فواتير السابقة',key:'pi',width:15},{header:'نقاط الحالية',key:'cpts',width:17},{header:'نقاط السابقة',key:'ppts',width:17},{header:'فرق النقاط',key:'diff',width:17},{header:'نمو النقاط %',key:'growth',width:17},{header:'الاتجاه',key:'trend',width:15}]; styleHeader(compare.getRow(1));
  rows.forEach((r, i) => { const row = compare.addRow({ branch:r.branch,code:r.customer_code,name:r.customer_name||'',phone:r.customer_phone||'',rate:r.cashback_rate,cp:r.current_purchases,pp:r.previous_purchases,pg:r.purchases_growth_pct,ci:r.current_invoices,pi:r.previous_invoices,cpts:r.current_points,ppts:r.previous_points,diff:r.points_change,growth:r.points_growth_pct,trend:TREND[r.trend]||r.trend }); if (i % 2) row.fill = { type:'pattern',pattern:'solid',fgColor:{argb:COLOR.light} }; const tone = r.trend === 'growing' ? [COLOR.greenBg,COLOR.green] : r.trend === 'new' ? [COLOR.blueBg,'1D4ED8'] : (r.trend === 'declining' || r.trend === 'inactive') ? [COLOR.redBg,COLOR.red] : [COLOR.amberBg,'92400E']; row.getCell(15).fill={type:'pattern',pattern:'solid',fgColor:{argb:tone[0]}};row.getCell(15).font={bold:true,color:{argb:tone[1]}}; });
  [5,8,14].forEach(n => compare.getColumn(n).numFmt = '0.00"%"'); [6,7,11,12,13].forEach(n => compare.getColumn(n).numFmt = '#,##0.00'); compare.getColumn(2).numFmt = '@'; compare.getColumn(4).numFmt = '@';

  const movers = wb.addWorksheet('أهم التغيرات', { views: [{ rightToLeft: true }] }); movers.columns = [16,18,14,30,18,18,18,18].map(width => ({ width })); movers.addRow(['التصنيف','الفرع','الكود','العميل','نقاط الحالية','نقاط السابقة','فرق النقاط','نمو النقاط %']); styleHeader(movers.getRow(1));
  const grow=[...rows].filter(r=>r.points_change>0).sort((a,b)=>b.points_change-a.points_change).slice(0,50), decline=[...rows].filter(r=>r.points_change<0).sort((a,b)=>a.points_change-b.points_change).slice(0,50); [...grow.map(r=>['أعلى نمو',r] as const),...decline.map(r=>['أكبر تراجع',r] as const)].forEach(([l,r])=>movers.addRow([l,r.branch,r.customer_code,r.customer_name||'',r.current_points,r.previous_points,r.points_change,r.points_growth_pct])); movers.getColumn(8).numFmt='0.00"%"';

  const guide = wb.addWorksheet('دليل التقرير', { views: [{ rightToLeft: true }] }); guide.columns=[{width:28},{width:82}]; guide.addRows([
    ['البند','التعريف'],['النطاق',branchLabel],['الدورة التحليلية الحالية',`${periods.current_start} → ${periods.current_end}`],['الدورة التحليلية السابقة',`${periods.previous_start} → ${periods.previous_end}`],['نمو النقاط','(الحالية - السابقة) ÷ السابقة × 100.'],['تم التعامل','تم تبليغه أو حدث له سحب/تسوية.'],['نسبة التعامل','تم التعامل ÷ إجمالي عملاء الدورة التشغيلية.'],['سرعة الإنجاز','من إغلاق الدورة حتى تسجيل التبليغ أو التسوية، بتوقيت القاهرة.'],['منحنى 14 يوم','النسبة التراكمية للعملاء الذين تم تبليغهم/تسويتهم خلال أول 14 يوم.'],['المقارنة السابقة','تحليل النمو دائمًا يقارن بالدورة الثلاثية السابقة. المقارنة التشغيلية تبدأ من أول دورة رسمية موثوقة.'],['مصدر البيانات','Snapshots ثابتة للدورات؛ لا يعاد حساب الفواتير عند فتح التقرير.']]); styleHeader(guide.getRow(1));

  const buffer = await wb.xlsx.writeBuffer(); download(buffer as ArrayBuffer, `تقرير_نقاط_العملاء_${safeFilename(branchLabel)}_${periods.current_end || 'current'}.xlsx`);
}
