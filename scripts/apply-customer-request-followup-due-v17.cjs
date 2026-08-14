const fs = require('fs');

function replaceOnce(src, oldText, newText, label) {
  if (!src.includes(oldText)) throw new Error(label + ' anchor not found');
  return src.replace(oldText, newText);
}

{
  const file = 'src/lib/api/customerRequests.ts';
  let src = fs.readFileSync(file, 'utf8');
  src = replaceOnce(src,
    "    notes?: string | null;\n    user_id?: string | null;",
    "    notes?: string | null;\n    followup_at?: string | null;\n    user_id?: string | null;",
    'api input');
  src = replaceOnce(src,
    "  if (input.outcome === 'later' && !note) throw new Error('اكتب موعد أو سبب التواصل لاحقًا');\n\n  const currentStatus",
    "  if (input.outcome === 'later' && !input.followup_at) throw new Error('حدد موعد التواصل القادم');\n  if (input.outcome === 'later' && !note) throw new Error('اكتب سبب أو ملاحظة للتواصل لاحقًا');\n  if (input.outcome === 'later' && input.followup_at && new Date(input.followup_at).getTime() <= Date.now()) throw new Error('موعد التواصل القادم يجب أن يكون في المستقبل');\n\n  const currentStatus",
    'api validation');
  src = replaceOnce(src,
    "    note ? 'ملاحظة: ' + note : '',\n    'بواسطة: '",
    "    note ? 'ملاحظة: ' + note : '',\n    input.outcome === 'later' && input.followup_at ? 'موعد المتابعة: ' + new Intl.DateTimeFormat('ar-EG', { timeZone: 'Africa/Cairo', dateStyle: 'short', timeStyle: 'short' }).format(new Date(input.followup_at)) : '',\n    'بواسطة: '",
    'api summary');
  src = replaceOnce(src,
    "    last_action_at: new Date().toISOString(),\n  };",
    "    last_action_at: new Date().toISOString(),\n    due_date: input.outcome === 'later' ? input.followup_at || request.due_date || null : request.due_date || null,\n  };",
    'api due date');
  src = replaceOnce(src,
    "      notes: note || null,\n    },",
    "      notes: note || null,\n      followup_at: input.followup_at || null,\n    },",
    'api log detail');
  fs.writeFileSync(file, src);
}

