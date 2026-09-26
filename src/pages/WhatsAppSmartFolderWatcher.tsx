import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, CheckCircle2, ChevronDown, ChevronUp, FileText, FolderOpen, Image as ImageIcon, Loader2, Mic, RefreshCw, Search, Sparkles, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import {
  connectLocalWhatsAppFolder,
  getUnprocessedWhatsAppExports,
  markLocalWhatsAppFileFailed,
  markLocalWhatsAppFileProcessed,
  queryLocalWhatsAppFolderPermission,
  restoreLocalWhatsAppFolder,
  supportsLocalWhatsAppInbox,
  resetLocalWhatsAppProcessedLedger,
  loadLocalWhatsAppAnalysisHistory,
  saveLocalWhatsAppAnalysisHistory,
} from '@/lib/localWhatsAppInbox';
import { readWhatsAppExportFile } from '@/lib/whatsappExportFileReader';
import { parseWhatsAppExport, splitWhatsAppSessions } from '@/lib/whatsappConversationParser';
import { buildSmartConversationReviewResult } from '@/lib/whatsappSmartReviewResult';
import { runSmartReviewPipeline, type SmartReviewPipelineResult } from '@/lib/whatsappSmartReviewPipeline';
import type { SmartStaffRole } from '@/lib/whatsappSmartReviewOwnership';
import { resolveWhatsAppParticipantRolesV15 } from '@/lib/whatsappParticipantRoleResolverV15';
import { groupOutboundBursts, computeStaffBurstEffort } from '@/lib/whatsappOutboundMessageBursts';
import { buildUnifiedConversationIntelligence, verifySessionAgainstInvoices } from '@/lib/whatsappUnifiedIntelligenceV4';
import { buildSmartIntelligenceSnapshotV1 } from '@/lib/whatsappSmartIntelligenceSnapshot';
import { resolveConversationBranchHint, type BranchHintResult } from '@/lib/whatsappConversationBranchHint';
import { resolveStaffIdentity, type ResolvedStaffIdentity } from '@/lib/whatsappStaffIdentityResolver';
import { buildSmartOfficialReviewDraftV1 } from '@/lib/whatsappSmartOfficialReviewDraft';
import { buildSmartConversationEvaluationV2 } from '@/lib/whatsappConversationEvaluationV2';
import { extractPhoneCandidate, resolveCustomerContext } from '@/lib/whatsappCustomerContextResolver';
import { extractCustomerHintFromExportFileName } from '@/lib/whatsappExportCustomerHint';
import { buildWhatsAppCaseContextsV27 } from '@/lib/whatsappCaseContextV27';
import { buildConversationTimingV28 } from '@/lib/whatsappConversationTimingV28';
import { buildDelayAttributionV29 } from '@/lib/whatsappDelayAttributionV29';
import { buildConversationFocusV30 } from '@/lib/whatsappConversationFocusV30';
import { buildEvaluationConversationV31 } from '@/lib/whatsappEvaluationConversationV31';
import { syncWhatsAppResponseTurnsV18 } from '@/lib/whatsappResponseTurnsV18';
import { persistAnalyzedWhatsAppSession, attachInvoiceVerificationToQueue } from '@/lib/whatsappReviewPersistenceV4';
import { buildWhatsAppCustomerJourneyIntelligenceV15 } from '@/lib/whatsappCustomerJourneyIntelligenceV15';
import { syncWhatsAppCustomerJourneyV15, type JourneySessionSourceV15 } from '@/lib/whatsappCustomerJourneyPersistenceV15';
import { syncWhatsAppCustomerCasesV22 } from '@/lib/whatsappCustomerCasePersistenceV22';
import type { SmartQuickDecisionResult } from '@/lib/whatsappSmartReviewDecision';
import {
  buildConversationReviewSnapshot,
  writePendingConversationReviewTransfer,
  type ConversationReviewSnapshot,
} from '@/lib/conversationReviewTranscript';
import {
  buildSmartReviewActionPlan,
  writeSmartCustomerRequestTransfer,
  writeSmartFollowupTransfer,
  type SmartReviewActionPlan,
} from '@/lib/whatsappSmartReviewActions';

type StaffRun = {
  sessionId: string;
  caseId: string;
  caseSummary: string;
  caseSessionCount: number;
  caseStaffNames: string[];
  customerName: string | null;
  staffName: string;
  role: SmartStaffRole;
  decision: SmartQuickDecisionResult['decision'];
  safe: boolean;
  reasons: string[];
  criteria: string[];
  intelligence: ReturnType<typeof runSmartReviewPipeline>['intelligence'];
  /** Cross-check مستقل (V6/Journey) — عرض فقط، ما بيأثرش على decision/reasons/safe فوق. */
  journeyCrossCheck: SmartReviewPipelineResult['journeyCrossCheck'];
  staffIdentity: ResolvedStaffIdentity;
  branchHint: BranchHintResult;
  snapshot: ConversationReviewSnapshot;
  actions: SmartReviewActionPlan;
};

type FileRun = {
  fileName: string;
  at: string;
  messages: number;
  sessions: number;
  cases: number;
  staffRuns: StaffRun[];
  errors: string[];
};

const INTERVAL_MS = 60_000;

function groupStaffRunsByCase(run: FileRun) {
  const groups = new Map<string, StaffRun[]>();
  for (const item of run.staffRuns) {
    const key = item.caseId || item.sessionId;
    const current = groups.get(key) || [];
    current.push(item);
    groups.set(key, current);
  }
  return [...groups.entries()].map(([caseId, items]) => ({
    caseId,
    items,
    summary: items[0]?.caseSummary || 'رحلة عميل',
    sessionCount: items[0]?.caseSessionCount || 1,
    customerName: items[0]?.customerName || null,
  }));
}

function decisionLabel(value: string) {
  if (value === 'clear') return 'سليمة';
  if (value === 'issue') return 'ملاحظة';
  return 'مراجعة تفصيلية';
}

function roleLabel(role: SmartStaffRole) {
  if (role === 'customer_service') return 'خدمة العملاء';
  if (role === 'pharmacist') return 'صيدلي';
  return 'غير محدد';
}

function opportunityLabel(value: string) {
  if (value === 'handled_well') return 'تم التعامل جيدًا';
  if (value === 'partial') return 'تعامل جزئي';
  if (value === 'missed') return 'فرصة ضائعة';
  if (value === 'needs_review') return 'تحتاج مراجعة';
  return value;
}

function timingDuration(seconds: number | null | undefined) {
  if (seconds == null) return '—';
  if (seconds < 60) return `${seconds} ث`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} د`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} س ${rest} د` : `${hours} س`;
}

function episodeGapLabel(minutes: number | null) {
  if (minutes == null || minutes <= 0) return null;
  if (minutes < 60) return `بعد ${minutes} دقيقة`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `بعد ${h} س ${m} د` : `بعد ${h} ساعة`;
}

function isVoiceMessage(kind: string, text: string) {
  return kind === 'voice' || /voice message omitted|audio omitted/i.test(text);
}

function isImageMessage(kind: string, text: string) {
  return kind === 'image' || /image omitted|photo omitted/i.test(text);
}

function messageBody(kind: string, text: string) {
  if (isVoiceMessage(kind, text)) {
    return (
      <div className="flex min-w-[220px] items-center gap-3 py-1">
        <div className="grid h-9 w-9 place-items-center rounded-full bg-white/10"><Mic size={17} /></div>
        <div className="flex flex-1 items-center gap-1">
          {Array.from({ length: 18 }).map((_, index) => (
            <span key={index} className="h-1 rounded-full bg-current opacity-50" style={{ width: index % 4 === 0 ? 10 : 5 }} />
          ))}
        </div>
        <span className="text-[11px] opacity-70">رسالة صوتية</span>
      </div>
    );
  }
  if (isImageMessage(kind, text)) {
    return (
      <div className="flex min-w-[220px] items-center gap-3 py-1">
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-white/10"><ImageIcon size={17} /></div>
        <div>
          <div className="font-bold">صورة</div>
          <div className="text-[11px] opacity-70">المحتوى غير متاح داخل تصدير واتساب</div>
        </div>
      </div>
    );
  }
  if (kind === 'document' || /document omitted/i.test(text)) {
    return (
      <div className="flex min-w-[220px] items-center gap-3 py-1">
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-white/10"><FileText size={17} /></div>
        <div>
          <div className="font-bold">ملف مرفق</div>
          <div className="text-[11px] opacity-70">غير متاح داخل التصدير النصي</div>
        </div>
      </div>
    );
  }
  return <div className="whitespace-pre-wrap break-words text-[14px] leading-7">{text || `[${kind}]`}</div>;
}

