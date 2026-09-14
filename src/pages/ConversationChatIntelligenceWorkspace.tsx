import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart3, FileText, Plus, Sparkles, Trash2, TrendingDown, TrendingUp } from 'lucide-react';
import WhatsAppChatIntelligencePanel from '@/components/conversationReviews/WhatsAppChatIntelligencePanel';
import ConversationPerformanceProfiles from '@/components/conversationReviews/ConversationPerformanceProfiles';
import type { WhatsAppChatAnalysis } from '@/lib/conversationAnalysis/whatsappChatAnalyzer';
import { analyzeFullConversation, type FullConversationIntelligence } from '@/lib/conversationAnalysis/customerConversationIntelligence';
import { buildConversationPortfolioSummary, type ConversationPortfolioItem } from '@/lib/conversationAnalysis/conversationPortfolioAnalytics';
import { buildConversionAnalytics, classifyConversionEligibility, CONVERSION_RULES, type ConversionConversationItem } from '@/lib/conversationAnalysis/conversionAnalytics';
import { buildConversationCycleAnalytics, type CycleConversationItem } from '@/lib/conversationAnalysis/conversationCycleAnalytics';
import { defaultReviewState, defaultSevereErrors } from '@/lib/conversationReviews';

const REVIEW_DRAFT_KEY = 'dawaa_conversation_review_draft_v3';

type StoredChat = ConversationPortfolioItem & ConversionConversationItem & CycleConversationItem & {
  rawText: string;
  intelligence: FullConversationIntelligence;
  conversationAt?: string | null;
};

const rate = (v: number | null) => v == null ? '-' : `${v}%`;
const seconds = (v: number | null) => v == null ? '-' : v < 60 ? `${Math.round(v)} ث` : `${Math.round(v / 60)} د`;
const delta = (v: number | null) => v == null ? '-' : `${v > 0 ? '+' : ''}${v} نقطة`;
const firstDate = (x: FullConversationIntelligence) => x.base.messages.find((m) => m.timestamp)?.timestamp || null;

