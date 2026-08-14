const fs = require('fs');

function replaceOnce(src, oldText, newText, label) {
  if (!src.includes(oldText)) throw new Error(`${label} anchor not found`);
  return src.replace(oldText, newText);
}

// API helper
{
  const file = 'src/lib/api/customerRequests.ts';
  let src = fs.readFileSync(file, 'utf8');
  const anchor = `export async function updateCustomerRequestDetails(\n`;
  const helper = `export type CustomerRequestContactOutcome = 'answered' | 'no_answer' | 'later';\n\nexport async function recordCustomerRequestContactAttempt(\n  request: CustomerRequest,\n  input: {\n    outcome: CustomerRequestContactOutcome;\n    notes?: string | null;\n    user_id?: string | null;\n    user_name?: string | null;\n  }\n) {\n  requireSupabaseConfig();\n  const labels: Record<CustomerRequestContactOutcome, string> = {\n    answered: 'تم الرد',\n    no_answer: 'لم يرد',\n    later: 'تواصل لاحقًا',\n  };\n  const note = String(input.notes || '').trim();\n  if (input.outcome === 'later' && !note) throw new Error('اكتب موعد أو سبب التواصل لاحقًا');\n\n  const currentStatus = String(request.status || 'new');\n  const shouldAdvanceToContacted =\n    input.outcome === 'answered' && ['available', 'arrived'].includes(currentStatus);\n  const nextStatus = shouldAdvanceToContacted ? 'customer_contacted' : currentStatus;\n  const summaryLine = [\n    \`نتيجة التواصل: \${labels[input.outcome]}\`,\n    note ? \`ملاحظة: \${note}\` : '',\n    \`بواسطة: \${input.user_name || 'النظام'}\`,\n  ].filter(Boolean).join(' — ');\n  const previousSummary = String(request.contact_summary || '').trim();\n  const contactSummary = previousSummary ? \`${summaryLine}\\n\${previousSummary}\` : summaryLine;\n\n  const payload: Record<string, unknown> = {\n    status: nextStatus,\n    contact_summary: contactSummary,\n    updated_at: new Date().toISOString(),\n    last_action_at: new Date().toISOString(),\n  };\n  if (input.outcome === 'answered') payload.customer_contacted_by_name = input.user_name || null;\n\n  const updated = (await updateResilient('customer_requests', request.id, payload)) as CustomerRequest;\n  await addCustomerRequestEvent(request.id, {\n    old_status: request.status,\n    new_status: nextStatus,\n    action: 'تسجيل نتيجة تواصل مع العميل',\n    notes: summaryLine,\n    created_by: input.user_id,\n    created_by_name: input.user_name,\n  });\n  await logActivity({\n    action: 'تسجيل نتيجة تواصل طلب عميل',\n    module: 'طلبات العملاء',\n    target_type: 'customer_request',\n    target_id: request.id,\n    user_id: safeUuid(input.user_id) || undefined,\n    user_name: input.user_name || undefined,\n    branch_name: request.branch || undefined,\n    details: {\n      customer_name: request.customer_name,\n      customer_code: request.customer_code,\n      medicine_name: request.medicine_name,\n      outcome: input.outcome,\n      old_status: request.status,\n      new_status: nextStatus,\n      notes: note || null,\n    },\n  });\n  return updated;\n}\n\n`;
  src = replaceOnce(src, anchor, helper + anchor, 'API contact helper');
  fs.writeFileSync(file, src);
}

