const fs = require('node:fs');
const path = require('node:path');

const filePath = path.join(process.cwd(), 'src/pages/CustomerCashback.tsx');
let source = fs.readFileSync(filePath, 'utf8');
let changed = false;

function replaceOnce(before, after, label) {
  if (source.includes(after)) return;
  if (!source.includes(before)) {
    console.log(`[cashback-safety] skipped ${label}: anchor not found`);
    return;
  }
  source = source.replace(before, after);
  changed = true;
  console.log(`[cashback-safety] applied ${label}`);
}

replaceOnce(
  "  const base =\n    'inline-flex items-center justify-center gap-1 rounded-xl border px-2.5 py-1.5 text-xs font-black transition hover:scale-[1.01]';\n  return (",
  "  const base =\n    'inline-flex items-center justify-center gap-1 rounded-xl border px-2.5 py-1.5 text-xs font-black text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0';\n  const activeRate = Number(row.cashback_rate || 0);\n  const alreadyDoubled = /cashback_doubled_once|تمت مضاعفة الكاش باك/i.test(String(row.notes || ''));\n  const fullySettled = remaining(row) <= 0 || String(row.status || '') === 'settled';\n  return (",
  'action state helpers'
);

const colorReplacements = [
  ['border-slate-400/50 bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-white', 'border-slate-400/50 bg-slate-700 text-white hover:bg-slate-600'],
  ['border-emerald-300/70 bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-50', 'border-emerald-300/50 bg-emerald-700 text-white hover:bg-emerald-600'],
  ['border-teal-300/70 bg-teal-100 text-teal-900 dark:bg-teal-500/20 dark:text-teal-50', 'border-teal-300/50 bg-teal-700 text-white hover:bg-teal-600'],
  ['border-violet-300/70 bg-violet-100 text-violet-900 dark:bg-violet-500/20 dark:text-violet-50', 'border-violet-300/50 bg-violet-700 text-white hover:bg-violet-600'],
  ['border-amber-300/70 bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-50', 'border-amber-300/50 bg-amber-700 text-white hover:bg-amber-600'],
  ['border-lime-300/70 bg-lime-100 text-lime-900 dark:bg-lime-500/20 dark:text-lime-50', "${activeRate === 3 ? 'border-lime-200 bg-lime-600 ring-2 ring-lime-200/60' : 'border-lime-300/50 bg-lime-800 hover:bg-lime-700'} text-white"],
  ['border-cyan-300/70 bg-cyan-100 text-cyan-900 dark:bg-cyan-500/20 dark:text-cyan-50', "${activeRate === 5 ? 'border-cyan-200 bg-cyan-600 ring-2 ring-cyan-200/60' : 'border-cyan-300/50 bg-cyan-800 hover:bg-cyan-700'} text-white"],
  ['border-fuchsia-300/70 bg-fuchsia-100 text-fuchsia-900 dark:bg-fuchsia-500/20 dark:text-fuchsia-50', 'border-fuchsia-300/50 bg-fuchsia-700 text-white hover:bg-fuchsia-600'],
  ['border-indigo-300/70 bg-indigo-100 text-indigo-900 dark:bg-indigo-500/20 dark:text-indigo-50', 'border-indigo-300/50 bg-indigo-700 text-white hover:bg-indigo-600'],
  ['border-sky-300/70 bg-sky-100 text-sky-900 dark:bg-sky-500/20 dark:text-sky-50', 'border-sky-300/50 bg-sky-700 text-white hover:bg-sky-600'],
  ['border-slate-300/70 bg-slate-100 text-slate-900 dark:bg-slate-700 dark:text-white', 'border-slate-400/50 bg-slate-700 text-white hover:bg-slate-600'],
];
for (const [before, after] of colorReplacements) {
  if (source.includes(before)) {
    source = source.split(before).join(after);
    changed = true;
  }
}

replaceOnce(
  "        onClick={() => setCustomerCashbackRate(row, 3)}\n      >",
  "        disabled={activeRate === 3}\n        onClick={() => setCustomerCashbackRate(row, 3)}\n      >",
  'disable current 3 percent rate'
);
replaceOnce(
  "        onClick={() => setCustomerCashbackRate(row, 5)}\n      >",
  "        disabled={activeRate === 5}\n        onClick={() => setCustomerCashbackRate(row, 5)}\n      >",
  'disable current 5 percent rate'
);
replaceOnce(
  "        onClick={() => multiply(row)}\n      >",
  "        disabled={alreadyDoubled}\n        title={alreadyDoubled ? 'تمت مضاعفة نقاط هذه الدورة بالفعل' : 'مضاعفة النقاط مرة واحدة فقط'}\n        onClick={() => multiply(row)}\n      >",
  'disable repeated multiply'
);
replaceOnce(
  "        onClick={() =>\n          updateRow(",
  "        disabled={fullySettled}\n        onClick={() =>\n          updateRow(",
  'disable settled action'
);

replaceOnce(
  "async function logCashbackEvent(\n  row: CashbackRow,\n  eventType: string,\n  amount?: number,\n  notes?: string\n) {\n  await supabase.from('customer_cashback_events').insert({\n    cycle_id: row.id,\n    customer_code: row.customer_code,\n    event_type: eventType,\n    amount: amount ?? null,\n    notes: notes ?? null,\n  });\n}",
  "async function logCashbackEvent(\n  row: CashbackRow,\n  eventType: string,\n  amount?: number,\n  notes?: string\n) {\n  const { error } = await supabase.from('customer_cashback_events').insert({\n    cycle_id: row.id,\n    customer_code: row.customer_code,\n    event_type: eventType,\n    amount: amount ?? null,\n    notes: notes ?? null,\n  });\n  if (error) throw error;\n}",
  'event error handling'
);