export default function ConversationChatIntelligenceWorkspace() {
  const navigate = useNavigate();
  const [staffName, setStaffName] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [branch, setBranch] = useState('');
  const [savedChats, setSavedChats] = useState<StoredChat[]>([]);
  const summary = useMemo(() => buildConversationPortfolioSummary(savedChats), [savedChats]);
  const conversion = useMemo(() => buildConversionAnalytics(savedChats), [savedChats]);
  const cycle = useMemo(() => buildConversationCycleAnalytics(savedChats), [savedChats]);

  const applyToReview = (payload: { analysis: WhatsAppChatAnalysis; reviewState: any; notes: string; rawText: string }) => {
    const full = analyzeFullConversation(payload.rawText, { staffNames: staffName ? [staffName] : undefined, customerNames: customerName ? [customerName] : undefined });
    localStorage.setItem(REVIEW_DRAFT_KEY, JSON.stringify({
      form: {
        reviewerId: '', staffId: '', customerId: '', customerCode: '', customerName, customerPhone: '', customerType: '',
        evaluationKind: 'واتساب', evaluationReason: 'مراجعة عشوائية', invoiceNo: '',
        convertedToSale: full.journey.outcome === 'sold' ? 'yes' : full.journey.outcome === 'not_sold' ? 'no' : '',
        conversationDate: firstDate(full)?.slice(0, 16) || new Date().toISOString().slice(0, 16),
        firstCustomerMessageAt: '', firstStaffReplyAt: '', followUpPromised: payload.analysis.metrics.promisedFollowups > 0,
        followUpPromisedAt: '', followUpReturnedAt: '', notes: payload.notes, reviewerNotes: payload.notes,
        trainingRecommendationManual: payload.analysis.training.join(' | '),
      },
      reviewState: payload.reviewState || defaultReviewState(), severeErrors: defaultSevereErrors(), custSearch: customerName,
      savedAt: new Date().toISOString(), chatIntelligence: { version: payload.analysis.version, analysis: payload.analysis, full, staffName, customerName, branch, rawText: payload.rawText },
    }));
    navigate('/reviews?mode=new');
  };

  const addFiles = async (files: FileList | File[]) => {
    const additions: StoredChat[] = [];
    for (const file of Array.from(files || [])) {
      const rawText = await file.text();
      const intelligence = analyzeFullConversation(rawText, { staffNames: staffName ? [staffName] : undefined, customerNames: customerName ? [customerName] : undefined });
      additions.push({ id: `${Date.now()}-${Math.random()}-${file.name}`, label: file.name, staffName, customerName, branch, analysis: intelligence.base, intelligence, rawText, conversationAt: firstDate(intelligence) });
    }
    if (additions.length) setSavedChats((prev) => [...prev, ...additions]);
  };

  return <div dir="rtl" className="space-y-4">
    <section className="dawaa-card p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2 text-xl font-black"><Sparkles size={20}/> مركز ذكاء محادثات واتساب</div><p className="mt-1 text-sm text-slate-400">تحليل الشات + Conversion لكل فرع ودكتور + مقارنة دورة 26→25 + جودة العينة.</p></div><button className="dawaa-button dawaa-button--secondary" onClick={() => navigate('/reviews')}>العودة للتقييمات</button></div>
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="اسم الدكتور/الموظف"><input value={staffName} onChange={(e) => setStaffName(e.target.value)} className="field" placeholder="مثال: د أحمد"/></Field>
        <Field label="الفرع"><select value={branch} onChange={(e) => setBranch(e.target.value)} className="field"><option value="">اختر الفرع</option><option value="فرع الشامي">فرع الشامي</option><option value="فرع شكري">فرع شكري</option></select></Field>
        <Field label="اسم العميل إن كان معروفًا"><input value={customerName} onChange={(e) => setCustomerName(e.target.value)} className="field" placeholder="مثال: أ/ محمد"/></Field>
      </div>
      <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-3 text-xs leading-6 text-sky-100"><b>قاعدة Conversion:</b> المقام = {CONVERSION_RULES.denominator}. البسط = {CONVERSION_RULES.numerator}. الشكاوى والحالات منخفضة الثقة لا تدخل في النسبة.</div>
    </section>

    <WhatsAppChatIntelligencePanel staffName={staffName || null} customerName={customerName || null} onApplySuggestion={applyToReview} />

    <section className="dawaa-card p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><div className="flex items-center gap-2 font-black text-lg"><BarChart3 size={18}/> تحليل مجموعة محادثات</div><div className="text-xs text-slate-400 mt-1">اختار الدكتور والفرع قبل الرفع؛ يمكن رفع عدة ملفات مرة واحدة.</div></div><label className="dawaa-button dawaa-button--secondary cursor-pointer flex items-center gap-2"><Plus size={16}/> إضافة شاتات<input multiple type="file" accept=".txt,text/plain" className="hidden" onChange={(e) => e.target.files && void addFiles(e.target.files)}/></label></div>

      {savedChats.length ? <>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6"><Metric label="كل المحادثات" value={String(summary.conversations)}/><Metric label="Conversion Rate" value={rate(conversion.conversionRate)}/><Metric label="بيع مؤهل" value={String(conversion.eligibleConversations)}/><Metric label="Converted" value={String(conversion.convertedConversations)}/><Metric label="متوسط الخدمة" value={rate(summary.avgServiceScore)}/><Metric label="متوسط أول رد" value={seconds(summary.avgFirstResponseSeconds)}/></div>

        <CycleDashboard cycle={cycle}/>
        <ConversationPerformanceProfiles items={savedChats}/>

        <div className="grid gap-4 lg:grid-cols-2"><ConversionTable title="Conversion حسب الفرع — كل المرفوع" rows={conversion.byBranch}/><ConversionTable title="Conversion حسب الدكتور — كل المرفوع" rows={conversion.byDoctor}/></div>
        <div className="rounded-xl border border-slate-700 bg-slate-950/25 p-3 text-xs leading-6 text-slate-300"><b className="text-white">جودة المقام:</b> مستبعد غير بيعي: {conversion.excludedNonSales} — مستبعد ثقة منخفضة: {conversion.excludedLowConfidence} — Coverage: {rate(conversion.coverageRate)}.</div>
        <ChatsTable chats={savedChats} trend={summary.trend} onDelete={(id) => setSavedChats((prev) => prev.filter((x) => x.id !== id))}/>
      </> : <div className="rounded-xl border border-dashed border-slate-700 p-6 text-center text-sm text-slate-400">لم يتم رفع مجموعة محادثات بعد.</div>}
    </section>
    <style>{`.field{width:100%;border-radius:.75rem;border:1px solid rgb(51 65 85);background:rgba(2,6,23,.5);padding:.75rem}`}</style>
  </div>;
}

