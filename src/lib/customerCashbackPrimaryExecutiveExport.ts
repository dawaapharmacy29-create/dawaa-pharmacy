import type { CashbackComparisonPayload, CashbackComparisonRow } from '@/lib/customerCashbackAnalyticsExport';
import type { CashbackOperationsPayload } from '@/lib/customerCashbackExecutiveExport';

export type CashbackCurrentRow = {
  id: string;
  customer_code: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  branch: string | null;
  cycle_label: string | null;
  cycle_start: string | null;
  cycle_end: string | null;
  total_spent: number | null;
  cashback_rate: number | null;
  cashback_value: number | null;
  redeemed_value: number | null;
  remaining_value: number | null;
  status: string | null;
  notified_at: string | null;
  bconnect_updated_at: string | null;
  settled_at: string | null;
  notes: string | null;
};

type Args = {
  rows: CashbackComparisonRow[];
  payload: CashbackComparisonPayload;
  branchLabel: string;
  operations: CashbackOperationsPayload[];
  currentRows: CashbackCurrentRow[];
};

const C = {
  navy: '0F172A', teal: '0F766E', cyan: '0891B2', white: 'FFFFFF', slate: '475569',
  line: 'CBD5E1', light: 'F8FAFC', green: '166534', greenBg: 'DCFCE7', red: '991B1B',
  redBg: 'FEE2E2', amber: '92400E', amberBg: 'FEF3C7', blue: '1D4ED8', blueBg: 'DBEAFE', purple: '7C3AED',
};
const TREND: Record<string, string> = { new: 'عميل جديد', growing: 'نمو', stable: 'مستقر', declining: 'تراجع', inactive: 'توقف' };
const STATUS: Record<string, string> = {
  calculated: 'لم يتم التعامل', notified: 'تم تبليغ العميل', bconnect_updated: 'تم تحديث بي كونكت',
  partially_redeemed: 'سحب جزئي', settled: 'تمت التسوية',
};

