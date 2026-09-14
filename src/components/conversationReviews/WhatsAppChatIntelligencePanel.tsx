import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileText, Sparkles, Upload } from 'lucide-react';
import { analyzeWhatsAppChat, type WhatsAppChatAnalysis } from '@/lib/conversationAnalysis/whatsappChatAnalyzer';
import { buildReviewSuggestionState, buildSmartReviewNotes } from '@/lib/conversationAnalysis/reviewSuggestionAdapter';

export type WhatsAppChatIntelligencePanelProps = {
  staffName?: string | null;
  customerName?: string | null;
  onApplySuggestion?: (payload: { analysis: WhatsAppChatAnalysis; reviewState: any; notes: string; rawText: string }) => void;
};

function secLabel(seconds: number | null) {
  if (seconds == null) return '-';
  if (seconds < 60) return `${seconds} ث`;
  return `${Math.round(seconds / 60)} د`;
}

export default function WhatsAppChatIntelligencePanel({ staffName, customerName, onApplySuggestion }: WhatsAppChatIntelligencePanelProps) {
  const [rawText, setRawText] = useState('');
  const [fileName, setFileName] = useState('');
  const [analysis, setAnalysis] = useState<WhatsAppChatAnalysis | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);

  const confidence = useMemo(() => analysis ? Math.round(analysis.overallConfidence * 100) : 0, [analysis]);

  const run = () => {
    if (!rawText.trim()) return;
    setAnalysis(analyzeWhatsAppChat(rawText, {
      staffNames: staffName ? [staffName] : undefined,
      customerNames: customerName ? [customerName] : undefined,
    }));
  };

  const handleFile = async (file?: File | null) => {
    if (!file) return;
    const text = await file.text();
    setFileName(file.name);
    setRawText(text);
    setAnalysis(analyzeWhatsAppChat(text, {
      staffNames: staffName ? [staffName] : undefined,
      customerNames: customerName ? [customerName] : undefined,
    }));
  };

  return <section dir="rtl" className="space-y-4 rounded-2xl border border-slate-700 bg-slate-950/25 p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <div className="flex items-center gap-2 text-lg font-black"><Sparkles size={18}/> تحليل شات واتساب فعلي</div>
        <p className="mt-1 text-xs font-bold text-slate-400">ارفع ملف Export Chat بصيغة TXT أو الصق المحادثة. التحليل يعطي اقتراحات وأدلة، ولا يعتمد أي تقييم نهائي بدون مراجعة بشرية.</p>
      </div>
      <label className="dawaa-button dawaa-button--secondary cursor-pointer flex items-center gap-2"><Upload size={16}/> رفع TXT<input className="hidden" type="file" accept=".txt,text/plain" onChange={(e) => void handleFile(e.target.files?.[0])}/></label>
    </div>

    {fileName && <div className="flex items-center gap-2 text-xs font-bold text-teal-200"><FileText size={14}/>{fileName}</div>}
    <textarea value={rawText} onChange={(e) => setRawText(e.target.value)} rows={8} className="w-full rounded-xl border border-slate-700 bg-slate-950/60 p-3 text-sm leading-7 text-white" placeholder="الصق هنا نص Export Chat من WhatsApp..."/>
    <button onClick={run} disabled={!rawText.trim()} className="dawaa-button dawaa-button--primary">تحليل المحادثة بالكامل</button>

    {analysis && <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="الرسائل" value={String(analysis.metrics.totalMessages)} />
        <Metric label="أول رد" value={secLabel(analysis.metrics.firstResponseSeconds)} />
        <Metric label="متوسط الرد" value={secLabel(analysis.metrics.averageResponseSeconds)} />
        <Metric label="ثقة التحليل" value={`${confidence}%`} />
        <Metric label="رسائل العميل" value={String(analysis.metrics.customerMessages)} />
        <Metric label="رسائل الموظف" value={String(analysis.metrics.staffMessages)} />
        <Metric label="وعد بالرجوع" value={String(analysis.metrics.promisedFollowups)} />
        <Metric label="لم يُستكمل" value={String(analysis.metrics.missedPromisedFollowups)} danger={analysis.metrics.missedPromisedFollowups > 0} />
      </div>

      {!!analysis.risks.length && <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3"><div className="mb-2 flex items-center gap-2 font-black text-amber-200"><AlertTriangle size={16}/> مخاطر تحتاج انتباه</div><ul className="space-y-1 text-sm">{analysis.risks.map((risk) => <li key={risk}>• {risk}</li>)}</ul></div>}
      {!!analysis.positives.length && <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3"><div className="mb-2 flex items-center gap-2 font-black text-emerald-200"><CheckCircle2 size={16}/> نقاط قوة</div><div className="text-sm">{analysis.positives.join('، ')}</div></div>}

      <div className="space-y-2">
        <div className="font-black">تحليل كل بند</div>
        {analysis.criteria.map((item) => <div key={item.key} className="rounded-xl border border-slate-700 bg-slate-950/35">
          <button className="w-full p-3 text-right" onClick={() => setOpenKey(openKey === item.key ? null : item.key)}>
            <div className="flex flex-wrap items-center justify-between gap-2"><div className="font-black">{item.label}</div><div className="flex items-center gap-2 text-xs font-black"><span>{item.applies ? `${item.score ?? '-'}/${item.maxScore}` : 'لا ينطبق'}</span><span className="rounded-full border border-slate-600 px-2 py-0.5">ثقة {Math.round(item.confidence * 100)}%</span></div></div>
            <div className="mt-1 text-xs font-bold text-slate-400">{item.summary}</div>
          </button>
          {openKey === item.key && <div className="border-t border-slate-800 p-3 space-y-2">
            {item.evidence.map((ev, i) => <div key={i} className="rounded-lg bg-slate-900 p-2 text-xs leading-6"><div className="mb-1 font-black text-slate-300">الدليل من الشات</div>{ev.excerpt}</div>)}
            {!item.evidence.length && <div className="text-xs text-slate-400">لا يوجد دليل نصي قوي؛ يحتاج مراجعة بشرية.</div>}
            {!!item.suggestions.length && <div className="text-xs text-amber-200">{item.suggestions.join(' | ')}</div>}
          </div>}
        </div>)}
      </div>

      {!!analysis.manualReviewReasons.length && <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-3 text-sm"><div className="font-black text-red-200 mb-1">لا يعتمد تلقائيًا قبل مراجعة</div>{analysis.manualReviewReasons.join(' | ')}</div>}

      {onApplySuggestion && <button onClick={() => onApplySuggestion({ analysis, reviewState: buildReviewSuggestionState(analysis), notes: buildSmartReviewNotes(analysis), rawText })} className="dawaa-button dawaa-button--primary w-full">استخدام التحليل كاقتراح داخل نموذج التقييم</button>}
    </div>}
  </section>;
}

function Metric({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return <div className={`rounded-xl border p-3 ${danger ? 'border-red-500/30 bg-red-500/5' : 'border-slate-700 bg-slate-950/30'}`}><div className="text-xs text-slate-400">{label}</div><div className={`mt-1 text-xl font-black ${danger ? 'text-red-200' : 'text-white'}`}>{value}</div></div>;
}