export default function WhatsAppSmartFolderWatcher() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const actorName = String(user?.name || user?.username || user?.id || 'system');
  const handleRef = useRef<any>(null);
  const scanningRef = useRef(false);
  const [connected, setConnected] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [runs, setRuns] = useState<FileRun[]>([]);
  const [selected, setSelected] = useState<StaffRun | null>(null);
  const [conversationView, setConversationView] = useState<'whatsapp' | 'review'>('whatsapp');
  const [conversationFocusMode, setConversationFocusMode] = useState<'focused' | 'full'>('focused');
  const [detailTab, setDetailTab] = useState<'overview' | 'conversation' | 'review'>('overview');
  const [expandedRuns, setExpandedRuns] = useState<Record<string, boolean>>({});
  const [runQuery, setRunQuery] = useState('');


  const analyzeFile = useCallback(async (file: File): Promise<FileRun> => {
    const read = await readWhatsAppExportFile(file);
    const messages = parseWhatsAppExport(read.text);
    if (!messages.length) throw new Error('لم يتم التعرف على رسائل WhatsApp داخل الملف');
    const fileCustomerHint = extractCustomerHintFromExportFileName(file.name);
    const rawSessions = splitWhatsAppSessions(messages, 120).map((session) => ({
      ...session,
      // اسم الملف عندنا جزء من workflow التصدير وبيحمل اسم العميل. بنستخدمه كـhint
      // وليس كـID مؤكد؛ الـresolver يظل هو اللي يحسم العميل الحقيقي من الهاتف/الكود/الاسم/الفرع.
      customerName: fileCustomerHint.nameHint || session.customerName,
    }));

    // مهم: الـ120 دقيقة بقت Boundary للـraw sessions فقط، وليست Boundary لرحلة العميل.
    // Case Context V27 يجمع الجلسات المرتبطة بنفس الطلب/الشكوى/recovery قبل تقييم الأفراد.
    // مثال إبراهيم الصياد: رد دكتور أولًا ثم دكتور آخر بعد ساعة بسبب تأخير الأوردر = Case واحدة.
    const caseContexts = buildWhatsAppCaseContextsV27(rawSessions);
    const analysisUnits = caseContexts.contexts;
    const staffRuns: StaffRun[] = [];
    const persistedSessionSources: JourneySessionSourceV15[] = [];
    const persistedBranchHints: string[] = [];

    // نفس ملف التصدير غالبًا يحتوي أكثر من Session لنفس العميل. قبل التحسين كنا بنكرر
    // customer search + purchase-history query لكل Session. الكاش هنا محلي للتحليل فقط
    // (لا يغيّر أي مصدر حقيقة) ويعيد استخدام نفس Promise حتى لو جلستين شغالين بالتوازي.
    const customerContextCache = new Map<string, ReturnType<typeof resolveCustomerContext>>();
    const getCustomerContext = (session: (typeof analysisUnits)[number]['mergedSession'], branch: string | null) => {
      const identity = extractPhoneCandidate(session) || session.customerName || 'unknown';
      const key = `${identity.trim().toLowerCase()}|${String(branch || '').trim().toLowerCase()}`;
      const existing = customerContextCache.get(key);
      if (existing) return existing;
      const request = resolveCustomerContext(session, branch, {
        customerNameHint: fileCustomerHint.nameHint,
        customerCodeHint: fileCustomerHint.codeHint,
      });
      customerContextCache.set(key, request);
      return request;
    };

    const analyzeCase = async (caseContext: (typeof analysisUnits)[number]): Promise<StaffRun[]> => {
      const session = caseContext.mergedSession;
      const base = buildSmartConversationReviewResult(session);

      // V15/V6 عندهم دلوقتي directory cache قصير العمر، فالجلسات المتتالية لا تعيد تحميل
      // مئات سجلات الموظفين والـaliases من Supabase كل مرة.
      const roles = await resolveWhatsAppParticipantRolesV15(session);
      const outboundBurstMetrics = computeStaffBurstEffort(groupOutboundBursts(session, roles));
      const branchHint = await resolveConversationBranchHint(session, roles, null);
      const customerContext = await getCustomerContext(session, branchHint.value);
      const resolvedCustomer = customerContext.resolution.customer;

      // التحقق من الفاتورة يظل per-session لأن التوقيت وسياق الجلسة جزء من المطابقة؛
      // لذلك لا نكاشه بشكل قد يخلط بيع Session بآخر.
      const invoiceVerification = await verifySessionAgainstInvoices(session, {
        customerId: resolvedCustomer?.id || null,
        customerCode: resolvedCustomer?.code || null,
        customerPhone: resolvedCustomer?.phone || customerContext.phoneCandidate || null,
        customerName: resolvedCustomer?.name || session.customerName,
        branch: resolvedCustomer?.branch || branchHint.value,
      });

      const caseTimingV28 = buildConversationTimingV28(session, roles, invoiceVerification);
      const delayAttributionV29 = buildDelayAttributionV29(session, caseTimingV28, roles);

      // الموظفون داخل نفس Session مستقلون بعد تجهيز سياق الجلسة، فبدل N awaits متتالية
      // بنحل هويتهم ونبني تقييماتهم بالتوازي. ده يسرّع handoff sessions بوضوح.
      const resolvedRuns = await Promise.all(base.staffSummaries.map(async (staff): Promise<StaffRun | null> => {
        const staffIdentity = await resolveStaffIdentity(staff.staffName, roles, staff.messageIds, branchHint.value);

        const result = runSmartReviewPipeline(session, {
          staffName: staff.staffName,
          role: staff.role,
          contextMessages: 2,
          invoiceVerification,
          invoiceVerified: invoiceVerification.status === 'verified',
          invoiceMatchAmbiguous: invoiceVerification.status === 'needs_review',
        });
        if (!result.scope.scoredSession) return null;
        const staffTimingV28 = buildConversationTimingV28(result.scope.scoredSession, roles, invoiceVerification);

        const conversationFocusV30 = buildConversationFocusV30(session, {
          scoredMessageIds: result.scope.inScopeMessageIds,
          evidenceMessageIds: result.decision.evidenceMessageIds,
          timing: caseTimingV28,
          delayAttribution: delayAttributionV29,
        });

        // V31: المحادثة التي سيتم التقييم عليها فعليًا.
        // لا نستخدم الـCase كلها ولا رسالتين context ثابتين؛ نضم فقط رسائل الموظف،
        // سؤال العميل الذي رد عليه، milestones المهمة، والأدلة/السياق القريب اللازم.
        const evaluationConversationV31 = buildEvaluationConversationV31(session, {
          scoredMessageIds: result.scope.inScopeMessageIds,
          evidenceMessageIds: result.decision.evidenceMessageIds,
          focus: conversationFocusV30,
          staffTiming: staffTimingV28,
        });
        const evaluationSession = evaluationConversationV31.session;
        const focusedStaffTimingV28 = buildConversationTimingV28(evaluationSession, roles, invoiceVerification);

        const evaluationV2 = buildSmartConversationEvaluationV2(evaluationSession, {
          invoiceVerification,
          purchaseHistory: customerContext.purchaseHistory,
          salesOpportunities: result.intelligence?.salesOpportunities || [],
          consultationCommunication: result.intelligence?.consultationCommunication || null,
        });

        const officialReviewDraft = buildSmartOfficialReviewDraftV1(evaluationSession, session.customerName, {
          missingMediaMessageIds: result.qualityGate?.criticalMissingMediaMessageIds || [],
          journey: result.journeyCrossCheck,
          evaluationV2,
          timingV28: focusedStaffTimingV28,
        });

        const includedIds = new Set(evaluationConversationV31.includedMessageIds);
        const focusedScoredIds = result.scope.inScopeMessageIds.filter((id) => includedIds.has(id));
        const focusedContextIds = evaluationConversationV31.includedMessageIds.filter((id) => !focusedScoredIds.includes(id));

        const snapshot = buildConversationReviewSnapshot({
          session: evaluationSession,
          displayMessages: evaluationSession.messages,
          fullCaseDisplayMessages: session.messages,
          scoredMessageIds: focusedScoredIds,
          contextMessageIds: focusedContextIds,
          evidenceMessageIds: result.decision.evidenceMessageIds,
          staffName: staff.staffName,
          staffRole: staff.role,
          sourceFileName: file.name,
          decision: result.decision,
          outboundBurstMetrics,
          staffIdentity,
          officialReviewDraft,
          conversationFocusV30,
          smartIntelligence: buildSmartIntelligenceSnapshotV1({
            journey: result.journeyCrossCheck,
            staffEffort: outboundBurstMetrics,
            invoiceVerification,
            branchHint,
            customer: customerContext.resolution,
            purchaseHistory: customerContext.purchaseHistory,
            evaluationV2,
            timingV28: caseTimingV28,
            staffTimingV28: focusedStaffTimingV28,
            delayAttributionV29,
          }),
        });

        const actions = buildSmartReviewActionPlan({
          intelligence: result.intelligence,
          staffName: staff.staffName,
          fallbackCustomerName: session.customerName || null,
        });

        return {
          sessionId: session.id,
          caseId: caseContext.caseItem.id,
          caseSummary: caseContext.caseItem.summary,
          caseSessionCount: caseContext.caseItem.sessionIds.length,
          caseStaffNames: caseContext.caseItem.staffNames,
          customerName: session.customerName || null,
          staffName: staff.staffName,
          role: staff.role,
          decision: result.decision.decision,
          safe: result.decision.safeToQuickApprove,
          reasons: result.decision.reasons,
          criteria: result.decision.affectedCriteria,
          intelligence: result.intelligence,
          journeyCrossCheck: result.journeyCrossCheck,
          staffIdentity,
          branchHint,
          snapshot,
          actions,
        };
      }));

      const keptRuns = resolvedRuns.filter((item): item is StaffRun => Boolean(item));

      // نحفظ Case واحدة كمصدر دائم بدل أن نعيد عدّ نفس الأوردر لكل دكتور شارك فيه.
      // لو Case لها مسؤول واحد مؤكد نسند المصدر له؛ لو أكتر من مسؤول نترك staff_id فارغ
      // ونحفظ participantRoles داخل analysis_json، ثم Stage Ownership V23 يوزع المسؤوليات.
      try {
        const singleResolvedStaff = keptRuns.length === 1 && keptRuns[0].staffIdentity.staffId && !keptRuns[0].staffIdentity.ambiguous
          ? keptRuns[0].staffIdentity
          : null;
        const baseIntelligence = buildUnifiedConversationIntelligence(session);
        const persistenceIntelligence = {
          ...baseIntelligence,
          participantRoles: roles,
          contextOnly: false,
          caseContext: {
            caseId: caseContext.caseItem.id,
            summary: caseContext.caseItem.summary,
            rawSessionIds: caseContext.caseItem.sessionIds,
            rawSessionCount: caseContext.caseItem.sessionIds.length,
            staffNames: caseContext.caseItem.staffNames,
          },
          timingV28: caseTimingV28,
          delayAttributionV29,
        } as any;
        const persisted = await persistAnalyzedWhatsAppSession(session, persistenceIntelligence, {
          sourceFileName: file.name,
          branch: resolvedCustomer?.branch || branchHint.value || null,
          customerId: resolvedCustomer?.id || null,
          customerCode: resolvedCustomer?.code || fileCustomerHint.codeHint || null,
          customerName: resolvedCustomer?.name || fileCustomerHint.nameHint || session.customerName || null,
          customerPhone: resolvedCustomer?.phone || customerContext.phoneCandidate || null,
          staffId: singleResolvedStaff?.staffId || null,
          staffName: singleResolvedStaff?.canonicalStaffName || null,
          createdBy: actorName,
        });
        await attachInvoiceVerificationToQueue(persisted.id, invoiceVerification, String(user?.id || '') || null, actorName);
        try {
          await syncWhatsAppResponseTurnsV18(session, {
            sourceId: persisted.id,
            participantRoles: roles,
            contextOnly: false,
          });
        } catch (timingPersistError) {
          console.warn('[whatsapp-watcher] response timing sync failed; source preserved', timingPersistError);
        }
        persistedSessionSources.push({
          sessionId: session.id,
          sourceId: persisted.id,
          contextOnly: false,
        });
        if (resolvedCustomer?.branch || branchHint.value) persistedBranchHints.push(String(resolvedCustomer?.branch || branchHint.value));
      } catch (persistError) {
        console.warn('[whatsapp-watcher] persistent case source sync failed; local analysis preserved', persistError);
      }

      return keptRuns;
    };

    // التحليل يتم على مستوى الـCase لا الـraw session. كده الـhandoff بين دكتورين
    // لا يخلق قصتين منفصلتين لنفس الأوردر، ومع ذلك كل دكتور يأخذ Scope رسائله فقط.
    const CASE_CONCURRENCY = 2;
    for (let index = 0; index < analysisUnits.length; index += CASE_CONCURRENCY) {
      const batch = analysisUnits.slice(index, index + CASE_CONCURRENCY);
      const batchRuns = await Promise.all(batch.map(analyzeCase));
      staffRuns.push(...batchRuns.flat());

      if (typeof window !== 'undefined' && index + CASE_CONCURRENCY < analysisUnits.length) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      }
    }

    if (persistedSessionSources.length) {
      try {
        const mergedSessions = analysisUnits.map((context) => context.mergedSession);
        const journeyModel = buildWhatsAppCustomerJourneyIntelligenceV15(mergedSessions);
        const branch = persistedBranchHints.find(Boolean) || null;
        await syncWhatsAppCustomerJourneyV15(journeyModel, {
          sourceFileName: file.name,
          branch,
          createdBy: actorName,
          sessionSources: persistedSessionSources,
        });

        const sourceByMergedSession = new Map(persistedSessionSources.map((row) => [row.sessionId, row.sourceId]));
        const persistedCaseModel = {
          ...caseContexts.caseEngine,
          cases: caseContexts.contexts.map((context) => ({
            ...context.caseItem,
            sessionIds: [context.mergedSession.id],
          })),
        };
        await syncWhatsAppCustomerCasesV22(persistedCaseModel, {
          branch,
          createdBy: actorName,
          sessionSources: persistedSessionSources.filter((row) => sourceByMergedSession.has(row.sessionId)),
        });
      } catch (syncError) {
        console.warn('[whatsapp-watcher] journey/case persistence failed; local capture remains available', syncError);
      }
    }

        return {
      fileName: file.name,
      at: new Date().toLocaleString('ar-EG'),
      messages: messages.length,
      sessions: rawSessions.length,
      cases: caseContexts.caseEngine.caseCount,
      staffRuns,
      errors: [],
    };
  }, [actorName, user?.id]);

  const scanOnce = useCallback(async () => {
    if (!handleRef.current || scanningRef.current) return;
    scanningRef.current = true;
    setScanning(true);
    try {
      const candidates = await getUnprocessedWhatsAppExports(handleRef.current, 10);
      if (!candidates.length) {
        toast.message('لا توجد ملفات جديدة في الفولدر');
        return;
      }

      const processCandidate = async (candidate: (typeof candidates)[number]): Promise<FileRun> => {
        try {
          const result = await analyzeFile(candidate.file);
          await saveLocalWhatsAppAnalysisHistory<FileRun>(candidate.key, candidate.name, result);
          markLocalWhatsAppFileProcessed(candidate.key);
          toast.success(`تم تحليل ${candidate.name}: ${result.sessions} جلسة → ${result.cases} حالة / ${result.staffRuns.length} مسؤول`);
          return result;
        } catch (error) {
          const reason = error instanceof Error ? error.message : 'خطأ غير معروف';
          markLocalWhatsAppFileFailed(candidate.key, reason);
          return {
            fileName: candidate.name,
            at: new Date().toLocaleString('ar-EG'),
            messages: 0,
            sessions: 0,
            cases: 0,
            staffRuns: [],
            errors: [reason],
          };
        }
      };

      // ملفان فقط بالتوازي: يختصر زمن إعادة تحليل فولدر كامل، مع سقف محافظ لطلبات
      // قاعدة البيانات. تحديث الواجهة مرة لكل batch بدل rerender بعد كل ملف.
      const FILE_CONCURRENCY = 2;
      for (let index = 0; index < candidates.length; index += FILE_CONCURRENCY) {
        const batch = candidates.slice(index, index + FILE_CONCURRENCY);
        const results = await Promise.all(batch.map(processCandidate));
        setRuns((current) => [...results.reverse(), ...current].slice(0, 30));
        if (typeof window !== 'undefined' && index + FILE_CONCURRENCY < candidates.length) {
          await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
        }
      }
    } finally {
      scanningRef.current = false;
      setScanning(false);
    }
  }, [analyzeFile]);

  useEffect(() => {
    void (async () => {
      try {
        const history = await loadLocalWhatsAppAnalysisHistory<FileRun>(30);
        if (history.length) setRuns(history.map((row) => row.payload));
      } catch (error) {
        console.warn('[whatsapp-watcher] failed to restore local analysis history', error);
      }

      const handle = await restoreLocalWhatsAppFolder();
      if (!handle) return;
      if (await queryLocalWhatsAppFolderPermission(handle, false) !== 'granted') return;
      handleRef.current = handle;
      setConnected(true);
    })();
  }, []);

  useEffect(() => {
    if (!connected) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) void scanOnce();
    }, INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [connected, scanOnce]);

  async function reanalyzeExisting() {
    resetLocalWhatsAppProcessedLedger();
    setRuns([]);
    toast.success('تمت إعادة تهيئة سجل الملفات — هنعيد تحليل الملفات الموجودة في الفولدر');
    await scanOnce();
  }

  async function connect() {
    try {
      const handle = await connectLocalWhatsAppFolder();
      handleRef.current = handle;
      setConnected(true);
      toast.success('تم ربط فولدر محادثات واتساب');
      void scanOnce();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر ربط الفولدر');
    }
  }

  function openOfficialReview(item: StaffRun) {
    writePendingConversationReviewTransfer(item.snapshot);
    navigate('/reviews?mode=new&fromSmart=1');
  }

  function openCustomerRequest(item: StaffRun) {
    if (!item.actions.customerRequest) return;
    writeSmartCustomerRequestTransfer(item.actions.customerRequest);
    navigate('/customer-requests?createFromSmart=1');
  }

  function openFollowup(item: StaffRun) {
    if (!item.actions.followup) return;
    writeSmartFollowupTransfer(item.actions.followup);
    navigate('/customer-service?quickFollowup=1');
  }

  const overview = useMemo(() => {
    const allStaff = runs.flatMap((run) => run.staffRuns);
    const clear = allStaff.filter((item) => item.decision === 'clear').length;
    const issues = allStaff.filter((item) => item.decision === 'issue').length;
    const review = allStaff.length - clear - issues;
    const followups = allStaff.filter((item) => item.intelligence?.followup.detected).length;
    const opportunities = allStaff.reduce((sum, item) => sum + (item.intelligence?.salesOpportunities.length || 0), 0);
    return { files: runs.length, staff: allStaff.length, clear, issues, review, followups, opportunities };
  }, [runs]);

  const filteredRuns = useMemo(() => {
    const query = runQuery.trim().toLowerCase();
    if (!query) return runs;
    return runs.filter((run) =>
      run.fileName.toLowerCase().includes(query) ||
      run.staffRuns.some((item) =>
        item.staffName.toLowerCase().includes(query) ||
        String(item.customerName || '').toLowerCase().includes(query)
      )
    );
  }, [runs, runQuery]);

  function runKey(run: FileRun, index: number) {
    return `${run.fileName}-${run.at}-${index}`;
  }

  function toggleRun(run: FileRun, index: number) {
    const key = runKey(run, index);
    setExpandedRuns((current) => ({ ...current, [key]: !current[key] }));
  }

  function openDetails(item: StaffRun) {
    setSelected(item);
    setDetailTab('overview');
    setConversationView('whatsapp');
    setConversationFocusMode('focused');
  }

  function intentLabel(value?: string | null) {
    const map: Record<string, string> = {
      product_request: 'طلب منتج',
      consultation: 'استشارة',
      service_followup: 'متابعة خدمة',
      service_recovery: 'اعتذار/استعادة خدمة',
      complaint: 'شكوى',
      availability: 'استعلام عن توافر',
      general: 'خدمة عامة',
    };
    return value ? (map[value] || value) : 'غير محدد';
  }

  function caseLabel(item: StaffRun) {
    const evaluation = item.snapshot.smartIntelligence?.evaluationV2;
    if (evaluation?.serviceRecovery.detected) {
      return evaluation.serviceRecovery.issueType === 'order_delay'
        ? 'اعتذار/متابعة تأخير أوردر'
        : 'استعادة خدمة';
    }
    return intentLabel(item.intelligence?.primaryIntent);
  }

  function consultationLabel(value?: string | null) {
    if (!value || value === 'not_applicable') return 'غير منطبق';
    if (value === 'clear') return 'واضحة';
    if (value === 'partial') return 'جزئية';
    if (value === 'needs_review') return 'تحتاج مراجعة';
    return value;
  }

  return (
    <div dir="rtl" className="mx-auto max-w-7xl space-y-4 p-3 md:p-5">
      <section className="dawaa-card dawaa-card--raised overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 p-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-black text-cyan-300"><Sparkles size={14} /> SMART REVIEW</div>
            <h1 className="mt-1 text-xl font-black text-white md:text-2xl">مركز مراجعة محادثات واتساب</h1>
            <p className="mt-1 text-xs text-slate-400">الملفات تتحلل تلقائيًا، وافتح فقط الحالات التي تحتاج قرارًا أو اعتمادًا.</p>
          </div>
          {!supportsLocalWhatsAppInbox() ? (
            <div className="rounded-xl border border-amber-700/50 bg-amber-950/20 px-3 py-2 text-xs text-amber-100">استخدم Chrome أو Edge لربط فولدر محلي.</div>
          ) : !connected ? (
            <button type="button" onClick={() => void connect()} className="rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-black text-slate-950">
              <span className="inline-flex items-center gap-2"><FolderOpen size={16} /> ربط فولدر التصدير</span>
            </button>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={scanning} onClick={() => void scanOnce()} className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-black text-white disabled:opacity-50">
                <span className="inline-flex items-center gap-2">{scanning ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} فحص الآن</span>
              </button>
              <button type="button" disabled={scanning} onClick={() => void reanalyzeExisting()} className="rounded-xl border border-cyan-700/60 bg-cyan-950/20 px-3 py-2 text-xs font-black text-cyan-100 disabled:opacity-50">
                إعادة تحليل
              </button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-px bg-slate-800 sm:grid-cols-4 lg:grid-cols-7">
          {[
            ['ملفات', overview.files, 'text-white'],
            ['مسؤولون', overview.staff, 'text-white'],
            ['سليمة', overview.clear, 'text-emerald-300'],
            ['ملاحظات', overview.issues, 'text-amber-300'],
            ['مراجعة', overview.review, 'text-rose-300'],
            ['متابعات', overview.followups, 'text-cyan-300'],
            ['فرص بيع', overview.opportunities, 'text-violet-300'],
          ].map(([label, value, tone]) => (
            <div key={String(label)} className="bg-[#111c2b] px-3 py-3 text-center">
              <div className="text-[10px] font-bold text-slate-500">{label}</div>
              <div className={`mt-1 text-lg font-black ${tone}`}>{value}</div>
            </div>
          ))}
        </div>
        {connected ? <div className="border-t border-slate-800 px-4 py-2 text-[11px] font-bold text-emerald-300">● الفولدر متصل — فحص تلقائي كل دقيقة أثناء فتح التطبيق</div> : null}
      </section>

      <section className="dawaa-card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 p-3">
          <div className="font-black text-white">الملفات المحللة</div>
          <div className="relative w-full sm:w-80">
            <Search size={15} className="absolute right-3 top-2.5 text-slate-500" />
            <input
              value={runQuery}
              onChange={(event) => setRunQuery(event.target.value)}
              placeholder="ابحث باسم الملف أو الدكتور أو العميل"
              className="w-full rounded-xl border border-slate-700 bg-slate-950/40 py-2 pr-9 pl-3 text-xs text-white outline-none focus:border-cyan-600"
            />
          </div>
        </div>

        {!filteredRuns.length ? (
          <div className="p-8 text-center text-sm text-slate-400">
            {runs.length ? 'لا توجد نتائج مطابقة للبحث.' : 'لسه مفيش ملفات محللة. لو الملفات موجودة استخدم «إعادة تحليل».'}
          </div>
        ) : (
          <div className="divide-y divide-slate-800">
            {filteredRuns.map((run, runIndex) => {
              const key = runKey(run, runIndex);
              const expanded = Boolean(expandedRuns[key]);
              const clearCount = run.staffRuns.filter((item) => item.decision === 'clear').length;
              const issueCount = run.staffRuns.filter((item) => item.decision === 'issue').length;
              const reviewCount = run.staffRuns.length - clearCount - issueCount;
              return (
                <article key={key}>
                  <button type="button" onClick={() => toggleRun(run, runIndex)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-right transition hover:bg-slate-950/25">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-black text-white">{run.fileName}</div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
                        <span>{run.at}</span><span>{run.messages} رسالة</span><span>{run.sessions} جلسة خام</span><span>{run.cases ?? run.sessions} حالة/رحلة</span><span>{run.staffRuns.length} مسؤول</span>
                      </div>
                    </div>
                    <div className="hidden flex-wrap items-center gap-1.5 sm:flex">
                      {clearCount ? <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-[10px] font-black text-emerald-300">{clearCount} سليمة</span> : null}
                      {issueCount ? <span className="rounded-full bg-amber-500/10 px-2 py-1 text-[10px] font-black text-amber-300">{issueCount} ملاحظة</span> : null}
                      {reviewCount ? <span className="rounded-full bg-rose-500/10 px-2 py-1 text-[10px] font-black text-rose-300">{reviewCount} مراجعة</span> : null}
                    </div>
                    {expanded ? <ChevronUp size={18} className="shrink-0 text-slate-500" /> : <ChevronDown size={18} className="shrink-0 text-slate-500" />}
                  </button>

                  {expanded ? (
                    <div className="border-t border-slate-800 bg-slate-950/15 p-3">
                      {run.errors.length ? (
                        <div className="rounded-xl border border-rose-800/40 bg-rose-950/20 p-3 text-sm text-rose-200">{run.errors.map((error) => <div key={error}>• {error}</div>)}</div>
                      ) : (
                        <div className="space-y-3">
                          {groupStaffRunsByCase(run).map((caseGroup, caseIndex) => (
                            <section key={caseGroup.caseId} className="overflow-hidden rounded-2xl border border-cyan-900/40 bg-cyan-950/5">
                              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-3 py-2.5">
                                <div>
                                  <div className="text-xs font-black text-cyan-200">حالة/رحلة {caseIndex + 1}: {caseGroup.summary}</div>
                                  <div className="mt-1 text-[10px] text-slate-500">
                                    {caseGroup.sessionCount} جلسة خام مرتبطة · {caseGroup.items.length} مسؤول · {caseGroup.customerName || 'عميل غير محدد'}
                                  </div>
                                </div>
                                {caseGroup.sessionCount > 1 ? (
                                  <span className="rounded-full bg-violet-500/10 px-2.5 py-1 text-[10px] font-black text-violet-200">
                                    تم دمج الجلسات في رحلة واحدة
                                  </span>
                                ) : null}
                              </div>
                              <div className="space-y-2 p-2.5">
                                {caseGroup.items.map((item, index) => (
                                  <button
                                    type="button"
                                    onClick={() => openDetails(item)}
                                    key={`${item.sessionId}-${item.staffName}-${item.role}-${index}`}
                                    className="grid w-full items-center gap-2 rounded-xl border border-slate-800 bg-[#111c2b]/70 px-3 py-2.5 text-right transition hover:border-cyan-700/60 hover:bg-cyan-950/10 md:grid-cols-[1.2fr_.8fr_.7fr_.6fr_auto]"
                                  >
                                    <div className="min-w-0">
                                      <div className="truncate text-sm font-black text-white">{item.staffIdentity.canonicalStaffName || item.staffName}</div>
                                      <div className="truncate text-[10px] text-slate-500">{roleLabel(item.role)} · {item.staffIdentity.branch || item.branchHint.value || 'فرع غير محدد'}</div>
                                    </div>
                                    <div className="truncate text-xs text-slate-300">{caseLabel(item)}</div>
                                    <div className="text-xs text-slate-400">{item.intelligence?.salesOpportunities.length || 0} فرصة · {item.intelligence?.followup.detected ? 'متابعة' : 'بدون متابعة'}</div>
                                    <div className="truncate text-[11px] text-slate-500">{item.customerName || 'عميل غير محدد'}</div>
                                    <div className="flex items-center gap-2 justify-self-end">
                                      <span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${item.decision === 'clear' ? 'bg-emerald-500/15 text-emerald-200' : item.decision === 'issue' ? 'bg-amber-500/15 text-amber-200' : 'bg-rose-500/15 text-rose-200'}`}>{decisionLabel(item.decision)}</span>
                                      <ArrowLeft size={14} className="text-cyan-300" />
                                    </div>
                                  </button>
                                ))}
                              </div>
                            </section>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>

      {selected ? (
        <div className="fixed inset-0 z-[120] bg-slate-950/80 backdrop-blur-sm" onClick={() => setSelected(null)}>
          <div className="mx-auto flex h-full max-w-6xl flex-col border-x border-slate-700 bg-[#111c2b] shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-700 bg-[#111c2b]/95 p-4 backdrop-blur">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="truncate text-xl font-black text-white">{selected.staffIdentity.canonicalStaffName || selected.staffName}</div>
                  <span className={`rounded-full px-2 py-1 text-[10px] font-black ${selected.decision === 'clear' ? 'bg-emerald-500/15 text-emerald-200' : selected.decision === 'issue' ? 'bg-amber-500/15 text-amber-200' : 'bg-rose-500/15 text-rose-200'}`}>{decisionLabel(selected.decision)}</span>
                </div>
                <div className="mt-1 text-xs text-slate-400">{roleLabel(selected.role)} · {selected.staffIdentity.branch || selected.branchHint.value || 'فرع غير محدد'} · {selected.customerName || 'عميل غير محدد'}</div>
              </div>
              <button type="button" onClick={() => setSelected(null)} className="rounded-xl border border-slate-700 p-2 text-slate-300"><X size={18} /></button>
            </div>

            <div className="flex shrink-0 gap-1 border-b border-slate-800 bg-slate-950/20 px-3 pt-2">
              {[
                ['overview', 'الخلاصة'],
                ['conversation', `المحادثة (${selected.snapshot.messages.length})`],
                ['review', 'التقييم المقترح'],
              ].map(([key, label]) => (
                <button key={key} type="button" onClick={() => setDetailTab(key as 'overview' | 'conversation' | 'review')} className={`rounded-t-xl px-4 py-2 text-xs font-black ${detailTab === key ? 'bg-cyan-500 text-slate-950' : 'text-slate-400 hover:text-white'}`}>{label}</button>
              ))}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {detailTab === 'overview' ? (
                <div className="space-y-3">
                  <section className="rounded-2xl border border-violet-800/40 bg-violet-950/10 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-[10px] font-black text-violet-300">CASE CONTEXT V27</div>
                        <div className="mt-1 text-sm font-black text-white">{selected.caseSummary}</div>
                        <div className="mt-1 text-[11px] leading-5 text-slate-400">
                          التقييم اتبنى على رحلة واحدة تضم {selected.caseSessionCount} جلسة خام، مع فصل مسؤولية كل موظف حسب رسائله الفعلية.
                        </div>
                      </div>
                      <div className="rounded-xl bg-black/15 px-3 py-2 text-center">
                        <div className="text-[10px] text-slate-500">المشاركون</div>
                        <div className="mt-1 text-xs font-black text-violet-100">{selected.caseStaffNames.length || 1}</div>
                      </div>
                    </div>
                  </section>

                  {selected.snapshot.smartIntelligence?.timingV28 ? (
                    <section className="rounded-2xl border border-cyan-800/40 bg-cyan-950/10 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="text-[10px] font-black text-cyan-300">TIMING INTELLIGENCE V28</div>
                          <div className="mt-1 text-sm font-black text-white">زمن الرد ومسار الأوردر عبر الرحلة كاملة</div>
                          <div className="mt-1 text-[11px] text-slate-400">
                            {selected.snapshot.smartIntelligence.timingV28.episodes.length} مرحلة زمنية · {selected.snapshot.smartIntelligence.timingV28.handoff.responderCount} مسؤول رد · {selected.snapshot.smartIntelligence.timingV28.handoff.handoffCount} handoff
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-5">
                          <div className="rounded-xl bg-black/15 px-3 py-2"><div className="text-[10px] text-slate-500">أول رد للرحلة</div><div className="mt-1 text-xs font-black text-cyan-100">{timingDuration(selected.snapshot.smartIntelligence.timingV28.responseSummary.firstResponseSeconds)}</div></div>
                          <div className="rounded-xl bg-black/15 px-3 py-2"><div className="text-[10px] text-slate-500">رد المسؤول الحالي</div><div className="mt-1 text-xs font-black text-violet-100">{timingDuration(selected.snapshot.smartIntelligence.staffTimingV28?.responseSummary.firstResponseSeconds)}</div></div>
                          <div className="rounded-xl bg-black/15 px-3 py-2"><div className="text-[10px] text-slate-500">Median</div><div className="mt-1 text-xs font-black text-cyan-100">{timingDuration(selected.snapshot.smartIntelligence.timingV28.responseSummary.medianResponseSeconds)}</div></div>
                          <div className="rounded-xl bg-black/15 px-3 py-2"><div className="text-[10px] text-slate-500">≤ 5 دقائق</div><div className="mt-1 text-xs font-black text-cyan-100">{selected.snapshot.smartIntelligence.timingV28.responseSummary.within5mRate ?? '—'}{selected.snapshot.smartIntelligence.timingV28.responseSummary.within5mRate != null ? '%' : ''}</div></div>
                          <div className="rounded-xl bg-black/15 px-3 py-2"><div className="text-[10px] text-slate-500">بدون رد</div><div className="mt-1 text-xs font-black text-cyan-100">{selected.snapshot.smartIntelligence.timingV28.responseSummary.unansweredTurns}</div></div>
                        </div>
                      </div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                        <div className="rounded-xl border border-slate-800 bg-black/10 p-3">
                          <div className="text-[10px] text-slate-500">طلب العميل</div>
                          <div className="mt-1 text-xs font-black text-white">{selected.snapshot.smartIntelligence.timingV28.orderTimeline.requestAt ? new Date(selected.snapshot.smartIntelligence.timingV28.orderTimeline.requestAt).toLocaleString('ar-EG') : 'غير مرصود'}</div>
                        </div>
                        <div className="rounded-xl border border-slate-800 bg-black/10 p-3">
                          <div className="text-[10px] text-slate-500">الطلب → أول رد</div>
                          <div className="mt-1 text-xs font-black text-white">{timingDuration(selected.snapshot.smartIntelligence.timingV28.orderTimeline.requestToFirstResponseSeconds)}</div>
                        </div>
                        <div className="rounded-xl border border-slate-800 bg-black/10 p-3">
                          <div className="text-[10px] text-slate-500">الطلب → التأكيد</div>
                          <div className="mt-1 text-xs font-black text-white">{timingDuration(selected.snapshot.smartIntelligence.timingV28.orderTimeline.requestToConfirmationSeconds)}</div>
                        </div>
                        <div className="rounded-xl border border-slate-800 bg-black/10 p-3">
                          <div className="text-[10px] text-slate-500">ظهور مشكلة/تأخير</div>
                          <div className="mt-1 text-xs font-black text-white">{selected.snapshot.smartIntelligence.timingV28.orderTimeline.delayOrProblemAt ? new Date(selected.snapshot.smartIntelligence.timingV28.orderTimeline.delayOrProblemAt).toLocaleString('ar-EG') : 'غير مرصود'}</div>
                        </div>
                        <div className="rounded-xl border border-slate-800 bg-black/10 p-3">
                          <div className="text-[10px] text-slate-500">المشكلة → Recovery</div>
                          <div className="mt-1 text-xs font-black text-white">{timingDuration(selected.snapshot.smartIntelligence.timingV28.orderTimeline.problemToRecoverySeconds)}</div>
                        </div>
                      </div>
                    </section>
                  ) : null}

                  {selected.snapshot.smartIntelligence?.delayAttributionV29?.detected ? (
                    <section className="rounded-2xl border border-amber-700/40 bg-amber-950/10 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="text-[10px] font-black text-amber-300">DELAY ATTRIBUTION V29</div>
                          <div className="mt-1 text-sm font-black text-white">{selected.snapshot.smartIntelligence.delayAttributionV29.label}</div>
                          <div className="mt-1 text-[11px] text-slate-400">
                            المسؤولية التشغيلية: {
                              selected.snapshot.smartIntelligence.delayAttributionV29.caseResponsibility === 'staff_response' ? 'زمن رد'
                              : selected.snapshot.smartIntelligence.delayAttributionV29.caseResponsibility === 'pharmacy_operations' ? 'تجهيز/تنفيذ داخلي'
                              : selected.snapshot.smartIntelligence.delayAttributionV29.caseResponsibility === 'delivery' ? 'التوصيل/المندوب'
                              : selected.snapshot.smartIntelligence.delayAttributionV29.caseResponsibility === 'shared_handoff' ? 'تسليم المسؤولية بين أكثر من موظف'
                              : 'غير محسومة/قد تعتمد على العميل'
                            } · ثقة {selected.snapshot.smartIntelligence.delayAttributionV29.confidence}%
                          </div>
                        </div>
                        <div className="rounded-xl bg-black/15 px-3 py-2 text-center">
                          <div className="text-[10px] text-slate-500">المشكلة → أول معالجة</div>
                          <div className="mt-1 text-xs font-black text-amber-100">{timingDuration(selected.snapshot.smartIntelligence.delayAttributionV29.problemToRecoverySeconds)}</div>
                        </div>
                      </div>
                      <div className="mt-3 grid gap-2 md:grid-cols-2">
                        <div className="rounded-xl bg-black/10 p-3">
                          <div className="text-[10px] font-black text-slate-500">لماذا وصلنا لهذا التفسير؟</div>
                          <div className="mt-1 space-y-1 text-xs leading-5 text-slate-300">
                            {selected.snapshot.smartIntelligence.delayAttributionV29.reasons.map((reason) => <div key={reason}>• {reason}</div>)}
                          </div>
                        </div>
                        <div className="rounded-xl bg-black/10 p-3">
                          <div className="text-[10px] font-black text-slate-500">المسؤول الذي عالج المشكلة</div>
                          <div className="mt-1 text-sm font-black text-white">{selected.snapshot.smartIntelligence.delayAttributionV29.responsibleStaffName || 'غير محسوم'}</div>
                          <div className="mt-1 text-[11px] text-slate-400">{selected.snapshot.smartIntelligence.delayAttributionV29.responsibleRole || ''}</div>
                          {selected.snapshot.smartIntelligence.delayAttributionV29.trainingFocus ? <div className="mt-2 text-xs leading-5 text-amber-100">{selected.snapshot.smartIntelligence.delayAttributionV29.trainingFocus}</div> : null}
                        </div>
                      </div>
                      <div className="mt-3 rounded-xl border border-emerald-800/30 bg-emerald-950/10 px-3 py-2 text-[11px] text-emerald-200">
                        لا يتم خصم نقاط تلقائيًا بسبب سبب التأخير نفسه؛ التقييم يحاسب الموظف على زمن رده وطريقة تعامله مع الجزء الذي استلمه فقط.
                      </div>
                    </section>
                  ) : null}

                                    <section className="grid gap-3 lg:grid-cols-2">
                    <div className={`rounded-2xl border p-4 ${selected.staffIdentity.ambiguous ? 'border-rose-800/60 bg-rose-950/20' : selected.staffIdentity.staffId ? 'border-emerald-800/50 bg-emerald-950/10' : 'border-amber-800/50 bg-amber-950/10'}`}>
                      <div className="text-[10px] font-black text-slate-500">هوية المسؤول</div>
                      {selected.staffIdentity.staffId && !selected.staffIdentity.ambiguous ? (
                        <div className="mt-2 text-sm text-emerald-100">
                          <span className="text-slate-400">{selected.staffIdentity.displayName}</span><span className="mx-2 text-emerald-400">→</span><b>{selected.staffIdentity.canonicalStaffName}</b>
                          <div className="mt-1 text-xs text-slate-400">{selected.staffIdentity.role || '-'} · {selected.staffIdentity.branch || 'فرع غير محدد'} · ثقة {selected.staffIdentity.identityConfidence}%</div>
                        </div>
                      ) : (
                        <div className="mt-2 text-xs font-bold text-amber-200">{selected.staffIdentity.ambiguous ? 'المسؤول غير محسوم ويحتاج اختيارًا يدويًا.' : `لم يتم تحديد staff_id لـ ${selected.staffIdentity.displayName}`}</div>
                      )}
                    </div>

                    <div className="rounded-2xl border border-slate-800 bg-slate-950/20 p-4">
                      <div className="text-[10px] font-black text-slate-500">هوية العميل</div>
                      {selected.snapshot.smartIntelligence?.customer?.customer ? (
                        <div className="mt-2 text-sm text-cyan-100">
                          <b>{selected.snapshot.smartIntelligence.customer.customer.name}</b>
                          <div className="mt-1 text-xs text-slate-400">كود {selected.snapshot.smartIntelligence.customer.customer.code || '-'} · {selected.snapshot.smartIntelligence.customer.customer.branch || 'فرع غير محدد'} · ثقة {Math.round(selected.snapshot.smartIntelligence.customer.confidence * 100)}%</div>
                        </div>
                      ) : selected.customerName ? (
                        <div className="mt-2">
                          <div className="text-sm font-black text-cyan-100">{selected.customerName}</div>
                          <div className="mt-1 text-[11px] leading-5 text-slate-500">
                            اسم مستخرج من ملف التصدير/المحادثة كـ hint للبحث — لم يتم ربطه بسجل عميل مؤكد بعد.
                          </div>
                          <div className="mt-1 text-xs text-slate-400">{selected.snapshot.smartIntelligence?.customer?.reason || 'تعذر تحديد العميل تلقائيًا.'}</div>
                        </div>
                      ) : (
                        <div className="mt-2 text-xs text-slate-400">{selected.snapshot.smartIntelligence?.customer?.reason || 'تعذر تحديد العميل تلقائيًا.'}</div>
                      )}
                    </div>
                  </section>

                  <section className="grid grid-cols-2 gap-2 md:grid-cols-4">
                    <div className="rounded-xl border border-slate-800 bg-slate-950/30 p-3"><div className="text-[10px] text-slate-500">النية</div><div className="mt-1 text-sm font-black text-white">{caseLabel(selected)}</div></div>
                    <div className="rounded-xl border border-slate-800 bg-slate-950/30 p-3"><div className="text-[10px] text-slate-500">فرص البيع</div><div className="mt-1 text-sm font-black text-white">{selected.intelligence?.salesOpportunities.length || 0}</div></div>
                    <div className="rounded-xl border border-slate-800 bg-slate-950/30 p-3"><div className="text-[10px] text-slate-500">الاستشارة</div><div className="mt-1 text-sm font-black text-white">{consultationLabel(selected.intelligence?.consultationCommunication)}</div></div>
                    <div className="rounded-xl border border-slate-800 bg-slate-950/30 p-3"><div className="text-[10px] text-slate-500">الاعتماد السريع</div><div className="mt-1 text-sm font-black text-white">{selected.safe ? 'ممكن بعد مراجعة' : 'غير مسموح'}</div></div>
                  </section>

                  {selected.snapshot.smartIntelligence?.evaluationV2 ? (
                    <section className="rounded-2xl border border-cyan-800/40 bg-cyan-950/10 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="text-[10px] font-black text-cyan-300">CONVERSATION OUTCOME V2</div>
                          <div className="mt-1 text-base font-black text-white">{selected.snapshot.smartIntelligence.evaluationV2.sale.label}</div>
                          <div className="mt-1 text-xs leading-6 text-slate-400">{selected.snapshot.smartIntelligence.evaluationV2.sale.reason}</div>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-center text-[10px]">
                          <div className="rounded-xl bg-black/15 px-3 py-2"><div className="text-slate-500">جودة</div><b className="text-white">{selected.snapshot.smartIntelligence.evaluationV2.qualityScore ?? '-'}</b></div>
                          <div className="rounded-xl bg-black/15 px-3 py-2"><div className="text-slate-500">تغطية</div><b className="text-cyan-200">{selected.snapshot.smartIntelligence.evaluationV2.evidenceCoverage}%</b></div>
                          <div className="rounded-xl bg-black/15 px-3 py-2"><div className="text-slate-500">ثقة</div><b className="text-emerald-200">{selected.snapshot.smartIntelligence.evaluationV2.confidence}%</b></div>
                        </div>
                      </div>
                      {selected.snapshot.smartIntelligence.evaluationV2.warnings.length ? (
                        <div className="mt-3 space-y-1 rounded-xl border border-amber-800/30 bg-amber-950/10 p-3 text-[11px] text-amber-100">
                          {selected.snapshot.smartIntelligence.evaluationV2.warnings.map((warning) => <div key={warning}>• {warning}</div>)}
                        </div>
                      ) : null}
                    </section>
                  ) : null}

                  {(selected.reasons.length || selected.intelligence?.salesOpportunities.length) ? (
                    <section className="grid gap-3 lg:grid-cols-2">
                      <div className="rounded-2xl border border-amber-800/30 bg-amber-950/10 p-4">
                        <div className="flex items-center gap-2 font-black text-amber-100"><AlertTriangle size={15} /> أهم الملاحظات</div>
                        <div className="mt-2 space-y-1 text-xs leading-6 text-slate-300">
                          {selected.reasons.length ? selected.reasons.slice(0, 5).map((reason) => <div key={reason}>• {reason}</div>) : <div className="text-slate-500">لا توجد ملاحظات مؤثرة.</div>}
                        </div>
                      </div>
                      <div className="rounded-2xl border border-violet-800/30 bg-violet-950/10 p-4">
                        <div className="font-black text-violet-100">فرص البيع</div>
                        <div className="mt-2 space-y-2">
                          {selected.intelligence?.salesOpportunities.length ? selected.intelligence.salesOpportunities.slice(0, 4).map((opportunity, index) => (
                            <div key={`${opportunity.triggerMessageId}-${index}`} className="text-xs leading-6 text-slate-300">
                              <b className="text-cyan-200">{opportunityLabel(opportunity.handling)}</b> · {opportunity.reason}
                            </div>
                          )) : <div className="text-xs text-slate-500">لا توجد فرص بيع مرصودة.</div>}
                        </div>
                      </div>
                    </section>
                  ) : null}

                  <section className="rounded-2xl border border-sky-800/40 bg-sky-950/10 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-black text-sky-200">Cross-check</span>
                      <b className="text-sm text-white">{selected.journeyCrossCheck.journeyLabel}</b>
                    </div>
                    <div className="mt-1 text-xs text-slate-400">{selected.journeyCrossCheck.saleStateLabel}</div>
                  </section>
                </div>
              ) : null}

              {detailTab === 'conversation' ? (
                <section className="overflow-hidden rounded-2xl border border-slate-800">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-slate-950/35 p-3">
                    <div>
                      <div className="text-sm font-black text-white">المحادثة والأدلة</div>
                      <div className="mt-0.5 text-[10px] text-slate-500">
                        الافتراضي يعرض فقط الرسائل اللازمة لتقييم المسؤول الحالي؛ الرحلة الكاملة متاحة للمراجعة عند الحاجة.
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {selected.snapshot.conversationFocusV30 ? (
                        <div className="inline-flex rounded-xl border border-violet-800/50 bg-violet-950/20 p-1 text-[11px] font-black">
                          <button type="button" onClick={() => setConversationFocusMode('focused')} className={`rounded-lg px-3 py-1.5 ${conversationFocusMode === 'focused' ? 'bg-violet-500 text-white' : 'text-slate-300'}`}>
                            المحادثة المقيمة ({selected.snapshot.messages.length})
                          </button>
                          <button type="button" onClick={() => setConversationFocusMode('full')} className={`rounded-lg px-3 py-1.5 ${conversationFocusMode === 'full' ? 'bg-slate-700 text-white' : 'text-slate-300'}`}>
                            الرحلة كاملة ({selected.snapshot.fullCaseMessages?.length || selected.snapshot.conversationFocusV30.messageCount})
                          </button>
                        </div>
                      ) : null}
                      <div className="inline-flex rounded-xl border border-slate-700 bg-slate-900 p-1 text-[11px] font-black">
                        <button type="button" onClick={() => setConversationView('whatsapp')} className={`rounded-lg px-3 py-1.5 ${conversationView === 'whatsapp' ? 'bg-emerald-500 text-slate-950' : 'text-slate-300'}`}>واتساب</button>
                        <button type="button" onClick={() => setConversationView('review')} className={`rounded-lg px-3 py-1.5 ${conversationView === 'review' ? 'bg-cyan-500 text-slate-950' : 'text-slate-300'}`}>تحليلي</button>
                      </div>
                    </div>
                  </div>
                  {conversationView === 'whatsapp' ? (
                    <div className="h-[62vh] overflow-y-auto p-4 md:p-5" style={{ backgroundColor: '#0b141a', backgroundImage: 'radial-gradient(circle at 25% 25%, rgba(255,255,255,.025) 0 1px, transparent 1px)', backgroundSize: '28px 28px' }}>
                      <div className="mx-auto max-w-3xl space-y-2" dir="rtl">
                        {(conversationFocusMode === 'full' && selected.snapshot.fullCaseMessages?.length ? selected.snapshot.fullCaseMessages : selected.snapshot.messages).map((message) => {
                          const inbound = message.direction === 'inbound';
                          const context = message.scope === 'context';
                          const focusLevel = message.focusLevel || (message.evidence ? 'primary' : context ? 'background' : 'supporting');
                          const focusedOpacity = conversationFocusMode === 'focused'
                            ? 'opacity-100'
                            : focusLevel === 'primary'
                              ? 'opacity-100'
                              : focusLevel === 'supporting'
                                ? 'opacity-75'
                                : 'opacity-25 hover:opacity-65';
                          const timing = selected.snapshot.smartIntelligence?.timingV28;
                          const episode = timing?.episodes.find((row) => row.messageIds[0] === message.id) || null;
                          return (
                            <div key={message.id}>
                              {episode ? (
                                <div className="my-4 flex items-center gap-3" dir="rtl">
                                  <div className="h-px flex-1 bg-slate-700/60" />
                                  <div className="rounded-full border border-slate-700 bg-[#111b21] px-3 py-1.5 text-center shadow-sm">
                                    <div className="text-[10px] font-black text-cyan-200">{episode.label}</div>
                                    <div className="mt-0.5 text-[9px] text-slate-400">
                                      {new Date(episode.startedAt).toLocaleString('ar-EG', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                      {episodeGapLabel(episode.gapFromPreviousMinutes) ? ` · ${episodeGapLabel(episode.gapFromPreviousMinutes)}` : ''}
                                    </div>
                                  </div>
                                  <div className="h-px flex-1 bg-slate-700/60" />
                                </div>
                              ) : null}
                              <div className={`flex ${inbound ? 'justify-start' : 'justify-end'} transition-opacity ${focusedOpacity}`}>
                                <div className={`flex max-w-[86%] flex-col md:max-w-[74%] ${inbound ? 'items-start' : 'items-end'}`}>
                                  <div className={`relative rounded-2xl px-3.5 py-2.5 shadow-sm ${inbound ? 'rounded-tl-sm bg-[#202c33] text-slate-100' : 'rounded-tr-sm bg-[#005c4b] text-white'} ${message.evidence ? 'ring-2 ring-cyan-400/80 ring-offset-2 ring-offset-[#0b141a]' : ''}`}>
                                    <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[10px] font-bold opacity-80"><span>{inbound ? 'العميل' : message.sender || selected.staffName}</span>{message.evidence ? <span className="rounded bg-cyan-400/15 px-1.5 py-0.5 text-cyan-100">دليل</span> : null}{focusLevel === 'primary' ? <span className="rounded bg-violet-400/15 px-1.5 py-0.5 text-violet-100">محوري</span> : focusLevel === 'supporting' ? <span className="rounded bg-sky-400/10 px-1.5 py-0.5 text-sky-100">مساند</span> : <span className="rounded bg-white/10 px-1.5 py-0.5">خلفية</span>}</div>
                                    {messageBody(message.kind, message.text)}
                                    <div className="mt-1 text-left text-[10px] opacity-60">{new Date(message.timestamp).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}</div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="h-[62vh] space-y-2 overflow-y-auto bg-slate-950/20 p-4">
                      {(conversationFocusMode === 'full' && selected.snapshot.fullCaseMessages?.length ? selected.snapshot.fullCaseMessages : selected.snapshot.messages).map((message) => (
                        <div key={message.id} className={`rounded-xl border p-3 ${message.evidence ? 'border-cyan-500/60 bg-cyan-950/20' : message.scope === 'context' ? 'border-dashed border-slate-700 bg-slate-950/20 opacity-70' : 'border-slate-800 bg-slate-950/35'}`}>
                          <div className="mb-1 flex flex-wrap justify-between gap-2 text-[11px] text-slate-500"><span>{message.direction === 'inbound' ? 'العميل' : selected.staffName}{message.scope === 'context' ? ' · سياق' : ''}{message.evidence ? ' · دليل' : ''}</span><span>{new Date(message.timestamp).toLocaleString('ar-EG')}</span></div>
                          <div className="text-slate-200">{messageBody(message.kind, message.text)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              ) : null}

              {detailTab === 'review' ? (
                <div className="space-y-3">
                  {selected.snapshot.smartIntelligence?.evaluationV2 ? (
                    <>
                      <section className="rounded-2xl border border-violet-800/50 bg-violet-950/10 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-4">
                          <div>
                            <div className="text-xs font-black text-violet-200">التقييم الذكي — رحلة المحادثة</div>
                            <div className="mt-1 text-2xl font-black text-white">{selected.snapshot.smartIntelligence.evaluationV2.qualityScore ?? '-'}<span className="text-sm text-slate-500">/100</span></div>
                            <div className="mt-1 text-xs text-slate-400">{selected.snapshot.smartIntelligence.evaluationV2.scoreDisplayLabel}</div>
                          </div>
                          <div className="flex flex-wrap gap-2 text-[11px]">
                            <span className="rounded-xl bg-cyan-500/10 px-3 py-2 font-black text-cyan-200">تغطية {selected.snapshot.smartIntelligence.evaluationV2.evidenceCoverage}%</span>
                            <span className="rounded-xl bg-emerald-500/10 px-3 py-2 font-black text-emerald-300">ثقة {selected.snapshot.smartIntelligence.evaluationV2.confidence}%</span>
                            {selected.snapshot.officialReviewDraft ? <span className="rounded-xl bg-amber-500/10 px-3 py-2 font-black text-amber-300">{selected.snapshot.officialReviewDraft.needsReviewCriteriaCount} بند مراجعة</span> : null}
                          </div>
                        </div>
                      </section>

                      <section className="grid gap-2 md:grid-cols-5">
                        {selected.snapshot.smartIntelligence.evaluationV2.axes.map((axis) => (
                          <div key={axis.key} className="rounded-xl border border-slate-800 bg-slate-950/25 p-3">
                            <div className="text-[10px] font-bold text-slate-500">{axis.label}</div>
                            <div className="mt-1 text-xl font-black text-white">{axis.score ?? '-'}</div>
                            <div className="mt-1 text-[10px] text-slate-500">تغطية {axis.coverage}%</div>
                          </div>
                        ))}
                      </section>

                      {selected.snapshot.smartIntelligence.evaluationV2.serviceRecovery.detected ? (
                        <section className="rounded-2xl border border-amber-700/40 bg-amber-950/10 p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <div className="text-xs font-black text-amber-200">استعادة الخدمة / معالجة التأخير</div>
                              <div className="mt-1 text-base font-black text-white">{selected.snapshot.smartIntelligence.evaluationV2.serviceRecovery.summary}</div>
                              <div className="mt-1 text-[11px] text-slate-400">
                                {selected.snapshot.smartIntelligence.evaluationV2.serviceRecovery.issueType === 'order_delay' ? 'تأخير أوردر' : 'مشكلة خدمة'} · ثقة {selected.snapshot.smartIntelligence.evaluationV2.serviceRecovery.confidence}%
                              </div>
                            </div>
                            <div className="rounded-xl bg-black/15 px-4 py-2 text-center">
                              <div className="text-[10px] text-slate-500">Recovery Score</div>
                              <div className="text-2xl font-black text-amber-200">{selected.snapshot.smartIntelligence.evaluationV2.serviceRecovery.score ?? '-'}</div>
                            </div>
                          </div>
                          <div className="mt-3 grid gap-2 md:grid-cols-2">
                            <div className="rounded-xl bg-emerald-500/5 p-3">
                              <div className="text-[10px] font-black text-emerald-300">تم بشكل جيد</div>
                              <div className="mt-1 text-xs leading-6 text-slate-300">
                                {selected.snapshot.smartIntelligence.evaluationV2.serviceRecovery.passed.length
                                  ? selected.snapshot.smartIntelligence.evaluationV2.serviceRecovery.passed.map((item) => <div key={item}>✓ {item}</div>)
                                  : <div className="text-slate-500">لا توجد عناصر مؤكدة.</div>}
                              </div>
                            </div>
                            <div className="rounded-xl bg-rose-500/5 p-3">
                              <div className="text-[10px] font-black text-rose-300">فرص التحسين</div>
                              <div className="mt-1 text-xs leading-6 text-slate-300">
                                {selected.snapshot.smartIntelligence.evaluationV2.serviceRecovery.missing.length
                                  ? selected.snapshot.smartIntelligence.evaluationV2.serviceRecovery.missing.map((item) => <div key={item}>• {item}</div>)
                                  : <div className="text-slate-500">لا توجد نواقص واضحة.</div>}
                              </div>
                            </div>
                          </div>
                        </section>
                      ) : null}

                                            <section className="grid gap-3 lg:grid-cols-2">
                        <div className="rounded-2xl border border-emerald-800/30 bg-emerald-950/10 p-4">
                          <div className="text-xs font-black text-emerald-200">نتيجة البيع</div>
                          <div className="mt-1 text-base font-black text-white">{selected.snapshot.smartIntelligence.evaluationV2.sale.label}</div>
                          <div className="mt-1 text-xs leading-6 text-slate-400">{selected.snapshot.smartIntelligence.evaluationV2.sale.reason}</div>
                          {selected.snapshot.smartIntelligence.evaluationV2.sale.invoiceNumber ? <div className="mt-2 text-xs text-emerald-300">فاتورة {selected.snapshot.smartIntelligence.evaluationV2.sale.invoiceNumber}{selected.snapshot.smartIntelligence.evaluationV2.sale.revenue != null ? ` · ${selected.snapshot.smartIntelligence.evaluationV2.sale.revenue} ج` : ''}</div> : null}
                        </div>
                        <div className="rounded-2xl border border-sky-800/30 bg-sky-950/10 p-4">
                          <div className="text-xs font-black text-sky-200">اكتمال الأوردر</div>
                          <div className="mt-1 text-base font-black text-white">{selected.snapshot.smartIntelligence.evaluationV2.orderCompleteness.applicable ? `${selected.snapshot.smartIntelligence.evaluationV2.orderCompleteness.confirmedCount}/${selected.snapshot.smartIntelligence.evaluationV2.orderCompleteness.requiredCount}` : 'غير منطبق'}</div>
                          {selected.snapshot.smartIntelligence.evaluationV2.orderCompleteness.applicable ? (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {selected.snapshot.smartIntelligence.evaluationV2.orderCompleteness.items.filter((item) => item.status !== 'not_applicable').map((item) => (
                                <span key={item.key} className={`rounded-full px-2 py-1 text-[10px] font-black ${item.status === 'confirmed' ? 'bg-emerald-500/10 text-emerald-300' : item.status === 'missing' ? 'bg-rose-500/10 text-rose-300' : 'bg-slate-800 text-slate-400'}`}>{item.label}</span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </section>

                      <section className="grid gap-3 lg:grid-cols-2">
                        <div className="rounded-2xl border border-slate-800 p-4">
                          <div className="text-xs font-black text-white">الافتتاح والختام</div>
                          <div className="mt-3 grid grid-cols-2 gap-2">
                            <div className="rounded-xl bg-slate-950/30 p-3"><div className="text-[10px] text-slate-500">الافتتاح</div><b className="text-white">{selected.snapshot.smartIntelligence.evaluationV2.opening.score ?? '-'}</b><div className="mt-1 text-[10px] text-slate-500">{selected.snapshot.smartIntelligence.evaluationV2.opening.missing.length ? `ناقص: ${selected.snapshot.smartIntelligence.evaluationV2.opening.missing.join('، ')}` : 'مكتمل'}</div></div>
                            <div className="rounded-xl bg-slate-950/30 p-3"><div className="text-[10px] text-slate-500">الختام</div><b className="text-white">{selected.snapshot.smartIntelligence.evaluationV2.closing.score ?? '-'}</b><div className="mt-1 text-[10px] text-slate-500">{selected.snapshot.smartIntelligence.evaluationV2.closing.missing.length ? `ناقص: ${selected.snapshot.smartIntelligence.evaluationV2.closing.missing.join('، ')}` : 'مكتمل'}</div></div>
                          </div>
                        </div>
                        <div className="rounded-2xl border border-cyan-800/30 bg-cyan-950/10 p-4">
                          <div className="text-xs font-black text-cyan-200">فرص المتابعة القادمة</div>
                          <div className="mt-2 space-y-2">
                            {selected.snapshot.smartIntelligence.evaluationV2.followups.length ? selected.snapshot.smartIntelligence.evaluationV2.followups.map((item) => (
                              <div key={item.type} className="rounded-xl bg-black/10 p-2.5 text-xs">
                                <div className="font-black text-white">{item.label} <span className="text-[10px] text-slate-500">· {item.timingLabel}</span></div>
                                <div className="mt-1 text-slate-400">{item.reason}</div>
                              </div>
                            )) : <div className="text-xs text-slate-500">لا توجد فرصة متابعة واضحة لهذه الجلسة.</div>}
                          </div>
                        </div>
                      </section>
                    </>
                  ) : selected.snapshot.officialReviewDraft ? (
                    <section className="rounded-2xl border border-violet-800/50 bg-violet-950/10 p-4">
                      <div className="text-xs font-black text-violet-200">التقييم الذكي المقترح</div>
                      <div className="mt-1 text-2xl font-black text-white">{selected.snapshot.officialReviewDraft.provisionalScore ?? '-'}<span className="text-sm text-slate-500">/100</span></div>
                    </section>
                  ) : (
                    <div className="rounded-2xl border border-slate-800 p-5 text-sm text-slate-400">لا يوجد Draft ذكي لهذه الحالة.</div>
                  )}
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/20 p-4 text-xs leading-6 text-slate-400">
                    الدرجة هنا مقترحة ومقيدة بنسبة تغطية الأدلة. البنود الرسمية والأدلة والتعديل النهائي موجودة في صفحة التقييم الرسمي، ولا توجد نقاط قبل الاعتماد والحفظ البشري.
                  </div>
                </div>
              ) : null}
            </div>

            <div className="shrink-0 border-t border-slate-700 bg-[#111c2b]/95 p-3 backdrop-blur">
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => openOfficialReview(selected)} className="inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-black text-slate-950"><FileText size={16} /> فتح Draft التقييم الرسمي</button>
                {selected.actions.followup ? <button type="button" onClick={() => openFollowup(selected)} className="rounded-xl border border-emerald-700/60 bg-emerald-950/30 px-3 py-2.5 text-xs font-black text-emerald-100">فتح متابعة</button> : null}
                {selected.actions.customerRequest ? <button type="button" onClick={() => openCustomerRequest(selected)} className="rounded-xl border border-amber-700/60 bg-amber-950/30 px-3 py-2.5 text-xs font-black text-amber-100">تسجيل طلب</button> : null}
                <span className="mr-auto hidden text-[10px] text-slate-500 md:inline">لا نقاط ولا حفظ رسمي قبل الاعتماد البشري.</span>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