function CycleDashboard({ cycle }: { cycle: ReturnType<typeof buildConversationCycleAnalytics> }) {
  return <section className="space-y-4 rounded-2xl border border-teal-500/20 bg-teal-500/5 p-4"><div><div className="text-lg font-black">Dashboard دورة 26 → 25</div><div className="text-xs text-slate-400">الحالية: {cycle.current.cycleLabel} — السابقة: {cycle.previous.cycleLabel}</div></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><DeltaMetric label="Conversion" current={rate(cycle.current.conversion.conversionRate)} previous={rate(cycle.previous.conversion.conversionRate)} change={cycle.conversionChangePp} positiveIsGood/><DeltaMetric label="Lost Sales Rate" current={rate(cycle.current.lostSalesRate)} previous={rate(cycle.previous.lostSalesRate)} change={cycle.lostSalesRateChangePp} positiveIsGood={false}/><DeltaMetric label="Follow-up Recovery" current={rate(cycle.current.followupRecoveryRate)} previous={rate(cycle.previous.followupRecoveryRate)} change={cycle.followupRecoveryChangePp} positiveIsGood/><Metric label="رسائل بلا رد" value={String(cycle.current.unansweredCustomerMessages)} warn={cycle.current.unansweredCustomerMessages > 0}/></div><div className="grid gap-4 lg:grid-cols-2"><CycleTable title="الفروع — الحالية مقابل السابقة" rows={cycle.byBranch}/><CycleTable title="الدكاترة — الحالية مقابل السابقة" rows={cycle.byDoctor}/></div></section>;
}

function ChatsTable({ chats, trend, onDelete }: { chats: StoredChat[]; trend: Array<{ score: number | null }>; onDelete: (id: string) => void }) {
  return <div className="overflow-x-auto rounded-xl border border-slate-700"><table className="w-full min-w-[1050px] text-sm"><thead className="bg-slate-950/50"><tr><th className="p-3 text-right">الملف</th><th className="p-3 text-right">التاريخ</th><th className="p-3 text-right">الفرع</th><th className="p-3 text-right">الدكتور</th><th className="p-3 text-right">النتيجة</th><th className="p-3 text-right">Conversion</th><th className="p-3 text-right">الخدمة</th><th className="p-3 text-right">البيع</th><th className="p-3 text-right">أول رد</th><th/></tr></thead><tbody>{chats.map((chat, i) => { const cls = classifyConversionEligibility(chat); return <tr key={chat.id} className="border-t border-slate-800"><td className="p-3"><div className="flex gap-2"><FileText size={14}/><b>{chat.label}</b></div></td><td className="p-3">{chat.conversationAt ? new Date(chat.conversationAt).toLocaleDateString('ar-EG') : '-'}</td><td className="p-3">{chat.branch || 'غير محدد'}</td><td className="p-3">{chat.staffName || 'غير محدد'}</td><td className="p-3 font-black">{outcome(chat.intelligence.journey.outcome)}</td><td className="p-3">{!cls.salesEligible ? 'مستبعد — غير بيعي' : cls.lowConfidence ? 'مستبعد — ثقة منخفضة' : cls.converted ? 'Converted' : 'Not converted'}</td><td className="p-3 font-black">{trend[i]?.score ?? '-'}%</td><td className="p-3 font-black">{chat.intelligence.commercialScore}%</td><td className="p-3">{seconds(chat.analysis.metrics.firstResponseSeconds)}</td><td className="p-3"><button className="text-red-300" onClick={() => onDelete(chat.id)}><Trash2 size={16}/></button></td></tr>; })}</tbody></table></div>;
}