replaceOnce(
  "  const updateRow = async (\n    row: CashbackRow,\n    patch: Partial<CashbackRow>,\n    eventType: string,\n    amount?: number,\n    notes?: string\n  ): Promise<void> => {\n    const nextPatch = { ...patch, notes: patch.notes ?? row.notes };\n    const { error } = await supabase\n      .from('customer_cashback_cycles')\n      .update({ ...nextPatch, updated_at: new Date().toISOString() })\n      .eq('id', row.id);\n    if (error) {\n      toast.error(error.message);\n      return;\n    }\n    patchLocalRow(row.id, nextPatch);\n    await logCashbackEvent(row, eventType, amount, notes);\n    toast.success('تم تحديث حالة الكاش باك');\n  };",
  "  const updateRow = async (\n    row: CashbackRow,\n    patch: Partial<CashbackRow>,\n    eventType: string,\n    amount?: number,\n    notes?: string\n  ): Promise<void> => {\n    const { data: latest, error: latestError } = await supabase\n      .from('customer_cashback_cycles')\n      .select('id,total_spent,cashback_rate,cashback_value,redeemed_value,remaining_value,status,notes')\n      .eq('id', row.id)\n      .maybeSingle();\n    if (latestError) { toast.error(latestError.message); return; }\n    const current = { ...row, ...(latest || {}) } as CashbackRow;\n    const nextPatch = { ...patch, notes: patch.notes ?? current.notes };\n    const nextCashback = Number(nextPatch.cashback_value ?? current.cashback_value ?? 0);\n    const nextRedeemed = Number(nextPatch.redeemed_value ?? current.redeemed_value ?? 0);\n    if (!Number.isFinite(nextCashback) || nextCashback < 0 || !Number.isFinite(nextRedeemed) || nextRedeemed < 0) {\n      toast.error('قيمة النقاط أو المسحوبات غير صحيحة');\n      return;\n    }\n    if (nextRedeemed > nextCashback) {\n      toast.error('لا يمكن سحب قيمة أكبر من رصيد النقاط المستحق');\n      return;\n    }\n    const hasChange = Object.entries(nextPatch).some(([key, value]) => String((current as Record<string, unknown>)[key] ?? '') !== String(value ?? ''));\n    if (!hasChange) { toast.info('لا يوجد تغيير جديد ليتم حفظه'); return; }\n    const { error } = await supabase\n      .from('customer_cashback_cycles')\n      .update({ ...nextPatch, updated_at: new Date().toISOString() })\n      .eq('id', row.id);\n    if (error) { toast.error(error.message); return; }\n    try {\n      await logCashbackEvent(current, eventType, amount, notes);\n    } catch (eventError) {\n      toast.warning(`تم تحديث الرصيد لكن تعذر تسجيل الحدث: ${(eventError as Error).message}`);\n    }\n    patchLocalRow(row.id, nextPatch);\n    toast.success('تم تحديث النقاط بنجاح');\n  };",
  'safe latest-row update'
);

replaceOnce(
  "  const setCustomerCashbackRate = async (row: CashbackRow, rate: 3 | 5) => {\n    if (!row.customer_code) {",
  "  const setCustomerCashbackRate = async (row: CashbackRow, rate: 3 | 5) => {\n    if (Number(row.cashback_rate || 0) === rate) { toast.info(`العميل بالفعل على نظام ${rate}%`); return; }\n    if (!row.customer_code) {",
  'prevent duplicate rate event'
);

replaceOnce(
  "  const recordRedeem = async (row: CashbackRow) => {\n    const value = Number(window.prompt('قيمة السحب من الكاش باك', '0') || 0);\n    if (!Number.isFinite(value) || value <= 0) return;\n    const newRedeemed = Number(row.redeemed_value || 0) + value;",
  "  const recordRedeem = async (row: CashbackRow) => {\n    const available = remaining(row);\n    if (available <= 0) { toast.info('لا يوجد رصيد متبقٍ للسحب'); return; }\n    const value = Number(window.prompt(`قيمة السحب من النقاط — المتاح ${available.toFixed(2)}`, '0') || 0);\n    if (!Number.isFinite(value) || value <= 0) return;\n    if (value > available) { toast.error('قيمة السحب أكبر من الرصيد المتاح'); return; }\n    const newRedeemed = Number(row.redeemed_value || 0) + value;",
  'cap partial redeem'
);

replaceOnce(
  "  const multiply = async (row: CashbackRow) => {\n    await updateRow(\n      row,\n      {\n        cashback_value: Number(row.cashback_value || 0) * 2,\n        notes: `${row.notes || ''}\\nتمت مضاعفة الكاش باك لعميل مميز`.trim(),\n      },",
  "  const multiply = async (row: CashbackRow) => {\n    if (/cashback_doubled_once|تمت مضاعفة الكاش باك/i.test(String(row.notes || ''))) {\n      toast.info('تمت مضاعفة نقاط هذه الدورة بالفعل');\n      return;\n    }\n    await updateRow(\n      row,\n      {\n        cashback_value: Number(row.cashback_value || 0) * 2,\n        notes: `${row.notes || ''}\\n[cashback_doubled_once] تمت مضاعفة الكاش باك لعميل مميز`.trim(),\n      },",
  'one-time multiply guard'
);

if (changed) fs.writeFileSync(filePath, source, 'utf8');

const required = [
  "const activeRate = Number(row.cashback_rate || 0)",
  "if (value > available)",
  "cashback_doubled_once",
  "لا يوجد تغيير جديد ليتم حفظه",
  "bg-cyan-800",
];
for (const marker of required) {
  if (!source.includes(marker)) throw new Error(`[cashback-safety] verification failed: ${marker}`);
}
console.log(`Customer cashback safety and colors verified. changed=${changed}`);
