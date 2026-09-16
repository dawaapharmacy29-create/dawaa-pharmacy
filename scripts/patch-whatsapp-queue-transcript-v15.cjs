const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/pages/WhatsAppReviewQueueV4.tsx');
let src = fs.readFileSync(file, 'utf8');

function patch(label, from, to) {
  if (src.includes(to)) { console.log(`[whatsapp-queue-transcript-v15] ${label}: already applied`); return; }
  if (!src.includes(from)) throw new Error(`[whatsapp-queue-transcript-v15] ${label}: anchor not found`);
  src = src.replace(from, to);
  console.log(`[whatsapp-queue-transcript-v15] ${label}: applied`);
}

patch(
  'import structured transcript',
  `import { useAuth } from '@/hooks/useAuth';`,
  `import { useAuth } from '@/hooks/useAuth';\nimport WhatsAppStructuredTranscriptV15 from '@/components/reviews/WhatsAppStructuredTranscriptV15';`
);

patch(
  'replace raw pre with structured transcript',
  `            <section className="dawaa-card dawaa-card--soft p-4"><div className="flex items-center gap-2 font-black text-white"><FileText size={17}/>النص الأصلي</div><pre className="mt-3 max-h-[420px] overflow-auto whitespace-pre-wrap rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-xs leading-6 text-slate-300">{selected.raw_text || 'لا يوجد نص محفوظ.'}</pre></section>`,
  `            <section className="dawaa-card dawaa-card--soft p-4"><div className="flex items-center gap-2 font-black text-white"><FileText size={17}/>المحادثة الأصلية المنظمة</div><div className="mt-2 text-[10px] text-slate-500">نفس ترتيب الرسائل والمرسل والوقت والردود المقتبسة، مع تمييز دور المرسل والميديا عندما تكون مذكورة في التصدير.</div><div className="mt-3"><WhatsAppStructuredTranscriptV15 rawText={selected.raw_text} participantRoles={selected.analysis_json?.participantRoles || null} /></div></section>`
);

fs.writeFileSync(file, src);
console.log('[whatsapp-queue-transcript-v15] structured queue transcript applied successfully');
require('./patch-whatsapp-journey-persistence-v15.cjs');