function ConversionTable({ title, rows }: { title: string; rows: Array<{ key: string; label: string; conversations: number; eligible: number; converted: number; conversionRate: number | null; coverageRate: number | null }> }) {
  return <TableShell title={title}><thead><tr><Th>الاسم</Th><Th>الشاتات</Th><Th>المؤهلة</Th><Th>Converted</Th><Th>Conversion</Th><Th>Coverage</Th></tr></thead><tbody>{rows.map((r) => <tr key={r.key} className="border-t border-slate-800"><Td bold>{r.label}</Td><Td>{r.conversations}</Td><Td>{r.eligible}</Td><Td>{r.converted}</Td><Td bold>{rate(r.conversionRate)}</Td><Td>{rate(r.coverageRate)}</Td></tr>)}</tbody></TableShell>;
}

function CycleTable({ title, rows }: { title: string; rows: Array<{ key: string; label: string; currentEligible: number; currentConverted: number; currentRate: number | null; previousRate: number | null; changePp: number | null }> }) {
  return <TableShell title={title}><thead><tr><Th>الاسم</Th><Th>المؤهلة</Th><Th>Converted</Th><Th>الحالية</Th><Th>السابقة</Th><Th>التغير</Th></tr></thead><tbody>{rows.map((r) => <tr key={r.key} className="border-t border-slate-800"><Td bold>{r.label}</Td><Td>{r.currentEligible}</Td><Td>{r.currentConverted}</Td><Td bold>{rate(r.currentRate)}</Td><Td>{rate(r.previousRate)}</Td><Td><Delta value={r.changePp}/></Td></tr>)}</tbody></TableShell>;
}

function outcome(v: string) { return v === 'sold' ? 'تم البيع' : v === 'needs_followup' ? 'تحتاج متابعة' : v === 'not_sold' ? 'لم يتم البيع' : v === 'complaint_resolved' ? 'شكوى محلولة' : v === 'complaint_unresolved' ? 'شكوى غير محسومة' : 'غير واضح'; }
function Field({ label, children }: { label: string; children: any }) { return <label className="space-y-1"><span className="text-xs font-bold text-slate-400">{label}</span>{children}</label>; }
function TableShell({ title, children }: { title: string; children: any }) { return <div className="overflow-hidden rounded-xl border border-slate-700 bg-slate-950/25"><div className="p-3 font-black">{title}</div><div className="overflow-x-auto"><table className="w-full min-w-[540px] text-sm">{children}</table></div></div>; }
function Th({ children }: { children: any }) { return <th className="p-2 text-right">{children}</th>; }
function Td({ children, bold = false }: { children: any; bold?: boolean }) { return <td className={`p-2 ${bold ? 'font-black' : ''}`}>{children}</td>; }
function DeltaMetric({ label, current, previous, change, positiveIsGood }: { label: string; current: string; previous: string; change: number | null; positiveIsGood: boolean }) { const good = change == null ? null : positiveIsGood ? change >= 0 : change <= 0; return <div className="rounded-xl border border-slate-700 bg-slate-950/30 p-3"><div className="text-xs text-slate-400">{label}</div><div className="mt-1 text-xl font-black">{current}</div><div className="mt-1 flex justify-between text-xs"><span className="text-slate-500">السابقة {previous}</span><span className={good == null ? 'text-slate-400' : good ? 'text-emerald-300' : 'text-red-300'}>{delta(change)}</span></div></div>; }
function Delta({ value }: { value: number | null }) { if (value == null) return <span className="text-slate-500">-</span>; return <span className={`inline-flex items-center gap-1 font-black ${value >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>{value >= 0 ? <TrendingUp size={13}/> : <TrendingDown size={13}/>} {delta(value)}</span>; }
function Metric({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) { return <div className={`rounded-xl border p-3 ${warn ? 'border-amber-500/30 bg-amber-500/5' : 'border-slate-700 bg-slate-950/30'}`}><div className="text-xs text-slate-400">{label}</div><div className={`mt-1 text-xl font-black ${warn ? 'text-amber-200' : 'text-white'}`}>{value}</div></div>; }