// Page UI
{
  const file = 'src/pages/CustomerRequests.tsx';
  let src = fs.readFileSync(file, 'utf8');

  src = replaceOnce(
    src,
    `  moveCustomerRequestToShortage,\n  requestStatusLabel,`,
    `  moveCustomerRequestToShortage,\n  recordCustomerRequestContactAttempt,\n  requestStatusLabel,`,
    'import helper'
  );

  src = replaceOnce(
    src,
    `  const [alternativeReason, setAlternativeReason] = useState('');\n  const [showCreate, setShowCreate] = useState(false);`,
    `  const [alternativeReason, setAlternativeReason] = useState('');\n  const [pendingContactResult, setPendingContactResult] = useState<CustomerRequest | null>(null);\n  const [contactResultNote, setContactResultNote] = useState('');\n  const [contactResultSavingId, setContactResultSavingId] = useState<string | null>(null);\n  const [showCreate, setShowCreate] = useState(false);`,
    'contact result state'
  );

  const altAnchor = `  const openAlternativeActions = (request: CustomerRequest) => {\n    setAlternativeReason('');\n    setPendingAlternative(request as RequestWithProduct);\n  };\n`;
  const contactHandlers = `${altAnchor}\n  const openContactResult = (request: CustomerRequest) => {\n    setContactResultNote('');\n    setPendingContactResult(request);\n  };\n\n  const saveContactResult = async (outcome: 'answered' | 'no_answer' | 'later') => {\n    if (!pendingContactResult) return;\n    if (outcome === 'later' && !contactResultNote.trim()) {\n      toast.error('اكتب موعد أو سبب التواصل لاحقًا');\n      return;\n    }\n    const request = pendingContactResult;\n    setContactResultSavingId(request.id);\n    try {\n      const updated = await recordCustomerRequestContactAttempt(request, {\n        outcome,\n        notes: contactResultNote.trim() || null,\n        user_id: user?.id,\n        user_name: user?.name,\n      });\n      setRequests((current) => current.map((item) => item.id === updated.id ? updated : item));\n      setSelected((current) => current?.id === updated.id ? updated : current);\n      setPendingContactResult(null);\n      setContactResultNote('');\n      const label = outcome === 'answered' ? 'تم الرد' : outcome === 'no_answer' ? 'لم يرد' : 'تواصل لاحقًا';\n      toast.success(updated.status === 'customer_contacted' && request.status !== updated.status ? \`تم تسجيل \${label} ونقل الطلب إلى تم التواصل\` : \`تم تسجيل نتيجة التواصل: \${label}\`);\n      await load();\n    } catch (error) {\n      toast.error(\`تعذر تسجيل نتيجة التواصل: \${(error as Error).message}\`);\n    } finally {\n      setContactResultSavingId(null);\n    }\n  };\n`;
  src = replaceOnce(src, altAnchor, contactHandlers, 'contact result handlers');

  const modalAnchor = `      {pendingAlternative && (`;
  const contactModal = `      {pendingContactResult && (\n        <div className="fixed inset-0 z-[133] flex items-center justify-center bg-slate-950/85 p-3 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget && !contactResultSavingId) setPendingContactResult(null); }}>\n          <section className="w-full max-w-xl overflow-hidden rounded-[26px] border border-emerald-400/25 bg-[#091a2d] shadow-2xl">\n            <header className="flex items-start justify-between gap-4 border-b border-slate-700 bg-gradient-to-l from-emerald-500/10 to-cyan-500/[0.06] px-5 py-4">\n              <div className="flex min-w-0 items-start gap-3"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-400/25"><MessageCircle size={21} /></span><div><div className="text-lg font-black text-white">تسجيل نتيجة التواصل</div><p className="mt-1 text-xs font-bold leading-6 text-slate-400">سجّل النتيجة فورًا بعد المكالمة أو واتساب بدون فتح تفاصيل الطلب.</p></div></div>\n              <button type="button" disabled={Boolean(contactResultSavingId)} className="rounded-xl border border-slate-600 bg-slate-900 p-2 text-slate-300 hover:text-white disabled:opacity-50" onClick={() => setPendingContactResult(null)} aria-label="إغلاق نتيجة التواصل"><X size={18} /></button>\n            </header>\n            <div className="space-y-4 p-5">\n              <div className="grid grid-cols-2 gap-2 text-xs"><div className="rounded-xl bg-slate-950/55 p-3"><span className="block text-[10px] font-bold text-slate-500">العميل</span><strong className="mt-1 block truncate text-white">{pendingContactResult.customer_name || 'غير محدد'}</strong></div><div className="rounded-xl bg-slate-950/55 p-3"><span className="block text-[10px] font-bold text-slate-500">الحالة الحالية</span><strong className="mt-1 block text-cyan-200">{requestStatusLabel(pendingContactResult.status)}</strong></div><div className="col-span-2 rounded-xl bg-slate-950/55 p-3"><span className="block text-[10px] font-bold text-slate-500">الصنف</span><strong className="mt-1 block text-white">{pendingContactResult.medicine_name}</strong><span className="mt-1 block text-[10px] text-slate-500">{displayEgyptianPhone(pendingContactResult.customer_phone || '') || 'بدون رقم هاتف'}</span></div></div>\n              {['available', 'arrived'].includes(String(pendingContactResult.status || '')) && <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/[0.07] px-3 py-2 text-[11px] font-bold leading-6 text-emerald-100"><CheckCircle2 size={15} className="ml-1 inline" /> اختيار «تم الرد» هنا سينقل الطلب تلقائيًا إلى مرحلة «تم التواصل» لأن الصنف جاهز بالفعل.</div>}\n              <div className="grid gap-2 sm:grid-cols-3">\n                <button type="button" disabled={Boolean(contactResultSavingId)} onClick={() => void saveContactResult('answered')} className="flex min-h-20 flex-col items-center justify-center gap-2 rounded-2xl border border-emerald-400/25 bg-emerald-500/10 p-3 text-emerald-100 transition hover:bg-emerald-500/20 disabled:opacity-60"><CheckCircle2 size={21} /><strong className="text-xs">تم الرد</strong></button>\n                <button type="button" disabled={Boolean(contactResultSavingId)} onClick={() => void saveContactResult('no_answer')} className="flex min-h-20 flex-col items-center justify-center gap-2 rounded-2xl border border-orange-400/25 bg-orange-500/10 p-3 text-orange-100 transition hover:bg-orange-500/20 disabled:opacity-60"><Phone size={21} /><strong className="text-xs">لم يرد</strong></button>\n                <button type="button" disabled={Boolean(contactResultSavingId) || !contactResultNote.trim()} onClick={() => void saveContactResult('later')} className="flex min-h-20 flex-col items-center justify-center gap-2 rounded-2xl border border-violet-400/25 bg-violet-500/10 p-3 text-violet-100 transition hover:bg-violet-500/20 disabled:cursor-not-allowed disabled:opacity-40"><Clock3 size={21} /><strong className="text-xs">تواصل لاحقًا</strong></button>\n              </div>\n              <div className="rounded-2xl border border-slate-700 bg-slate-950/35 p-3"><label className="text-[11px] font-black text-slate-300">ملاحظة سريعة <span className="text-slate-600">— مطلوبة لتواصل لاحقًا</span></label><textarea className="input-dark mt-2 min-h-20 w-full resize-y text-xs" placeholder="مثال: لم يرد — إعادة المحاولة مساءً / طلب الاتصال غدًا الساعة 2..." value={contactResultNote} onChange={(event) => setContactResultNote(event.target.value)} /></div>\n            </div>\n            <footer className="flex items-center justify-between gap-3 border-t border-slate-700 bg-slate-950/30 p-4 text-[10px] font-bold text-slate-500"><span>كل نتيجة تُحفظ في سجل أحداث الطلب.</span>{contactResultSavingId && <span className="flex items-center gap-1 text-cyan-200"><Loader2 size={13} className="animate-spin" /> جاري الحفظ...</span>}</footer>\n          </section>\n        </div>\n      )}\n\n`;
  src = replaceOnce(src, modalAnchor, contactModal + modalAnchor, 'contact result modal');

  src = replaceOnce(
    src,
    `: viewMode === 'table' ? <RequestTable requests={requests} page={page} pageSize={pageSize} onSelect={openDetails} onAdvance={(request) => void advanceRequestFromCard(request)} onAlternative={openAlternativeActions} advancingId={advancingId} />\n              : <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">{requests.map((request) => <RequestCard key={request.id} request={request as RequestWithProduct} onSelect={() => openDetails(request)} onAdvance={() => void advanceRequestFromCard(request)} onAlternative={() => openAlternativeActions(request)} advancing={advancingId === request.id} />)}</div>}`,
    `: viewMode === 'table' ? <RequestTable requests={requests} page={page} pageSize={pageSize} onSelect={openDetails} onAdvance={(request) => void advanceRequestFromCard(request)} onAlternative={openAlternativeActions} onContactResult={openContactResult} advancingId={advancingId} />\n              : <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">{requests.map((request) => <RequestCard key={request.id} request={request as RequestWithProduct} onSelect={() => openDetails(request)} onAdvance={() => void advanceRequestFromCard(request)} onAlternative={() => openAlternativeActions(request)} onContactResult={() => openContactResult(request)} advancing={advancingId === request.id} />)}</div>}`,
    'render contact result props'
  );

  src = replaceOnce(
    src,
    `function RequestCard({ request, onSelect, onAdvance, onAlternative, advancing }: { request: RequestWithProduct; onSelect: () => void; onAdvance: () => void; onAlternative: () => void; advancing: boolean }) {`,
    `function RequestCard({ request, onSelect, onAdvance, onAlternative, onContactResult, advancing }: { request: RequestWithProduct; onSelect: () => void; onAdvance: () => void; onAlternative: () => void; onContactResult: () => void; advancing: boolean }) {`,
    'card signature'
  );

  src = replaceOnce(
    src,
    `<button type="button" onClick={() => void copyRequestCustomerPhone(request)} className="flex items-center gap-1.5 rounded-xl border border-slate-600 bg-slate-900/70 px-3 py-2 text-[11px] font-black text-slate-300 transition hover:text-white" title="نسخ رقم العميل"><Copy size={14} /> نسخ الرقم</button>\n      </> : <span`,
    `<button type="button" onClick={() => void copyRequestCustomerPhone(request)} className="flex items-center gap-1.5 rounded-xl border border-slate-600 bg-slate-900/70 px-3 py-2 text-[11px] font-black text-slate-300 transition hover:text-white" title="نسخ رقم العميل"><Copy size={14} /> نسخ الرقم</button>\n        <button type="button" onClick={onContactResult} className="flex items-center gap-1.5 rounded-xl border border-violet-400/20 bg-violet-500/[0.08] px-3 py-2 text-[11px] font-black text-violet-100 transition hover:bg-violet-500/15" title="تسجيل نتيجة التواصل"><CheckCircle2 size={14} /> سجل النتيجة</button>\n      </> : <span`,
    'card contact result button'
  );

  src = replaceOnce(
    src,
    `function RequestTable({ requests, page, pageSize, onSelect, onAdvance, onAlternative, advancingId }: { requests: CustomerRequest[]; page: number; pageSize: number; onSelect: (request: CustomerRequest) => void; onAdvance: (request: CustomerRequest) => void; onAlternative: (request: CustomerRequest) => void; advancingId: string | null }) {`,
    `function RequestTable({ requests, page, pageSize, onSelect, onAdvance, onAlternative, onContactResult, advancingId }: { requests: CustomerRequest[]; page: number; pageSize: number; onSelect: (request: CustomerRequest) => void; onAdvance: (request: CustomerRequest) => void; onAlternative: (request: CustomerRequest) => void; onContactResult: (request: CustomerRequest) => void; advancingId: string | null }) {`,
    'table signature'
  );

  src = replaceOnce(
    src,
    `<button type="button" onClick={() => callRequestCustomer(request)} className="flex h-9 w-9 items-center justify-center rounded-xl border border-sky-400/20 bg-sky-500/[0.08] text-sky-200 transition hover:bg-sky-500/15" title="اتصال"><Phone size={15} /></button></>}{!customerRequestIsClosed(request)`,
    `<button type="button" onClick={() => callRequestCustomer(request)} className="flex h-9 w-9 items-center justify-center rounded-xl border border-sky-400/20 bg-sky-500/[0.08] text-sky-200 transition hover:bg-sky-500/15" title="اتصال"><Phone size={15} /></button><button type="button" onClick={() => onContactResult(request)} className="flex h-9 w-9 items-center justify-center rounded-xl border border-violet-400/20 bg-violet-500/[0.08] text-violet-200 transition hover:bg-violet-500/15" title="تسجيل نتيجة التواصل"><CheckCircle2 size={15} /></button></>}{!customerRequestIsClosed(request)`,
    'table contact result button'
  );

  fs.writeFileSync(file, src);
}

console.log('Applied customer request contact results V16');