{
  const file = 'src/pages/CustomerRequests.tsx';
  let src = fs.readFileSync(file, 'utf8');
  src = replaceOnce(src,
    "  const [contactResultNote, setContactResultNote] = useState('');\n  const [contactResultSavingId, setContactResultSavingId] = useState<string | null>(null);",
    "  const [contactResultNote, setContactResultNote] = useState('');\n  const [contactFollowupAt, setContactFollowupAt] = useState('');\n  const [contactResultSavingId, setContactResultSavingId] = useState<string | null>(null);",
    'ui state');
  src = replaceOnce(src,
    "  const openContactResult = (request: CustomerRequest) => {\n    setContactResultNote('');\n    setPendingContactResult(request);\n  };",
    "  const openContactResult = (request: CustomerRequest) => {\n    setContactResultNote('');\n    const suggested = new Date(Date.now() + 2 * 60 * 60 * 1000);\n    const localSuggested = new Date(suggested.getTime() - suggested.getTimezoneOffset() * 60000).toISOString().slice(0, 16);\n    setContactFollowupAt(localSuggested);\n    setPendingContactResult(request);\n  };",
    'ui suggested due');
  src = replaceOnce(src,
    "    if (outcome === 'later' && !contactResultNote.trim()) {\n      toast.error('اكتب موعد أو سبب التواصل لاحقًا');\n      return;\n    }",
    "    if (outcome === 'later' && !contactFollowupAt) { toast.error('حدد موعد التواصل القادم'); return; }\n    if (outcome === 'later' && new Date(contactFollowupAt).getTime() <= Date.now()) { toast.error('موعد التواصل القادم يجب أن يكون في المستقبل'); return; }\n    if (outcome === 'later' && !contactResultNote.trim()) {\n      toast.error('اكتب سبب أو ملاحظة للتواصل لاحقًا');\n      return;\n    }",
    'ui validation');
  src = replaceOnce(src,
    "        notes: contactResultNote.trim() || null,\n        user_id: user?.id,",
    "        notes: contactResultNote.trim() || null,\n        followup_at: outcome === 'later' ? new Date(contactFollowupAt).toISOString() : null,\n        user_id: user?.id,",
    'ui save due');
  src = replaceOnce(src,
    "      setContactResultNote('');\n      const label = outcome === 'answered'",
    "      setContactResultNote('');\n      setContactFollowupAt('');\n      const label = outcome === 'answered'",
    'ui clear due');

  const helperAnchor = "function nextAction(request: CustomerRequest) {";
  const helper = "function followupDueLabel(request: CustomerRequest) {\n  if (!request.due_date || customerRequestIsClosed(request)) return null;\n  const due = new Date(request.due_date);\n  if (Number.isNaN(due.getTime())) return null;\n  const overdue = due.getTime() <= Date.now();\n  const text = new Intl.DateTimeFormat('ar-EG', { timeZone: 'Africa/Cairo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true }).format(due);\n  return { text: (overdue ? 'متابعة مستحقة: ' : 'متابعة: ') + text, overdue };\n}\n\n";
  src = replaceOnce(src, helperAnchor, helper + helperAnchor, 'ui due helper');
  src = replaceOnce(src,
    "  const advance = quickAdvanceAction(request);\n  const AdvanceIcon = advance?.icon;",
    "  const advance = quickAdvanceAction(request);\n  const followupDue = followupDueLabel(request);\n  const AdvanceIcon = advance?.icon;",
    'card due variable');
  src = replaceOnce(src,
    "    <div className={`mt-4 rounded-2xl border px-4 py-3 text-sm font-black ${overdue ? 'border-red-400/25 bg-red-500/10 text-red-100' : 'border-cyan-400/20 bg-cyan-500/[0.07] text-cyan-100'}`}>الخطوة التالية: {nextAction(request)}</div>",
    "    {followupDue && <div className={`mt-3 flex items-center gap-2 rounded-2xl border px-3 py-2 text-xs font-black ${followupDue.overdue ? 'border-red-400/30 bg-red-500/10 text-red-100' : 'border-violet-400/25 bg-violet-500/10 text-violet-100'}`}><Clock3 size={15} /> {followupDue.text}</div>}\n    <div className={`mt-4 rounded-2xl border px-4 py-3 text-sm font-black ${overdue ? 'border-red-400/25 bg-red-500/10 text-red-100' : 'border-cyan-400/20 bg-cyan-500/[0.07] text-cyan-100'}`}>الخطوة التالية: {nextAction(request)}</div>",
    'card due badge');
  src = replaceOnce(src,
    "<td className=\"px-3 py-3 text-white\">{request.customer_name || 'غير محدد'}<div className=\"mt-1 text-[10px] text-slate-500\">{request.customer_code || '—'}</div></td>",
    "<td className=\"px-3 py-3 text-white\">{request.customer_name || 'غير محدد'}<div className=\"mt-1 text-[10px] text-slate-500\">{request.customer_code || '—'}</div>{followupDueLabel(request) && <div className={`mt-1 text-[10px] font-black ${followupDueLabel(request)?.overdue ? 'text-red-300' : 'text-violet-300'}`}>{followupDueLabel(request)?.text}</div>}</td>",
    'table due badge');
  src = replaceOnce(src,
    "              <div className=\"rounded-2xl border border-slate-700 bg-slate-950/35 p-3\"><label className=\"text-[11px] font-black text-slate-300\">ملاحظة سريعة <span className=\"text-slate-600\">— مطلوبة لتواصل لاحقًا</span></label><textarea",
    "              <div className=\"grid gap-3 sm:grid-cols-2\"><label className=\"rounded-2xl border border-violet-400/20 bg-violet-500/[0.06] p-3 text-[11px] font-black text-violet-100\">موعد التواصل القادم<input type=\"datetime-local\" className=\"input-dark mt-2 w-full\" value={contactFollowupAt} onChange={(event) => setContactFollowupAt(event.target.value)} /></label><div className=\"rounded-2xl border border-cyan-400/15 bg-cyan-500/[0.05] p-3 text-[11px] font-bold leading-6 text-cyan-100\">عند اختيار «تواصل لاحقًا» سيتم حفظ الموعد على الطلب ويظهر كتذكير واضح في الكارت والجدول.</div></div>\n              <div className=\"rounded-2xl border border-slate-700 bg-slate-950/35 p-3\"><label className=\"text-[11px] font-black text-slate-300\">ملاحظة سريعة <span className=\"text-slate-600\">— مطلوبة لتواصل لاحقًا</span></label><textarea",
    'ui datetime');
  src = replaceOnce(src,
    "disabled={Boolean(contactResultSavingId) || !contactResultNote.trim()} onClick={() => void saveContactResult('later')}",
    "disabled={Boolean(contactResultSavingId) || !contactResultNote.trim() || !contactFollowupAt} onClick={() => void saveContactResult('later')}",
    'later guard');
  fs.writeFileSync(file, src);
}
