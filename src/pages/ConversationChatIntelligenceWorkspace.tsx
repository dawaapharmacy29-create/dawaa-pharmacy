import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart3, FileText, Plus, Sparkles, Trash2 } from 'lucide-react';
import WhatsAppChatIntelligencePanel from '@/components/conversationReviews/WhatsAppChatIntelligencePanel';
import { analyzeWhatsAppChat, type WhatsAppChatAnalysis } from '@/lib/conversationAnalysis/whatsappChatAnalyzer';
import { buildConversationPortfolioSummary, type ConversationPortfolioItem } from '@/lib/conversationAnalysis/conversationPortfolioAnalytics';
import { defaultReviewState, defaultSevereErrors } from '@/lib/conversationReviews';

const REVIEW_DRAFT_KEY = 'dawaa_conversation_review_draft_v3';

type StoredChat = ConversationPortfolioItem & { rawText: string };

function secLabel(seconds: number | null) {
  if (seconds == null) return '-';
  if (seconds < 60) return `${Math.round(seconds)} ث`;
  return `${Math.round(seconds / 60)} د`;
}

export default function ConversationChatIntelligenceWorkspace() {
  const navigate = useNavigate();
  const [staffName, setStaffName] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [savedChats, setSavedChats] = useState<StoredChat[]>([]);
  const summary = useMemo(() => buildConversationPortfolioSummary(savedChats), [savedChats]);

  const applyToReview = (payload: { analysis: WhatsAppChatAnalysis; reviewState: any; notes: string; rawText: string }) => {
    const draft = {
      form: {
        reviewerId: '',
        staffId: '',
        customerId: '',
        customerCode: '',
        customerName,
        customerPhone: '',
        customerType: '',
        evaluationKind: 'واتساب',
        evaluationReason: 'مراجعة عشوائية',
        invoiceNo: '',
        convertedToSale: '',
        conversationDate: new Date().toISOString().slice(0, 16),
        firstCustomerMessageAt: '',
        firstStaffReplyAt: '',
        followUpPromised: payload.analysis.metrics.promisedFollowups > 0,
        followUpPromisedAt: '',
        followUpReturnedAt: '',
        notes: payload.notes,
        reviewerNotes: payload.notes,
        trainingRecommendationManual: payload.analysis.training.join(' | '),
      },
      reviewState: payload.reviewState || defaultReviewState(),
      severeErrors: defaultSevereErrors(),
      custSearch: customerName,
      savedAt: new Date().toISOString(),
      chatIntelligence: {
        version: payload.analysis.version,
        analysis: payload.analysis,
        staffName,
        customerName,
        rawText: payload.rawText,
      },
    };
    localStorage.setItem(REVIEW_DRAFT_KEY, JSON.stringify(draft));
    navigate('/reviews?mode=new');
  };

  const addPortfolioChat = async (file?: File | null) => {
    if (!file) return;
    const rawText = await file.text();
    const analysis = analyzeWhatsAppChat(rawText, {
      staffNames: staffName ? [staffName] : undefined,
      customerNames: customerName ? [customerName] : undefined,
    });
    setSavedChats((prev) => [...prev, {
      id: `${Date.now()}-${file.name}`,
      label: file.name,
      staffName,
      customerName,
      analysis,
      rawText,
    }]);
  };

  return <div dir="rtl" className="space-y-4">
    <div className="dawaa-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xl font-black"><Sparkles size={20}/> مركز ذكاء محادثات واتساب</div>
          <p className="mt-1 text-sm text-slate-400">تحليل محادثة واحدة بالتفصيل أو مجموعة محادثات لمقارنة أداء الدكتور واكتشاف الأنماط المتكررة.</p>
        </div>
        <button className="dawaa-button dawaa-button--secondary" onClick={() => navigate('/reviews')}>العودة للتقييمات</button>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="space-y-1"><span className="text-xs font-bold text-slate-400">اسم الدكتور/الموظف المتوقع</span><input value={staffName} onChange={(e) => setStaffName(e.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-950/50 p-3" placeholder="مثال: د أحمد"/></label>
        <label className="space-y-1"><span className="text-xs font-bold text-slate-400">اسم العميل إن كان معروفًا</span><input value={customerName} onChange={(e) => setCustomerName(e.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-950/50 p-3" placeholder="مثال: أ/ محمد"/></label>
      </div>
    </div>

    <WhatsAppChatIntelligencePanel staffName={staffName || null} customerName={customerName || null} onApplySuggestion={applyToReview} />

    <section className="dawaa-card p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><div className="flex items-center gap-2 font-black text-lg"><BarChart3 size={18}/> تحليل مجموعة محادثات</div><div className="text-xs text-slate-400 mt-1">ارفع عدة ملفات TXT لنفس الدكتور لرؤية المتوسطات ونقاط القوة والضعف المتكررة.</div></div>
        <label className="dawaa-button dawaa-button--secondary cursor-pointer flex items-center gap-2"><Plus size={16}/> إضافة شات<input type="file" accept=".txt,text/plain" className="hidden" onChange={(e) => void addPortfolioChat(e.target.files?.[0])}/></label>
      </div>

      {savedChats.length > 0 ? <>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Metric label="عدد المحادثات" value={String(summary.conversations)} />
          <Metric label="متوسط الخدمة" value={summary.avgServiceScore == null ? '-' : `${summary.avgServiceScore}%`} />
          <Metric label="متوسط الأداء البيعي" value={summary.avgCommercialScore == null ? '-' : `${summary.avgCommercialScore}%`} />
          <Metric label="متوسط أول رد" value={secLabel(summary.avgFirstResponseSeconds)} />
          <Metric label="تحتاج مراجعة بشرية" value={String(summary.conversationsNeedingHumanReview)} warn={summary.conversationsNeedingHumanReview > 0} />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-700 bg-slate-950/25 p-3"><div className="font-black mb-2">أضعف البنود المتكررة</div><div className="space-y-2">{summary.weakestCriteria.map((x) => <div key={x.key} className="flex items-center justify-between text-sm"><span>{x.label}</span><span className="font-black">{x.average}% <span className="text-slate-500 text-xs">({x.samples})</span></span></div>)}</div></div>
          <div className="rounded-xl border border-slate-700 bg-slate-950/25 p-3"><div className="font-black mb-2">أقوى البنود المتكررة</div><div className="space-y-2">{summary.strongestCriteria.map((x) => <div key={x.key} className="flex items-center justify-between text-sm"><span>{x.label}</span><span className="font-black">{x.average}% <span className="text-slate-500 text-xs">({x.samples})</span></span></div>)}</div></div>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-700"><table className="w-full min-w-[760px] text-sm"><thead className="bg-slate-950/50"><tr><th className="p-3 text-right">الملف</th><th className="p-3 text-right">الخدمة</th><th className="p-3 text-right">البيع</th><th className="p-3 text-right">أول رد</th><th className="p-3 text-right">رسائل بلا رد</th><th className="p-3"></th></tr></thead><tbody>{savedChats.map((chat, i) => <tr key={chat.id} className="border-t border-slate-800"><td className="p-3"><div className="flex items-center gap-2"><FileText size={14}/><span className="font-bold">{chat.label}</span></div></td><td className="p-3 font-black">{summary.trend[i]?.score ?? '-'}%</td><td className="p-3 font-black">{summary.trend[i]?.commercial ?? '-'}%</td><td className="p-3">{secLabel(chat.analysis.metrics.firstResponseSeconds)}</td><td className="p-3">{chat.analysis.metrics.unansweredCustomerMessages}</td><td className="p-3"><button className="text-red-300" onClick={() => setSavedChats((prev) => prev.filter((x) => x.id !== chat.id))}><Trash2 size={16}/></button></td></tr>)}</tbody></table></div>
      </> : <div className="rounded-xl border border-dashed border-slate-700 p-6 text-center text-sm text-slate-400">لم يتم رفع مجموعة محادثات بعد.</div>}
    </section>
  </div>;
}

function Metric({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return <div className={`rounded-xl border p-3 ${warn ? 'border-amber-500/30 bg-amber-500/5' : 'border-slate-700 bg-slate-950/30'}`}><div className="text-xs text-slate-400">{label}</div><div className={`mt-1 text-xl font-black ${warn ? 'text-amber-200' : 'text-white'}`}>{value}</div></div>;
}
