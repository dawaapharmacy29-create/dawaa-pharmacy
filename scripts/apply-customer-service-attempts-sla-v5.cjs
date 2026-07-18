const fs = require('node:fs');

const filePath = 'src/components/customerService/UnifiedCustomerServiceWorkspace.tsx';
let source = fs.readFileSync(filePath, 'utf8');
const marker = "@/lib/customerServiceAttempts";

if (source.includes(marker)) {
  console.log('Customer service attempts and SLA v5 already applied.');
  process.exit(0);
}

function replaceOnce(search, replacement, label) {
  if (!source.includes(search)) {
    console.warn(`customer service attempts/SLA skipped: ${label}`);
    return false;
  }
  source = source.replace(search, replacement);
  return true;
}

const imported = replaceOnce(
  `import type { DailyFollowup } from '@/types/database';`,
  `import type { DailyFollowup } from '@/types/database';\nimport { contactAttemptLabel, getFollowupSla, recordContactAttempt, type ContactAttemptType } from '@/lib/customerServiceAttempts';`,
  'attempt imports'
);

const handler = replaceOnce(
  `  async function saveResult(data: FollowupResultData) {`,
  `  async function saveContactAttempt(item: QueueItem, attemptType: ContactAttemptType) {\n    try {\n      const followup = await ensureFollowup(item);\n      const notes = attemptType === 'callback_requested' ? window.prompt('اكتب الموعد أو ملاحظة طلب العميل:') || '' : '';\n      const result = await recordContactAttempt({\n        followupId: followup.id,\n        queueItemId: item.queueItemId || null,\n        attemptType,\n        notes: notes || null,\n        actorStaffId: user?.staff_id || user?.id || null,\n        actorName: user?.name || null,\n      });\n      toast.success(\`تم تسجيل المحاولة رقم \${result.attemptCount}: \${result.label}\`);\n      setQueue((current) => current.map((row) => row.key === item.key ? { ...row, status: result.label } : row));\n      await loadWorkspace();\n    } catch (error) {\n      toast.error(\`تعذر تسجيل المحاولة: \${(error as Error).message}\`);\n    }\n  }\n\n  async function saveResult(data: FollowupResultData) {`,
  'attempt handler'
);

const slaHelper = replaceOnce(
  `  const visibleQueue = filteredQueue.filter((item) => tab === 'doctor-requests' ? item.source === 'doctor_request' : tab === 'care' ? ['important', 'at_risk'].includes(item.source) : true);`,
  `  const visibleQueue = filteredQueue.filter((item) => tab === 'doctor-requests' ? item.source === 'doctor_request' : tab === 'care' ? ['important', 'at_risk'].includes(item.source) : true);\n  const slaFor = (item: QueueItem) => getFollowupSla({\n    source: item.source,\n    priority: item.priority,\n    createdAt: item.row?.created_at || item.row?.date || item.row?.followup_date || null,\n    startedAt: item.row?.first_attempt_at || null,\n    completed: item.completed,\n  });`,
  'SLA helper'
);

const listBadge = replaceOnce(
  `<Badge>{sourceLabel(item.source)}</Badge></div><div className="mt-2 line-clamp-2 text-xs font-bold text-slate-300">{item.reason}</div></button>)}`,
  `<div className="flex flex-col items-end gap-1"><Badge>{sourceLabel(item.source)}</Badge><span className={\`rounded-lg px-2 py-1 text-[10px] font-black \${slaFor(item).state === 'overdue' ? 'bg-red-500/20 text-red-200' : slaFor(item).state === 'warning' ? 'bg-amber-500/20 text-amber-200' : slaFor(item).state === 'completed' ? 'bg-emerald-500/20 text-emerald-200' : 'bg-teal-500/15 text-teal-200'}\`}>{slaFor(item).label}</span></div></div><div className="mt-2 line-clamp-2 text-xs font-bold text-slate-300">{item.reason}</div></button>)}`,
  'queue SLA badge'
);

const actions = replaceOnce(
  `<div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4"><button className="btn-primary" onClick={() => void openResult(selected)}>تسجيل نتيجة</button><button className="btn-secondary" disabled={!selected.phone} onClick={() => selected.phone && window.open(generateWhatsAppLink(selected.phone, scriptFor(selected)), '_blank')}>واتساب</button><a className="btn-secondary text-center" href={selected.phone ? \`tel:\${selected.phone}\` : undefined}>اتصال</a><button className="btn-secondary" onClick={() => setQuickOpen(true)}>إضافة ملاحظة/متابعة</button></div>`,
  `<div className="rounded-2xl border border-white/10 bg-white/5 p-4"><div className="mb-3 text-xs font-black text-slate-300">تسجيل محاولة تواصل سريعة</div><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3"><button className="btn-secondary" onClick={() => void saveContactAttempt(selected, 'call_no_answer')}>اتصال ولم يرد</button><button className="btn-secondary" onClick={() => void saveContactAttempt(selected, 'whatsapp_sent')}>تم إرسال واتساب</button><button className="btn-secondary" onClick={() => void saveContactAttempt(selected, 'phone_off')}>الهاتف مغلق</button><button className="btn-secondary" onClick={() => void saveContactAttempt(selected, 'invalid_number')}>الرقم غير صحيح</button><button className="btn-secondary" onClick={() => void saveContactAttempt(selected, 'callback_requested')}>طلب التواصل لاحقًا</button><button className="btn-primary" onClick={() => void saveContactAttempt(selected, 'connected')}>تم التواصل بنجاح</button></div></div><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4"><button className="btn-primary" onClick={() => void openResult(selected)}>تسجيل نتيجة</button><button className="btn-secondary" disabled={!selected.phone} onClick={() => selected.phone && window.open(generateWhatsAppLink(selected.phone, scriptFor(selected)), '_blank')}>واتساب</button><a className="btn-secondary text-center" href={selected.phone ? \`tel:\${selected.phone}\` : undefined}>اتصال</a><button className="btn-secondary" onClick={() => setQuickOpen(true)}>إضافة ملاحظة/متابعة</button></div>`,
  'attempt quick actions'
);

if (imported && handler && slaHelper && listBadge && actions) {
  fs.writeFileSync(filePath, source);
  console.log('Customer service attempts and SLA v5 applied.');
} else {
  console.warn('Customer service attempts/SLA v5 was not fully applied; source left unchanged.');
}