function safeFilename(value: string) { return value.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '_'); }
function download(buffer: ArrayBuffer, filename: string) {
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}
function styleHeader(row: any) {
  row.height = 30; row.eachCell((cell: any) => {
    cell.font = { bold: true, color: { argb: C.white }, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.teal } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = { bottom: { style: 'medium', color: { argb: C.navy } } };
  });
}
function title(ws: any, text: string, sub: string) {
  ws.mergeCells('A1:H2'); const a = ws.getCell('A1'); a.value = text;
  a.font = { bold: true, size: 18, color: { argb: C.white } }; a.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.navy } };
  a.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.mergeCells('A4:H4'); const b = ws.getCell('A4'); b.value = sub; b.font = { bold: true, color: { argb: C.slate } }; b.alignment = { horizontal: 'center' };
}
function addKpis(ws: any, values: Array<[string, number | null, boolean?]>, start = 6) {
  values.forEach(([label, value, pct], i) => {
    const col = (i % 4) * 2 + 1, row = start + Math.floor(i / 4) * 3;
    ws.mergeCells(row, col, row, col + 1); ws.mergeCells(row + 1, col, row + 1, col + 1);
    const l = ws.getCell(row, col), v = ws.getCell(row + 1, col); l.value = label; v.value = value;
    l.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.teal } }; l.font = { bold: true, color: { argb: C.white } };
    v.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F0FDFA' } }; v.font = { bold: true, size: 15, color: { argb: C.navy } };
    l.alignment = v.alignment = { horizontal: 'center', vertical: 'middle' }; v.numFmt = pct ? '0.00"%"' : '#,##0.00';
  });
}
function canvasBase(t: string) {
  const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 480; const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, 1200, 480); ctx.fillStyle = '#0F172A'; ctx.font = 'bold 30px Arial'; ctx.textAlign = 'center'; ctx.direction = 'rtl'; ctx.fillText(t, 600, 44);
  return { canvas, ctx };
}
function barChart(t: string, labels: string[], values: number[], colors: string[]) {
  const { canvas, ctx } = canvasBase(t); const left = 75, top = 85, w = 1070, h = 305, max = Math.max(1, ...values.map(v => Math.abs(Number(v || 0))));
  ctx.strokeStyle = '#CBD5E1'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(left, top); ctx.lineTo(left, top + h); ctx.lineTo(left + w, top + h); ctx.stroke();
  const step = w / Math.max(1, labels.length), bw = Math.min(135, step * .55);
  labels.forEach((label, i) => { const value = Number(values[i] || 0), bh = Math.abs(value) / max * 260, x = left + i * step + (step - bw) / 2, y = top + h - bh;
    ctx.fillStyle = colors[i % colors.length]; ctx.fillRect(x, y, bw, bh); ctx.fillStyle = '#0F172A'; ctx.font = 'bold 18px Arial'; ctx.textAlign = 'center'; ctx.fillText(value.toLocaleString('en-US', { maximumFractionDigits: 1 }), x + bw / 2, Math.max(100, y - 8)); ctx.font = '17px Arial'; ctx.fillText(label, x + bw / 2, top + h + 34); });
  return canvas.toDataURL('image/png');
}
function lineChart(t: string, labels: string[], series: Array<{ name: string; values: number[]; color: string }>) {
  const { canvas, ctx } = canvasBase(t); const left = 75, top = 85, w = 1070, h = 300, max = Math.max(1, ...series.flatMap(s => s.values.map(Number)));
  ctx.strokeStyle = '#CBD5E1'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(left, top); ctx.lineTo(left, top + h); ctx.lineTo(left + w, top + h); ctx.stroke();
  series.forEach(s => { ctx.strokeStyle = s.color; ctx.lineWidth = 4; ctx.beginPath(); s.values.forEach((v, i) => { const x = left + i / Math.max(1, labels.length - 1) * w, y = top + h - Number(v || 0) / max * h; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke(); });
  ctx.font = '15px Arial'; ctx.fillStyle = '#475569'; labels.forEach((l, i) => { if (i % 2 === 0) ctx.fillText(l, left + i / Math.max(1, labels.length - 1) * w, top + h + 30); });
  let x = 80; series.forEach(s => { ctx.fillStyle = s.color; ctx.fillRect(x, 445, 20, 7); ctx.fillStyle = '#0F172A'; ctx.textAlign = 'left'; ctx.fillText(s.name, x + 26, 452); x += 245; });
  return canvas.toDataURL('image/png');
}
function addImage(wb: any, ws: any, png: string, col: number, row: number) { const id = wb.addImage({ base64: png, extension: 'png' }); ws.addImage(id, { tl: { col, row }, ext: { width: 555, height: 222 } }); }
function dateText(value?: string | null) { return value ? String(value).replace('T', ' ').slice(0, 16) : ''; }

export async function exportCustomerCashbackPrimaryExecutiveWorkbook({ rows, payload, branchLabel, operations, currentRows }: Args) {
  const { Workbook } = await import('exceljs'); const wb = new Workbook(); wb.creator = 'Dawaa Pharmacy'; wb.company = 'Dawaa Pharmacy'; wb.subject = 'Customer Points Executive & Operational Report'; wb.created = new Date();
  const s: any = payload.summary || {}, p = payload.periods;
  const dash = wb.addWorksheet('Dashboard تنفيذي', { views: [{ rightToLeft: true }] }); dash.columns = [22, 17, 22, 17, 22, 17, 22, 17].map(width => ({ width }));
  title(dash, `صيدليات دواء — تقرير نقاط العملاء — ${branchLabel}`, `الدورة التحليلية ${p.current_start} → ${p.current_end} مقابل ${p.previous_start} → ${p.previous_end}`);
  addKpis(dash, [['نقاط الحالية',Number(s.current_points||0)],['نقاط السابقة',Number(s.previous_points||0)],['نمو النقاط',s.points_growth_pct==null?null:Number(s.points_growth_pct),true],['نمو المشتريات',s.purchases_growth_pct==null?null:Number(s.purchases_growth_pct),true],['عملاء جدد',Number(s.new_customers||0)],['عملاء نمو',Number(s.growing_customers||0)],['عملاء تراجع',Number(s.declining_customers||0)],['عملاء توقف',Number(s.inactive_customers||0)]]);
  addImage(wb,dash,barChart('تطور إجمالي النقاط',['السابقة','الحالية'],[Number(s.previous_points||0),Number(s.current_points||0)],['#64748B','#0F766E']),0,12);
  addImage(wb,dash,barChart('اتجاه العملاء',['جدد','نمو','مستقر','تراجع','توقف'],[Number(s.new_customers||0),Number(s.growing_customers||0),Number(s.stable_customers||0),Number(s.declining_customers||0),Number(s.inactive_customers||0)],['#1D4ED8','#166534','#D97706','#DC2626','#991B1B']),4,12);
  if (operations.length === 1 && operations[0].current) {
    const o=operations[0], c=o.current; addKpis(dash,[['إجمالي عملاء الدورة',c.total],['تم التعامل',c.handled],['نسبة التعامل',c.handled_rate,true],['تم التبليغ',c.notified],['سحب جزئي',c.partial],['تمت التسوية',c.settled],['نسبة التسوية',c.settlement_rate,true],['قيمة المتبقي',c.remaining]],26);
    addImage(wb,dash,barChart('حالة تنفيذ الدورة',['إجمالي','تعامل','تبليغ','جزئي','تسوية','متبقي'],[c.total,c.handled,c.notified,c.partial,c.settled,c.pending],['#64748B','#0891B2','#0F766E','#7C3AED','#166534','#B91C1C']),0,33);
    const total=Math.max(1,c.total), prevTotal=Math.max(1,o.previous?.total||1); const series=[{name:'تبليغ الحالية %',values:o.curve.map(x=>x.notified*100/total),color:'#0F766E'},{name:'تسوية الحالية %',values:o.curve.map(x=>x.settled*100/total),color:'#166534'}];
    if(o.previous){series.push({name:'تبليغ السابقة %',values:o.previous_curve.map(x=>x.notified*100/prevTotal),color:'#64748B'},{name:'تسوية السابقة %',values:o.previous_curve.map(x=>x.settled*100/prevTotal),color:'#7C3AED'});}
    addImage(wb,dash,lineChart('سرعة الإنجاز خلال أول 14 يوم',o.curve.map(x=>`يوم ${x.day}`),series),4,33);
  } else if (operations.length > 1) {
    addImage(wb,dash,barChart('نسبة التعامل حسب الفرع %',operations.map(o=>o.branch.replace('فرع ','')),operations.map(o=>Number(o.current?.handled_rate||0)),['#0F766E','#0891B2']),0,27);
    addImage(wb,dash,barChart('نسبة التسوية حسب الفرع %',operations.map(o=>o.branch.replace('فرع ','')),operations.map(o=>Number(o.current?.settlement_rate||0)),['#166534','#7C3AED']),4,27);
  }

  const current = wb.addWorksheet('عملاء الدورة الحالية', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
  current.columns=[{header:'الفرع',key:'branch',width:18},{header:'الكود',key:'code',width:14},{header:'اسم العميل',key:'name',width:30},{header:'الهاتف',key:'phone',width:18},{header:'الدورة',key:'cycle',width:24},{header:'إجمالي المشتريات',key:'spent',width:18},{header:'النسبة %',key:'rate',width:12},{header:'قيمة النقاط',key:'points',width:16},{header:'المسحوب',key:'redeemed',width:16},{header:'المتبقي',key:'remaining',width:16},{header:'الحالة',key:'status',width:20},{header:'تم التبليغ',key:'notified',width:20},{header:'تحديث بي كونكت',key:'bconnect',width:20},{header:'تمت التسوية',key:'settled',width:20},{header:'ملاحظات',key:'notes',width:35}]; styleHeader(current.getRow(1)); current.autoFilter={from:'A1',to:'O1'};
  currentRows.forEach((r,i)=>{const row=current.addRow({branch:r.branch||'',code:r.customer_code||'',name:r.customer_name||'',phone:r.customer_phone||'',cycle:r.cycle_label||`${r.cycle_start||''} → ${r.cycle_end||''}`,spent:Number(r.total_spent||0),rate:Number(r.cashback_rate||0),points:Number(r.cashback_value||0),redeemed:Number(r.redeemed_value||0),remaining:Number(r.remaining_value??Math.max(0,Number(r.cashback_value||0)-Number(r.redeemed_value||0))),status:STATUS[String(r.status||'calculated')]||String(r.status||''),notified:dateText(r.notified_at),bconnect:dateText(r.bconnect_updated_at),settled:dateText(r.settled_at),notes:r.notes||''}); if(i%2)row.fill={type:'pattern',pattern:'solid',fgColor:{argb:C.light}}; const st=String(r.status||'calculated'), cell=row.getCell(11); const tone=st==='settled'?[C.greenBg,C.green]:st==='partially_redeemed'?['EDE9FE',C.purple]:st==='notified'?[C.blueBg,C.blue]:[C.amberBg,C.amber]; cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:tone[0]}};cell.font={bold:true,color:{argb:tone[1]}};});
  [6,8,9,10].forEach(n=>current.getColumn(n).numFmt='#,##0.00'); current.getColumn(7).numFmt='0.00"%"'; current.getColumn(2).numFmt='@'; current.getColumn(4).numFmt='@';

  const ops=wb.addWorksheet('الأداء التشغيلي',{views:[{rightToLeft:true,state:'frozen',ySplit:1}]}); ops.columns=[22,24,15,15,16,15,16,14,15,16,18,18,18,18,18].map(width=>({width})); ops.addRow(['الفرع','الدورة','إجمالي العملاء','تم التعامل','نسبة التعامل %','تم التبليغ','نسبة التبليغ %','سحب جزئي','تمت التسوية','نسبة التسوية %','النقاط','المسحوب','المتبقي','متوسط أيام التبليغ','متوسط أيام التسوية']);styleHeader(ops.getRow(1));
  operations.forEach(o=>{const c=o.current;if(!c)return;ops.addRow([o.branch,`${c.period_start} → ${c.period_end}`,c.total,c.handled,c.handled_rate,c.notified,c.notification_rate,c.partial,c.settled,c.settlement_rate,c.total_points,c.redeemed,c.remaining,c.avg_notify_hours==null?null:c.avg_notify_hours/24,c.avg_settle_hours==null?null:c.avg_settle_hours/24]);if(o.previous){const q=o.previous;ops.addRow([`${o.branch} — السابقة`,`${q.period_start} → ${q.period_end}`,q.total,q.handled,q.handled_rate,q.notified,q.notification_rate,q.partial,q.settled,q.settlement_rate,q.total_points,q.redeemed,q.remaining,q.avg_notify_hours==null?null:q.avg_notify_hours/24,q.avg_settle_hours==null?null:q.avg_settle_hours/24]);}}); [5,7,10].forEach(n=>ops.getColumn(n).numFmt='0.00"%"');[11,12,13,14,15].forEach(n=>ops.getColumn(n).numFmt='#,##0.00');

  operations.forEach(o=>{const c=o.current;if(!c)return;const ws=wb.addWorksheet(`سرعة ${o.branch.replace('فرع ','')}`.slice(0,31),{views:[{rightToLeft:true}]});ws.columns=[12,20,20,18,18,20,20].map(width=>({width}));ws.addRow(['اليوم','تبليغ تراكمي','تسوية تراكمية','تبليغ %','تسوية %','تبليغ سابق %','تسوية سابق %']);styleHeader(ws.getRow(1));const pt=Math.max(1,o.previous?.total||1);o.curve.forEach((x,i)=>ws.addRow([x.day,x.notified,x.settled,x.notified*100/Math.max(1,c.total),x.settled*100/Math.max(1,c.total),o.previous?Number(o.previous_curve[i]?.notified||0)*100/pt:null,o.previous?Number(o.previous_curve[i]?.settled||0)*100/pt:null]));[4,5,6,7].forEach(n=>ws.getColumn(n).numFmt='0.00"%"');});

  const compare=wb.addWorksheet('مقارنة العملاء',{views:[{rightToLeft:true,state:'frozen',ySplit:1}]}); compare.columns=[{header:'الفرع',key:'branch',width:18},{header:'الكود',key:'code',width:14},{header:'العميل',key:'name',width:30},{header:'الهاتف',key:'phone',width:18},{header:'النسبة %',key:'rate',width:12},{header:'مشتريات الحالية',key:'cp',width:18},{header:'مشتريات السابقة',key:'pp',width:18},{header:'فرق المشتريات',key:'pd',width:18},{header:'نمو المشتريات %',key:'pg',width:17},{header:'نقاط الحالية',key:'cpts',width:17},{header:'نقاط السابقة',key:'ppts',width:17},{header:'فرق النقاط',key:'diff',width:17},{header:'نمو النقاط %',key:'growth',width:17},{header:'الاتجاه',key:'trend',width:15}];styleHeader(compare.getRow(1));compare.autoFilter={from:'A1',to:'N1'};
  rows.forEach((r,i)=>{const row=compare.addRow({branch:r.branch,code:r.customer_code,name:r.customer_name||'',phone:r.customer_phone||'',rate:r.cashback_rate,cp:r.current_purchases,pp:r.previous_purchases,pd:r.purchases_change,pg:r.purchases_growth_pct,cpts:r.current_points,ppts:r.previous_points,diff:r.points_change,growth:r.points_growth_pct,trend:TREND[r.trend]||r.trend});if(i%2)row.fill={type:'pattern',pattern:'solid',fgColor:{argb:C.light}};const tone=r.trend==='growing'?[C.greenBg,C.green]:r.trend==='new'?[C.blueBg,C.blue]:(r.trend==='declining'||r.trend==='inactive')?[C.redBg,C.red]:[C.amberBg,C.amber];row.getCell(14).fill={type:'pattern',pattern:'solid',fgColor:{argb:tone[0]}};row.getCell(14).font={bold:true,color:{argb:tone[1]}};});[5,9,13].forEach(n=>compare.getColumn(n).numFmt='0.00"%"');[6,7,8,10,11,12].forEach(n=>compare.getColumn(n).numFmt='#,##0.00');compare.getColumn(2).numFmt='@';compare.getColumn(4).numFmt='@';

  const movers=wb.addWorksheet('أهم التغيرات',{views:[{rightToLeft:true}]});movers.columns=[16,18,14,30,18,18,18,18].map(width=>({width}));movers.addRow(['التصنيف','الفرع','الكود','العميل','نقاط الحالية','نقاط السابقة','فرق النقاط','نمو النقاط %']);styleHeader(movers.getRow(1));const grow=[...rows].filter(r=>r.points_change>0).sort((a,b)=>b.points_change-a.points_change).slice(0,50),decline=[...rows].filter(r=>r.points_change<0).sort((a,b)=>a.points_change-b.points_change).slice(0,50);[...grow.map(r=>['أعلى نمو',r] as const),...decline.map(r=>['أكبر تراجع',r] as const)].forEach(([l,r])=>movers.addRow([l,r.branch,r.customer_code,r.customer_name||'',r.current_points,r.previous_points,r.points_change,r.points_growth_pct]));movers.getColumn(8).numFmt='0.00"%"';

  const guide=wb.addWorksheet('دليل التقرير',{views:[{rightToLeft:true}]});guide.columns=[{width:28},{width:82}];guide.addRows([['البند','التعريف'],['النطاق',branchLabel],['الدورة التحليلية الحالية',`${p.current_start} → ${p.current_end}`],['الدورة التحليلية السابقة',`${p.previous_start} → ${p.previous_end}`],['عملاء الدورة الحالية','Snapshot التشغيل الكامل للفرع، غير متأثر بفلتر الشاشة أو الصفحة الحالية.'],['نمو النقاط','(الحالية - السابقة) ÷ السابقة × 100.'],['تم التعامل','تم تبليغه أو حدث له سحب/تسوية.'],['سرعة الإنجاز','من إغلاق الدورة حتى تسجيل التبليغ/التسوية بتوقيت القاهرة.'],['المقارنة السابقة','مقارنة النمو تستخدم دورات 3 شهور متساوية. مقارنة الأداء التشغيلي تبدأ من أول دورة رسمية موثوقة.'],['مصدر البيانات','Snapshots دورية ثابتة؛ لا يعاد حساب الفواتير عند فتح التقرير.']]);styleHeader(guide.getRow(1));

  const buffer=await wb.xlsx.writeBuffer(); download(buffer as ArrayBuffer,`تقرير_نقاط_العملاء_تنفيذي_${safeFilename(branchLabel)}_${p.current_end||'current'}.xlsx`);
}
