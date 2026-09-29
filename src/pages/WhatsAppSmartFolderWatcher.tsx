import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, CheckCircle2, ChevronDown, ChevronUp, FileText, FolderOpen, Image as ImageIcon, Loader2, Mic, RefreshCw, Search, Sparkles, X } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getStaffSessionToken, useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import {
  connectLocalWhatsAppFolder,
  getUnprocessedWhatsAppExports,
  findLocalWhatsAppExportFileNames,
  markLocalWhatsAppFileFailed,
  markLocalWhatsAppFileProcessed,
  queryLocalWhatsAppFolderPermission,
  restoreLocalWhatsAppFolder,
  supportsLocalWhatsAppInbox,
  resetLocalWhatsAppProcessedLedger,
  resetLocalWhatsAppProcessedKeys,
  resetLocalWhatsAppProcessedFileNames,
  getLocalWhatsAppFailedItems,
  resetLocalWhatsAppFailedLedger,
  loadLocalWhatsAppAnalysisHistory,
  saveLocalWhatsAppAnalysisHistory,
} from '@/lib/localWhatsAppInbox';
import { readWhatsAppExportFile } from '@/lib/whatsappExportFileReader';
import { parseWhatsAppExport } from '@/lib/whatsappConversationParser';
import { buildSmartConversationReviewResult } from '@/lib/whatsappSmartReviewResult';
import { runSmartReviewPipeline, type SmartReviewPipelineResult } from '@/lib/whatsappSmartReviewPipeline';
import type { SmartStaffRole } from '@/lib/whatsappSmartReviewOwnership';
import { resolveWhatsAppParticipantRolesV15 } from '@/lib/whatsappParticipantRoleResolverV15';
import { groupOutboundBursts, computeStaffBurstEffort } from '@/lib/whatsappOutboundMessageBursts';
import { buildUnifiedConversationIntelligence, verifySessionAgainstInvoices } from '@/lib/whatsappUnifiedIntelligenceV4';
import {
  buildWhatsAppOperationalIntelligenceV6,
  enrichWhatsAppOperationalProductsV6,
  syncWhatsAppOperationalActionsV6,
} from '@/lib/whatsappOperationalIntelligenceV6';
import { enrichWhatsAppOperationalJourneysV7 } from '@/lib/whatsappProductJourneyV7';
import { buildSmartIntelligenceSnapshotV1, type SmartInvoiceItemEvidenceV32 } from '@/lib/whatsappSmartIntelligenceSnapshot';
import { resolveConversationBranchHint, type BranchHintResult } from '@/lib/whatsappConversationBranchHint';
import { resolveStaffIdentity, type ResolvedStaffIdentity } from '@/lib/whatsappStaffIdentityResolver';
import { buildSmartOfficialReviewDraftV1 } from '@/lib/whatsappSmartOfficialReviewDraft';
import { buildSmartConversationEvaluationV2 } from '@/lib/whatsappConversationEvaluationV2';
import { customerContextFromCanonicalIdentity } from '@/lib/whatsappCustomerContextResolver';
import { followupCustomerAnchor } from '@/lib/whatsappFollowupIdentity';
import {
  extractCustomerIdentityEvidence,
  resolveCanonicalCustomerIdentities,
} from '@/lib/customers/canonicalCustomerIdentityResolver';
import { buildConversationTimingV28 } from '@/lib/whatsappConversationTimingV28';
import { buildDelayAttributionV29 } from '@/lib/whatsappDelayAttributionV29';
import { buildConversationFocusV30 } from '@/lib/whatsappConversationFocusV30';
import { buildEvaluationConversationV31 } from '@/lib/whatsappEvaluationConversationV31';
import { buildGroundedSaleJourneyV33 } from '@/lib/whatsappGroundedSaleJourneyV33';
import { buildConversationUnderstandingV32 } from '@/lib/whatsappConversationUnderstandingV32';
import { syncWhatsAppResponseTurnsV18 } from '@/lib/whatsappResponseTurnsV18';
import { syncWhatsAppEvidenceLedgerV17 } from '@/lib/whatsappEvidenceLedgerV17';
import { syncWhatsAppOrderLifecycleV19 } from '@/lib/whatsappOrderLifecycleV19';
import { persistAnalyzedWhatsAppSession, attachInvoiceVerificationToQueue, confirmWhatsAppInvoiceLinkV34, archiveSupersededLegacyWhatsAppSourceV35 } from '@/lib/whatsappReviewPersistenceV4';
import type { JourneySessionSourceV15 } from '@/lib/whatsappCustomerJourneyPersistenceV15';
import { syncCanonicalCaseGraphForFile, type WatcherCaseGraphSyncResult } from '@/lib/whatsappWatcherCaseGraphSync';
import { segmentWhatsAppExportCanonical } from '@/lib/whatsappCanonicalSegmentation';
import { CANONICAL_SOURCE_GATE_CODES } from '@/lib/salesIntelligence/persistence/canonicalSourceGate';
import { requestCanonicalSalesIntelligenceRefresh, type SalesIntelligenceStageStatus } from '@/lib/salesIntelligence/refresh/refreshClient';
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
  sourceId?: string | null;
  canonicalSaleProofState?: string | null;
  caseId: string;
  caseSummary: string;
  caseStartedAt: string;
  caseEndedAt: string;
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
  analyzedAtIso?: string;
  conversationStartedAt?: string | null;
  conversationEndedAt?: string | null;
  analysisMs?: number;
  inboxKey?: string;
  messages: number;
  sessions: number;
  cases: number;
  staffRuns: StaffRun[];
  errors: string[];
  sourceIds?: string[];
  pipeline?: WatcherPipelineStatus;
};


type WatcherPipelineStatus = {
  sources: { saved: number; failed: number; errors: string[] };
  caseGraph: WatcherCaseGraphSyncResult;
  salesIntelligence?: Record<string, SalesIntelligenceStageStatus>;
};

// Refresh-source rejects non-canonical input explicitly. A non-canonical (archived/superseded)
// source is a legitimate skip; a canonical source without its Customer Case V22 is a broken chain.
const SALES_INTELLIGENCE_BLOCKED_NON_CANONICAL = CANONICAL_SOURCE_GATE_CODES.nonCanonical;

const INTERVAL_MS = 60_000;

let officialConversationTemplatesPromise: Promise<{ welcome: string[]; closing: string[] }> | null = null;

async function loadOfficialConversationTemplates() {
  if (officialConversationTemplatesPromise) return officialConversationTemplatesPromise;
  officialConversationTemplatesPromise = (async () => {
    const [welcomeResult, quickReplyResult] = await Promise.all([
      supabase
        .from('customer_welcome_message_templates')
        .select('message_body,body,active,is_active')
        .or('active.eq.true,is_active.eq.true')
        .limit(100),
      supabase
        .from('quick_reply_scripts')
        .select('message_body,script_type,title,category,shortcut,active')
        .eq('active', true)
        .limit(250),
    ]);

    const welcome = [
      ...(welcomeResult.data || []).map((row: any) => String(row.message_body || row.body || '').trim()),
      ...(quickReplyResult.data || [])
        .filter((row: any) =>
          /welcome|ترحيب|عميل جديد|توصية/i.test(
            [row.script_type, row.title, row.category, row.shortcut].filter(Boolean).join(' ')
          )
        )
        .map((row: any) => String(row.message_body || '').trim()),
    ].filter((value): value is string => Boolean(value));

    const closing: string[] = ((quickReplyResult.data || []) as any[])
      .filter((row: any) => {
        const meta = [row.script_type, row.title, row.category, row.shortcut].filter(Boolean).join(' ');
        const full = [meta, row.message_body].filter(Boolean).join(' ');
        if (/welcome|ترحيب|عميل جديد/i.test(meta)) return false;
        return /closing|ختام|تحت أمر حضرتك|تحت امرك|نتشرف بخدمة حضرتك|سعداء بخدمة حضرتك|شكرا لثقة حضرتك|شكراً لثقة حضرتك/i.test(full);
      })
      .map((row: any) => String(row.message_body || '').trim())
      .filter((value): value is string => Boolean(value));

    return {
      welcome: Array.from(new Set<string>(welcome)),
      closing: Array.from(new Set<string>(closing)),
    };
  })().catch((error) => {
    console.warn('[whatsapp-watcher] official templates lookup failed', error);
    officialConversationTemplatesPromise = null;
    return { welcome: [], closing: [] };
  });
  return officialConversationTemplatesPromise;
}

async function readInvoiceItemsForWhatsAppSnapshot(invoiceId: string | null | undefined): Promise<SmartInvoiceItemEvidenceV32[]> {
  if (!invoiceId) return [];
  const { data, error } = await supabase
    .from('sales_invoice_items_v21')
    .select('id,product_id,product_code,product_name,quantity,unit_price,line_total,raw_data,line_no')
    .eq('invoice_id', invoiceId)
    .order('line_no', { ascending: true })
    .limit(250);

  if (error) {
    console.warn('[whatsapp-watcher] invoice items lookup failed', { invoiceId, error: error.message });
    return [];
  }

  return (data || []).map((row: any) => ({
    id: String(row.id || '').trim() || null,
    productId: String(row.product_id || '').trim() || null,
    productCode: String(row.product_code || '').trim() || null,
    productName: String(row.product_name || '').trim() || 'صنف غير مسمى',
    quantity: row.quantity == null ? null : Number(row.quantity),
    effectiveQuantity: row.raw_data?.__dawaa_commercial?.effective_quantity == null
      ? (row.quantity == null ? null : Number(row.quantity))
      : Number(row.raw_data.__dawaa_commercial.effective_quantity),
    unitPrice: row.unit_price == null ? null : Number(row.unit_price),
    lineTotal: row.line_total == null ? null : Number(row.line_total),
  }));
}

function cairoDayKey(value: string | Date | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return map.year && map.month && map.day ? `${map.year}-${map.month}-${map.day}` : null;
}

function runConversationStart(run: FileRun) {
  if (run.conversationStartedAt) return run.conversationStartedAt;
  const timestamps = run.staffRuns
    .flatMap((item) => item.snapshot.fullCaseMessages || item.snapshot.messages || [])
    .map((message) => message.timestamp)
    .filter(Boolean)
    .sort();
  return timestamps[0] || null;
}

function runConversationEnd(run: FileRun) {
  if (run.conversationEndedAt) return run.conversationEndedAt;
  const timestamps = run.staffRuns
    .flatMap((item) => item.snapshot.fullCaseMessages || item.snapshot.messages || [])
    .map((message) => message.timestamp)
    .filter(Boolean)
    .sort();
  return timestamps[timestamps.length - 1] || null;
}

function runAnalyzedAt(run: FileRun) {
  return run.analyzedAtIso || run.staffRuns[0]?.snapshot.createdAt || null;
}

function formatCairoDateTime(value: string | Date | null | undefined) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('ar-EG', {
    timeZone: 'Africa/Cairo',
    day: 'numeric',
    month: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

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
    startedAt: items[0]?.caseStartedAt || '',
    endedAt: items[0]?.caseEndedAt || '',
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
  const [searchParams] = useSearchParams();
  const requestedSourceId = String(searchParams.get('source') || '').trim();
  const { user } = useAuth();
  const actorName = String(user?.name || user?.username || user?.id || 'system');
  const handleRef = useRef<any>(null);
  const scanningRef = useRef(false);
  const [connected, setConnected] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [runs, setRuns] = useState<FileRun[]>([]);
  const [selected, setSelected] = useState<StaffRun | null>(null);
  const [conversationView, setConversationView] = useState<'whatsapp' | 'review'>('whatsapp');
  const [conversationFocusMode, setConversationFocusMode] = useState<'focused' | 'sale' | 'full'>('focused');
  const [detailTab, setDetailTab] = useState<'overview' | 'conversation' | 'review'>('overview');
  const [expandedRuns, setExpandedRuns] = useState<Record<string, boolean>>({});
  const [runQuery, setRunQuery] = useState('');
  const [dayFilter, setDayFilter] = useState<'today' | 'yesterday' | 'all' | 'custom'>('all');
  const [customDay, setCustomDay] = useState('');
  const [failedInboxCount, setFailedInboxCount] = useState(0);
  const [reanalyzingNames, setReanalyzingNames] = useState<Set<string>>(new Set());
  const [confirmingInvoiceSourceId, setConfirmingInvoiceSourceId] = useState<string | null>(null);


  const analyzeFile = useCallback(async (file: File): Promise<FileRun> => {
    const analysisStartedAt = performance.now();
    const officialTemplates = await loadOfficialConversationTemplates();
    const analyzedAtIso = new Date().toISOString();
    const read = await readWhatsAppExportFile(file);
    const messages = parseWhatsAppExport(read.text);
    if (!messages.length) throw new Error('لم يتم التعرف على رسائل WhatsApp داخل الملف');
    const segmentation = segmentWhatsAppExportCanonical(messages, file.name);
    const fileCustomerHint = segmentation.fileCustomerHint;
    // Canonical Segmentation Contract (shared with automatic ingest): raw 120-minute sessions are
    // joined into case units by Case Context V27; one persisted source per case unit.
    const caseContexts = segmentation.caseContexts;
    const analysisUnits = caseContexts.contexts;
    const staffRuns: StaffRun[] = [];
    const persistedSessionSources: JourneySessionSourceV15[] = [];
    const persistedBranchHints: string[] = [];
    const sourcePersistErrors: string[] = [];

    // Canonical Customer Identity (shared with automatic ingest and Sales Intelligence): one batch
    // resolution for every case unit of the file (bounded queries, no per-case search), then
    // read-only display context per resolved customer. A lookup failure fails the file visibly.
    const canonicalIdentities = await resolveCanonicalCustomerIdentities(
      supabase,
      analysisUnits.map((unit) => extractCustomerIdentityEvidence(unit.mergedSession, file.name))
    );
    const identityBySession = new Map(
      analysisUnits.map((unit, index) => [unit.mergedSession.id, canonicalIdentities[index]])
    );
    const customerProfileCache = new Map();
    const getCustomerContext = (session: (typeof analysisUnits)[number]['mergedSession']) =>
      customerContextFromCanonicalIdentity(identityBySession.get(session.id)!, customerProfileCache);

    const analyzeCase = async (caseContext: (typeof analysisUnits)[number]): Promise<StaffRun[]> => {
      const session = caseContext.mergedSession;
      const base = buildSmartConversationReviewResult(session);
      const conversationUnderstandingV32 = buildConversationUnderstandingV32(session);

      // V15/V6 عندهم دلوقتي directory cache قصير العمر، فالجلسات المتتالية لا تعيد تحميل
      // مئات سجلات الموظفين والـaliases من Supabase كل مرة.
      const roles = await resolveWhatsAppParticipantRolesV15(session);
      const outboundBurstMetrics = computeStaffBurstEffort(groupOutboundBursts(session, roles));
      const branchHint = await resolveConversationBranchHint(session, roles, null);
      const customerContext = await getCustomerContext(session);
      const resolvedCustomer = customerContext.resolution.customer;

      // Operational/Product Journey هو مصدر حقيقة الأصناف داخل WhatsApp Review.
      // نحافظ على fallback نصي حتى لو catalog lookup فشل مؤقتًا؛ كده اسم الصنف الخام
      // والطلب/الترشيح لا يختفوا من analysis_json أو من شاشة التقييم.
      const baseIntelligence = buildUnifiedConversationIntelligence(session);
      const baseOperational = buildWhatsAppOperationalIntelligenceV6(session, baseIntelligence);
      let operational = enrichWhatsAppOperationalJourneysV7(session, baseOperational);
      try {
        const enrichedOperational = await enrichWhatsAppOperationalProductsV6(baseOperational, session);
        operational = enrichWhatsAppOperationalJourneysV7(session, enrichedOperational);
      } catch (productEnrichmentError) {
        console.warn('[whatsapp-watcher] product catalog enrichment failed; raw operational products preserved', productEnrichmentError);
      }

      // التحقق من الفاتورة يظل per-session لأن التوقيت وسياق الجلسة جزء من المطابقة؛
      // لذلك لا نكاشه بشكل قد يخلط بيع Session بآخر.
      const invoiceVerification = await verifySessionAgainstInvoices(session, {
        customerId: resolvedCustomer?.id || null,
        customerCode: resolvedCustomer?.code || null,
        customerPhone: resolvedCustomer?.phone ||
            customerContext.contactProfile?.phone ||
            customerContext.contactProfile?.customerPhone ||
            customerContext.contactProfile?.mobile ||
            customerContext.contactProfile?.normalizedPhone ||
            customerContext.contactProfile?.whatsappPhone ||
            customerContext.contactProfile?.alternatePhone ||
            customerContext.phoneCandidate ||
            null,
        customerName: resolvedCustomer?.name || session.customerName,
        branch: resolvedCustomer?.branch || branchHint.value,
      });
      const invoiceItems = await readInvoiceItemsForWhatsAppSnapshot(
        ['verified', 'probable'].includes(invoiceVerification.status)
          ? invoiceVerification.bestCandidate?.invoiceId
          : null
      );

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
          knownOrderData: {
            customerKnown: Boolean(resolvedCustomer?.id),
            phoneKnown: Boolean(
              customerContext.contactProfile?.phone ||
              customerContext.contactProfile?.customerPhone ||
              customerContext.contactProfile?.mobile ||
              customerContext.contactProfile?.normalizedPhone ||
              customerContext.contactProfile?.whatsappPhone ||
              customerContext.contactProfile?.alternatePhone ||
              resolvedCustomer?.phone ||
              invoiceVerification.bestCandidate?.customerPhone
            ),
            addressKnown: Boolean(
              customerContext.contactProfile?.address ||
              invoiceVerification.bestCandidate?.customerAddress
            ),
            productKnown: Boolean(invoiceItems.length || operational.products.some((row) => ['requested', 'accepted', 'recommended', 'unavailable'].includes(row.status))),
            quantityKnown: Boolean(
              invoiceItems.some((row) => row.effectiveQuantity != null || row.quantity != null) ||
              operational.products.some((row) => row.quantity != null)
            ),
          },
          officialWelcomeTemplates: officialTemplates.welcome,
          officialClosingTemplates: officialTemplates.closing,
        });

        const groundedSaleJourneyV33 = buildGroundedSaleJourneyV33({
          session,
          operational,
          invoiceVerification,
          evaluation: evaluationV2,
          timing: caseTimingV28,
          participantRoles: roles,
          understanding: conversationUnderstandingV32,
          customerResolved: Boolean(resolvedCustomer?.id),
          customerAmbiguous: ['ambiguous', 'contradicted'].includes(customerContext.resolution.strategy),
          invoiceItemCount: invoiceItems.length,
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

        const smartIntelligence = buildSmartIntelligenceSnapshotV1({
          journey: result.journeyCrossCheck,
          staffEffort: outboundBurstMetrics,
          invoiceVerification,
          invoiceItems,
          requestedProducts: operational.products,
          branchHint,
          customer: customerContext.resolution,
          customerContact: customerContext.contactProfile,
          purchaseHistory: customerContext.purchaseHistory,
          evaluationV2,
          timingV28: caseTimingV28,
          staffTimingV28: focusedStaffTimingV28,
          delayAttributionV29,
          groundedSaleJourneyV33,
        });

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
          smartIntelligence,
        });

        const actions = buildSmartReviewActionPlan({
          intelligence: result.intelligence,
          smartIntelligence,
          staffName: staff.staffName,
          fallbackCustomerName: session.customerName || null,
        });

        return {
          sessionId: session.id,
          caseId: caseContext.caseItem.id,
          caseSummary: caseContext.caseItem.summary,
          caseStartedAt: caseContext.caseItem.startedAt,
          caseEndedAt: caseContext.caseItem.lastEventAt,
          caseSessionCount: caseContext.caseItem.sessionIds.length,
          caseStaffNames: caseContext.caseItem.staffNames,
          customerName: session.customerName || null,
          staffName: staff.staffName,
          role: staff.role,
          decision: result.decision.decision,
          safe: result.decision.safeToQuickApprove && groundedSaleJourneyV33.truthQuality.decisionReady,
          reasons: Array.from(new Set([
            ...result.decision.reasons,
            ...groundedSaleJourneyV33.truthQuality.blockers,
          ])),
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
        const persistedGroundedJourney = keptRuns[0]?.snapshot.smartIntelligence?.groundedSaleJourneyV33 || null;
        const groundedBlocksApproval = Boolean(
          persistedGroundedJourney && !persistedGroundedJourney.truthQuality.decisionReady
        );
        const canonicalFollowup = keptRuns.map((run) => run.actions.followup).find(Boolean) || null;
        const persistenceIntelligence = {
          ...baseIntelligence,
          requiresHumanApproval: baseIntelligence.requiresHumanApproval || groundedBlocksApproval,
          priority: groundedBlocksApproval && baseIntelligence.priority === 'normal' ? 'important' : baseIntelligence.priority,
          followupRequired: Boolean(canonicalFollowup),
          suggestedFollowupReason: canonicalFollowup?.reason || null,
          operational,
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
          groundedSaleJourneyV33: persistedGroundedJourney,
          smartIntelligence: keptRuns[0]?.snapshot.smartIntelligence || null,
          evaluationV2: keptRuns[0]?.snapshot.smartIntelligence?.evaluationV2 || null,
          invoiceItems: keptRuns[0]?.snapshot.smartIntelligence?.invoiceItems || [],
          requestedProducts: keptRuns[0]?.snapshot.smartIntelligence?.requestedProducts || [],
          resolvedCustomer: customerContext.resolution,
          resolvedCustomerContact: customerContext.contactProfile,
          canonicalCustomerIdentity: customerContext.identity,
        } as any;
        const persisted = await persistAnalyzedWhatsAppSession(session, persistenceIntelligence, {
          sourceFileName: file.name,
          branch: resolvedCustomer?.branch || branchHint.value || null,
          customerId: resolvedCustomer?.id || null,
          customerCode: resolvedCustomer?.code || fileCustomerHint.codeHint || null,
          customerName: resolvedCustomer?.name || fileCustomerHint.nameHint || session.customerName || null,
          customerPhone: resolvedCustomer?.phone ||
            customerContext.contactProfile?.phone ||
            customerContext.contactProfile?.customerPhone ||
            customerContext.contactProfile?.mobile ||
            customerContext.contactProfile?.normalizedPhone ||
            customerContext.contactProfile?.whatsappPhone ||
            customerContext.contactProfile?.alternatePhone ||
            customerContext.phoneCandidate ||
            null,
          staffId: singleResolvedStaff?.staffId || null,
          staffName: singleResolvedStaff?.canonicalStaffName || null,
          createdBy: actorName,
        });
        for (const run of keptRuns) run.sourceId = persisted.id;
        await attachInvoiceVerificationToQueue(persisted.id, invoiceVerification, String(user?.id || '') || null, actorName);
        try {
          await syncWhatsAppOperationalActionsV6(operational, {
            sourceId: persisted.id,
            branch: resolvedCustomer?.branch || branchHint.value || null,
            customerId: resolvedCustomer?.id || null,
            customerCode: resolvedCustomer?.code || fileCustomerHint.codeHint || null,
            customerName: resolvedCustomer?.name || fileCustomerHint.nameHint || session.customerName || null,
            customerPhone: resolvedCustomer?.phone ||
            customerContext.contactProfile?.phone ||
            customerContext.contactProfile?.customerPhone ||
            customerContext.contactProfile?.mobile ||
            customerContext.contactProfile?.normalizedPhone ||
            customerContext.contactProfile?.whatsappPhone ||
            customerContext.contactProfile?.alternatePhone ||
            customerContext.phoneCandidate ||
            null,
            staffId: singleResolvedStaff?.staffId || null,
            staffName: singleResolvedStaff?.canonicalStaffName || null,
            createdBy: actorName,
            followupIdentity: { customerAnchor: followupCustomerAnchor(customerContext.identity, file.name), session },
          });
        } catch (operationalActionError) {
          console.warn('[whatsapp-watcher] operational action sync failed; source/product analysis preserved', operationalActionError);
        }
        try {
          await syncWhatsAppEvidenceLedgerV17(session, {
            sourceId: persisted.id,
            contextOnly: false,
            operational,
            analysisVersion: baseIntelligence.version,
            participantRoles: roles,
            groundedSaleJourney: persistedGroundedJourney,
          });
        } catch (evidencePersistError) {
          console.warn('[whatsapp-watcher] evidence ledger sync failed; source preserved', evidencePersistError);
        }
        try {
          await syncWhatsAppResponseTurnsV18(session, {
            sourceId: persisted.id,
            participantRoles: roles,
            contextOnly: false,
          });
        } catch (timingPersistError) {
          console.warn('[whatsapp-watcher] response timing sync failed; source preserved', timingPersistError);
        }
        try {
          await syncWhatsAppOrderLifecycleV19(session, {
            sourceId: persisted.id,
            participantRoles: roles,
            contextOnly: false,
            groundedSaleJourney: persistedGroundedJourney,
          });
        } catch (lifecyclePersistError) {
          console.warn('[whatsapp-watcher] order lifecycle sync failed; source preserved', lifecyclePersistError);
        }
        persistedSessionSources.push({
          sessionId: session.id,
          sourceId: persisted.id,
          contextOnly: false,
        });
        if (resolvedCustomer?.branch || branchHint.value) persistedBranchHints.push(String(resolvedCustomer?.branch || branchHint.value));
      } catch (persistError) {
        console.warn('[whatsapp-watcher] persistent case source sync failed; local analysis preserved', persistError);
        sourcePersistErrors.push(
          `${caseContext.caseItem.id}: ${persistError instanceof Error ? persistError.message : String((persistError as any)?.message ?? persistError)}`
        );
      }

      return keptRuns;
    };

    // التحليل يتم على مستوى الـCase لا الـraw session. كده الـhandoff بين دكتورين
    // لا يخلق قصتين منفصلتين لنفس الأوردر، ومع ذلك كل دكتور يأخذ Scope رسائله فقط.
    const CASE_CONCURRENCY = 4;
    for (let index = 0; index < analysisUnits.length; index += CASE_CONCURRENCY) {
      const batch = analysisUnits.slice(index, index + CASE_CONCURRENCY);
      const batchRuns = await Promise.all(batch.map(analyzeCase));
      staffRuns.push(...batchRuns.flat());

      if (typeof window !== 'undefined' && index + CASE_CONCURRENCY < analysisUnits.length) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      }
    }

    // Journey V15 and Customer Case V22 are separate stages: a journey failure never blocks the
    // canonical Customer Case write, and a case failure is returned in the file result.
    const branch = persistedBranchHints.find(Boolean) || null;
    const caseGraph = await syncCanonicalCaseGraphForFile({
      sourceFileName: file.name,
      caseContexts,
      sessionSources: persistedSessionSources,
      branch,
      createdBy: actorName,
    });

    const replacementSourceIds = Array.from(new Set(
      persistedSessionSources.map((row) => row.sourceId).filter(Boolean)
    ));
    if (
      caseContexts.caseEngine.caseCount > 1 &&
      caseGraph.customerCase.status === 'saved' &&
      caseGraph.customerCase.saved === caseContexts.caseEngine.caseCount &&
      replacementSourceIds.length >= 2
    ) {
      try {
        const archiveResult = await archiveSupersededLegacyWhatsAppSourceV35({
          sourceFileName: file.name,
          fullConversationStartedAt: messages[0]?.timestamp?.toISOString?.() || '',
          fullConversationEndedAt: messages[messages.length - 1]?.timestamp?.toISOString?.() || '',
          fullMessageCount: messages.length,
          replacementSourceIds,
          actorId: String(user?.id || '') || null,
          actorName,
        });
        if (archiveResult.archived) {
          console.info('[whatsapp-watcher] archived superseded monolithic source', archiveResult);
        } else if (archiveResult.skippedReason && archiveResult.skippedReason !== 'no_legacy_monolithic_source') {
          console.warn('[whatsapp-watcher] legacy source cleanup skipped safely', archiveResult);
        }
      } catch (archiveError) {
        console.warn('[whatsapp-watcher] legacy source cleanup failed; new case sources preserved', archiveError);
      }
    }

    const pipelineErrors = [
      ...sourcePersistErrors.map((error) => `Source not saved — ${error}`),
      ...(caseGraph.journey.status === 'failed' ? [`Journey sync failed — ${caseGraph.journey.error}`] : []),
      ...(caseGraph.customerCase.status === 'saved' || caseGraph.customerCase.status === 'skipped'
        ? []
        : [`Customer Case V22 ${caseGraph.customerCase.status} (${caseGraph.customerCase.saved}/${caseGraph.customerCase.expected}) — ${caseGraph.customerCase.errors.join(' | ')}`]),
    ];

        return {
      fileName: file.name,
      at: new Date().toLocaleString('ar-EG'),
      analyzedAtIso,
      conversationStartedAt: messages[0]?.timestamp?.toISOString?.() || null,
      conversationEndedAt: messages[messages.length - 1]?.timestamp?.toISOString?.() || null,
      analysisMs: Math.round(performance.now() - analysisStartedAt),
      messages: messages.length,
      sessions: segmentation.rawSessionCount,
      cases: caseContexts.caseEngine.caseCount,
      staffRuns,
      errors: pipelineErrors,
      sourceIds: Array.from(new Set(persistedSessionSources.map((row) => row.sourceId).filter(Boolean))),
      pipeline: {
        sources: { saved: persistedSessionSources.length, failed: sourcePersistErrors.length, errors: sourcePersistErrors },
        caseGraph,
      },
    };
  }, [actorName, user?.id]);

  const scanOnce = useCallback(async (targetFileNames?: string[]) => {
    if (!handleRef.current || scanningRef.current) return;
    scanningRef.current = true;
    setScanning(true);
    try {
      const candidates = await getUnprocessedWhatsAppExports(
        handleRef.current,
        targetFileNames?.length ? Math.min(25, targetFileNames.length) : 10,
        targetFileNames
      );
      if (!candidates.length) {
        toast.message('لا توجد ملفات جديدة في الفولدر');
        return;
      }

      let authSessionInvalid = false;
      let authSessionWarningShown = false;

      const processCandidate = async (candidate: (typeof candidates)[number]): Promise<FileRun> => {
        try {
          const result = await analyzeFile(candidate.file);

          const canonicalErrors: string[] = [];
          const canonicalProofBySource = new Map<string, string>();
          const salesIntelligenceBySource: Record<string, SalesIntelligenceStageStatus> = {};
          try {
            const accessToken = getStaffSessionToken() || '';
            if (!accessToken) {
              canonicalErrors.push('جلسة الإدارة الحالية قديمة — سجل خروج ودخول مرة واحدة لتحديث Sales Intelligence');
            } else {
              try {
                const exactSourceIds = Array.from(new Set((result.sourceIds || []).filter(Boolean)));
                if (exactSourceIds.length) {
                  const refresh = await requestCanonicalSalesIntelligenceRefresh({ sourceIds: exactSourceIds, accessToken });
                  Object.assign(salesIntelligenceBySource, refresh.bySource);
                  for (const [sourceId, stage] of Object.entries(refresh.bySource)) {
                    if (stage.status === 'allowed' && stage.saleProofState) canonicalProofBySource.set(sourceId, stage.saleProofState);
                  }
                  for (const failure of refresh.errors) {
                    canonicalErrors.push(`Canonical ${result.fileName} [source ${failure.sourceId}]: ${failure.message}`);
                  }
                  if (refresh.authInvalid) {
                    authSessionInvalid = true;
                    canonicalErrors.push('انتهت جلسة الإدارة — أعد تسجيل الدخول ثم اضغط إعادة محاولة المتعطلة');
                    if (!authSessionWarningShown) {
                      authSessionWarningShown = true;
                      toast.error('انتهت جلسة الإدارة. تم إيقاف فحص باقي الملفات حتى تسجل الدخول من جديد.');
                    }
                  }
                } else {
                  // Fail closed: filename is provenance/display metadata only, never Canonical Source identity.
                  // If persistence did not return exact source ids, do not ask the server to rediscover rows by
                  // filename because another import/segmentation may share that name.
                  canonicalErrors.push(
                    `Canonical ${result.fileName}: canonical_source_ids_missing_after_persistence`
                  );
                }
              } catch (refreshError) {
                canonicalErrors.push(
                  `Canonical ${result.fileName}: ${refreshError instanceof Error ? refreshError.message : 'تعذر التحديث'}`
                );
              }
            }
          } catch (refreshSetupError) {
            canonicalErrors.push(
              refreshSetupError instanceof Error ? refreshSetupError.message : 'تعذر تحديث Sales Intelligence'
            );
          }

          const resultWithCanonicalProof: FileRun = {
            ...result,
            pipeline: result.pipeline ? { ...result.pipeline, salesIntelligence: salesIntelligenceBySource } : result.pipeline,
            staffRuns: result.staffRuns.map((staffRun) => {
              const state = staffRun.sourceId ? canonicalProofBySource.get(staffRun.sourceId) : null;
              return state ? { ...staffRun, canonicalSaleProofState: state } : staffRun;
            }),
          };
          const finalizedResult: FileRun = canonicalErrors.length
            ? { ...resultWithCanonicalProof, inboxKey: candidate.key, errors: [...result.errors, ...canonicalErrors] }
            : { ...resultWithCanonicalProof, inboxKey: candidate.key };

          setRuns((current) => {
            const refreshedNames = new Set([finalizedResult.fileName]);
            return [finalizedResult, ...current.filter((run) => !refreshedNames.has(run.fileName))].slice(0, 30);
          });
          setReanalyzingNames((current) => {
            if (!current.has(candidate.name)) return current;
            const next = new Set(current);
            next.delete(candidate.name);
            return next;
          });

          await saveLocalWhatsAppAnalysisHistory<FileRun>(candidate.key, candidate.name, finalizedResult);
          if (finalizedResult.errors.length) {
            const reason = finalizedResult.errors.join(' | ').slice(0, 500);
            markLocalWhatsAppFileFailed(candidate.key, reason);
            console.warn('[whatsapp-watcher] canonical chain incomplete after local analysis', finalizedResult.errors);
            toast.warning(`تم تحليل ${candidate.name} محليًا لكن سلسلة الحفظ الرسمية غير مكتملة، وسيُعاد تلقائيًا`);
          } else {
            markLocalWhatsAppFileProcessed(candidate.key);
            toast.success(`تم تحليل ${candidate.name}: ${result.sessions} جلسة → ${result.cases} حالة / ${result.staffRuns.length} مسؤول`);
          }
          return finalizedResult;
        } catch (error) {
          const reason = error instanceof Error ? error.message : 'خطأ غير معروف';
          markLocalWhatsAppFileFailed(candidate.key, reason);
          const failedRun: FileRun = {
            fileName: candidate.name,
            at: new Date().toLocaleString('ar-EG'),
            analyzedAtIso: new Date().toISOString(),
            inboxKey: candidate.key,
            messages: 0,
            sessions: 0,
            cases: 0,
            staffRuns: [],
            errors: [reason],
          };
          setRuns((current) => [
            failedRun,
            ...current.filter((run) => run.fileName !== failedRun.fileName),
          ].slice(0, 30));
          setReanalyzingNames((current) => {
            if (!current.has(candidate.name)) return current;
            const next = new Set(current);
            next.delete(candidate.name);
            return next;
          });
          return failedRun;
        }
      };

      // ملفان فقط بالتوازي: يختصر زمن التحليل بدون ضغط زائد على قاعدة البيانات.
      // كل ملف يحدث الواجهة فور انتهائه داخل processCandidate بدل انتظار باقي الدفعة.
      const FILE_CONCURRENCY = 2;
      for (let index = 0; index < candidates.length; index += FILE_CONCURRENCY) {
        const batch = candidates.slice(index, index + FILE_CONCURRENCY);
        await Promise.all(batch.map(processCandidate));
        if (authSessionInvalid) break;
        if (typeof window !== 'undefined' && index + FILE_CONCURRENCY < candidates.length) {
          await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
        }
      }
    } finally {
      scanningRef.current = false;
      setScanning(false);
      setFailedInboxCount(getLocalWhatsAppFailedItems().length);
    }
  }, [analyzeFile]);

  useEffect(() => {
    void (async () => {
      setFailedInboxCount(getLocalWhatsAppFailedItems().length);
      try {
        const history = await loadLocalWhatsAppAnalysisHistory<FileRun>(30);
        if (history.length) {
          const restoredRuns = history.map((row) => row.payload);
          setRuns(restoredRuns);
          if (requestedSourceId) {
            const requested = restoredRuns
              .flatMap((run) => run.staffRuns || [])
              .find((staffRun) => String(staffRun.sourceId || '').trim() === requestedSourceId);
            if (requested) openDetails(requested);
          }
        }
      } catch (error) {
        console.warn('[whatsapp-watcher] failed to restore local analysis history', error);
      }

      const handle = await restoreLocalWhatsAppFolder();
      if (!handle) return;
      if (await queryLocalWhatsAppFolderPermission(handle, false) !== 'granted') return;
      handleRef.current = handle;
      setConnected(true);
    })();
  }, [requestedSourceId]);

  useEffect(() => {
    if (!connected) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) void scanOnce();
    }, INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [connected, scanOnce]);

  async function reanalyzeExisting() {
    resetLocalWhatsAppProcessedLedger();
    setFailedInboxCount(0);
    setRuns([]);
    toast.success('تمت إعادة تهيئة سجل الملفات — هنعيد تحليل الملفات الموجودة في الفولدر');
    await scanOnce();
  }

  async function retryFailedOnly() {
    if (scanning) return;
    const failed = getLocalWhatsAppFailedItems();
    if (!failed.length) {
      toast.message('لا توجد ملفات متعطلة لإعادة المحاولة');
      return;
    }
    resetLocalWhatsAppFailedLedger();
    setFailedInboxCount(0);
    toast.message(`إعادة محاولة ${failed.length} ملف متعطل`);
    await scanOnce();
  }

  async function reanalyzeVisibleRuns() {
    if (scanning) return;
    let names = Array.from(new Set(filteredRuns.map((run) => run.fileName).filter(Boolean)));

    if (!names.length && runQuery.trim() && handleRef.current) {
      names = await findLocalWhatsAppExportFileNames(handleRef.current, runQuery.trim(), 20);
    }

    if (!names.length) {
      toast.message(runQuery.trim()
        ? 'لم أجد ملفًا مطابقًا للاسم داخل فولدر واتساب'
        : 'لا توجد ملفات ظاهرة لإعادة تحليلها');
      return;
    }

    resetLocalWhatsAppProcessedFileNames(names);
    setReanalyzingNames(new Set(names));
    toast.message(`إعادة تحليل ${names.length} ملف مطابق فقط`);
    await scanOnce(names);
    setReanalyzingNames(new Set());
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
    writePendingConversationReviewTransfer({
      ...item.snapshot,
      canonicalSaleProofState: item.canonicalSaleProofState || null,
    });
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

  const filteredRuns = useMemo(() => {
    const query = runQuery.trim().toLowerCase();
    const todayKey = cairoDayKey(new Date());
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayKey = cairoDayKey(yesterday);
    const targetDay =
      dayFilter === 'today' ? todayKey :
      dayFilter === 'yesterday' ? yesterdayKey :
      dayFilter === 'custom' ? customDay || null :
      null;

    return runs.filter((run) => {
      const conversationDay = cairoDayKey(runConversationStart(run));
      if (targetDay && conversationDay !== targetDay) return false;
      if (!query) return true;
      return (
        run.fileName.toLowerCase().includes(query) ||
        run.staffRuns.some((item) =>
          item.staffName.toLowerCase().includes(query) ||
          String(item.customerName || '').toLowerCase().includes(query)
        )
      );
    });
  }, [runs, runQuery, dayFilter, customDay]);

  const overview = useMemo(() => {
    const allStaff = filteredRuns.flatMap((run) => run.staffRuns);
    const clear = allStaff.filter((item) => item.decision === 'clear').length;
    const issues = allStaff.filter((item) => item.decision === 'issue').length;
    const review = allStaff.length - clear - issues;
    const followups = allStaff.filter((item) =>
      Boolean(item.actions.followup || item.snapshot.smartIntelligence?.evaluationV2?.followups?.length)
    ).length;
    const opportunities = allStaff.reduce((sum, item) => {
      const canonical = item.snapshot.smartIntelligence?.evaluationV2?.opportunities?.detected;
      return sum + (typeof canonical === 'number' ? canonical : (item.intelligence?.salesOpportunities.length || 0));
    }, 0);
    return {
      files: filteredRuns.length,
      staff: allStaff.length,
      clear,
      issues,
      review,
      actionNeeded: issues + review,
      followups,
      opportunities,
      failed: failedInboxCount,
    };
  }, [filteredRuns, failedInboxCount]);

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

  async function confirmSelectedInvoiceLink() {
    const item = selected;
    const sourceId = String(item?.sourceId || '').trim();
    const invoiceId = String(item?.snapshot.smartIntelligence?.invoiceVerification?.bestCandidate?.invoiceId || '').trim();
    if (!item || !sourceId || !invoiceId) {
      toast.error('لا يوجد Source/Invoice محدد يمكن اعتماده لهذه الحالة.');
      return;
    }
    setConfirmingInvoiceSourceId(sourceId);
    try {
      const confirmed = await confirmWhatsAppInvoiceLinkV34(
        sourceId,
        invoiceId,
        String(user?.id || '') || null,
        actorName,
      );

      const accessToken = getStaffSessionToken() || '';
      if (!accessToken) throw new Error('admin_session_required_for_canonical_refresh');
      const refresh = await requestCanonicalSalesIntelligenceRefresh({ sourceIds: [sourceId], accessToken });
      const stage = refresh.bySource[sourceId];
      if (!stage || stage.status !== 'allowed') {
        throw new Error(String(refresh.errors[0]?.message || stage?.reason || 'canonical_refresh_failed'));
      }
      const canonicalSaleProofState = stage.saleProofState || 'not_proven';
      const proven = canonicalSaleProofState === 'proven';
      const nextRuns = runs.map((run) => ({
        ...run,
        staffRuns: run.staffRuns.map((staffRun) =>
          staffRun.sourceId === sourceId
            ? { ...staffRun, canonicalSaleProofState }
            : staffRun
        ),
      }));
      setRuns(nextRuns);
      setSelected((current) => current && current.sourceId === sourceId
        ? { ...current, canonicalSaleProofState }
        : current);

      const changedRun = nextRuns.find((run) => run.staffRuns.some((staffRun) => staffRun.sourceId === sourceId));
      if (changedRun?.inboxKey) {
        try {
          await saveLocalWhatsAppAnalysisHistory<FileRun>(
            changedRun.inboxKey,
            changedRun.fileName,
            changedRun
          );
        } catch (historyError) {
          console.warn('[whatsapp-watcher] canonical proof state history save failed', historyError);
        }
      }

      if (proven) {
        toast.success(`تم اعتماد ربط الفاتورة ${confirmed.invoiceNumber || ''} وأصبحت Sale Proof Canonical.`);
      } else {
        toast.warning('تم حفظ اعتماد ربط الفاتورة، لكن الـCanonical لم يعتبر البيع Proven بسبب تعارض/نقص آخر يحتاج مراجعة.');
      }
    } catch (error) {
      console.error('[whatsapp-watcher] invoice link confirmation failed', error);
      const message = error instanceof Error ? error.message : String(error);
      toast.error(
        message === 'invoice_customer_identity_conflict' || message === 'invoice_customer_code_conflict'
          ? 'تم منع الاعتماد: الفاتورة مرتبطة بعميل مختلف عن العميل في المحادثة.'
          : `تعذر اعتماد ربط الفاتورة: ${message}`
      );
    } finally {
      setConfirmingInvoiceSourceId(null);
    }
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
    const smart = item.snapshot.smartIntelligence;
    const evaluation = smart?.evaluationV2;
    const grounded = smart?.groundedSaleJourneyV33;
    if (evaluation?.serviceRecovery.detected) {
      return evaluation.serviceRecovery.issueType === 'order_delay'
        ? 'اعتذار/متابعة تأخير أوردر'
        : 'استعادة خدمة';
    }
    if (grounded?.complaintMessageIds?.length) return 'شكوى/استعادة خدمة';
    if (evaluation?.followups?.length && grounded?.outcome === 'open_opportunity') return 'فرصة متابعة مفتوحة';
    if (grounded?.commercial) return grounded.outcomeLabel || 'رحلة بيع';
    return intentLabel(item.intelligence?.primaryIntent);
  }

  function consultationLabel(value?: string | null) {
    if (!value || value === 'not_applicable') return 'غير منطبق';
    if (value === 'clear') return 'واضحة';
    if (value === 'partial') return 'جزئية';
    if (value === 'needs_review') return 'تحتاج مراجعة';
    return value;
  }

  function saleTruth(item: StaffRun) {
    const smart = item.snapshot.smartIntelligence;
    const invoice = smart?.invoiceVerification;
    const evaluation = smart?.evaluationV2;
    if (item.canonicalSaleProofState === 'proven') {
      return {
        label: 'بيع مثبت Canonical',
        detail: invoice?.bestCandidate?.invoiceNumber
          ? `فاتورة #${invoice.bestCandidate.invoiceNumber}${invoice.revenue != null ? ` · ${invoice.revenue} ج` : ''} · تم اعتماد الربط وإثبات البيع رسميًا`
          : 'تم اعتماد ربط الفاتورة ووصل Canonical Sale Proof إلى proven.',
        tone: 'emerald',
      };
    }
    if (invoice?.status === 'verified') {
      return {
        label: 'مطابقة فاتورة قوية — تحتاج اعتماد الربط',
        detail: invoice.bestCandidate?.invoiceNumber
          ? `فاتورة مرشحة ${invoice.bestCandidate.invoiceNumber}${invoice.revenue != null ? ` · ${invoice.revenue} ج` : ''}`
          : (invoice.reason || 'المطابقة قوية إحصائيًا لكنها ليست Sale Proof قبل اعتماد الربط.'),
        tone: 'amber',
      };
    }
    if (invoice?.status === 'probable') {
      return {
        label: 'بيع مرجح — الفاتورة تحتاج مراجعة',
        detail: invoice.bestCandidate?.invoiceNumber
          ? `فاتورة مرشحة ${invoice.bestCandidate.invoiceNumber}${invoice.revenue != null ? ` · ${invoice.revenue} ج` : ''}`
          : invoice.reason,
        tone: 'amber',
      };
    }
    if (evaluation?.sale?.outcome === 'order_confirmed') {
      return { label: 'الطلب مؤكد في المحادثة', detail: evaluation.sale.reason, tone: 'cyan' };
    }
    if (evaluation?.sale?.outcome === 'customer_accepted') {
      return { label: 'العميل وافق — التنفيذ غير مثبت', detail: evaluation.sale.reason, tone: 'amber' };
    }
    if (evaluation?.sale?.outcome === 'invoice_verified_sale') {
      return { label: 'مطابقة فاتورة من التحليل القديم — تحتاج اعتماد الربط', detail: evaluation.sale.reason, tone: 'amber' };
    }
    return {
      label: evaluation?.sale?.label || 'البيع غير محسوم',
      detail: evaluation?.sale?.reason || invoice?.reason || 'لا يوجد دليل كافٍ لحسم نتيجة البيع.',
      tone: 'slate',
    };
  }

  function protocolStatus(item: StaffRun) {
    const evaluation = item.snapshot.smartIntelligence?.evaluationV2;
    const opening = evaluation?.opening;
    const closing = evaluation?.closing;
    const order = evaluation?.orderCompleteness;
    const explicitConfirmation = order?.items.find((row) => row.key === 'explicit_confirmation');
    const openingOfficial = /قالب ترحيب رسمي معتمد/.test(opening?.evidence.reason || '');
    const closingOfficial = /قالب ختامي رسمي معتمد/.test(closing?.evidence.reason || '');
    return {
      opening: openingOfficial ? 'رسمي معتمد' : opening?.score != null && opening.score >= 80 ? 'موجود' : opening?.score != null ? 'جزئي' : 'غير محسوم',
      openingOfficial,
      orderConfirmation: explicitConfirmation?.status === 'confirmed'
        ? 'مؤكد مع العميل'
        : explicitConfirmation?.status === 'missing'
          ? 'غير ظاهر'
          : 'غير منطبق/غير محسوم',
      orderConfirmationConfirmed: explicitConfirmation?.status === 'confirmed',
      closing: closingOfficial ? 'رسمي معتمد' : closing?.score != null && closing.score >= 80 ? 'موجود' : closing?.score != null ? 'جزئي' : 'غير محسوم',
      closingOfficial,
    };
  }

  function normalizeProductForCompare(value: string | null | undefined) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[أإآ]/g, 'ا')
      .replace(/ى/g, 'ي')
      .replace(/ة/g, 'ه')
      .replace(/[\u064B-\u065F]/g, '')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function messagesForConversationMode(item: StaffRun, mode: 'focused' | 'sale' | 'full') {
    if (mode === 'focused') return item.snapshot.messages;
    const full = item.snapshot.fullCaseMessages?.length ? item.snapshot.fullCaseMessages : item.snapshot.messages;
    if (mode === 'sale') {
      const ids = new Set(item.snapshot.smartIntelligence?.groundedSaleJourneyV33?.saleWindow.messageIds || []);
      return ids.size ? full.filter((message) => ids.has(message.id)) : item.snapshot.messages;
    }
    return full;
  }

  function messageEvidenceLabels(item: StaffRun, messageId: string) {
    const labels = new Set<string>();
    const smart = item.snapshot.smartIntelligence;
    const grounded = smart?.groundedSaleJourneyV33;
    const evaluation = smart?.evaluationV2;

    for (const stage of grounded?.stages || []) {
      if (stage.detected && stage.evidenceMessageIds.includes(messageId)) labels.add(stage.label);
    }
    if (grounded?.complaintMessageIds.includes(messageId)) labels.add('شكوى');
    if (grounded?.delayMessageIds.includes(messageId)) labels.add('تأخير');
    if (grounded?.correctionMessageIds.includes(messageId)) labels.add('تصحيح فهم');
    if (grounded?.unresolvedMessageIds.includes(messageId)) labels.add('غير محسوم');

    if (evaluation?.sale.evidenceMessageIds.includes(messageId)) labels.add('دليل البيع');
    if (evaluation?.serviceRecovery.evidenceMessageIds.includes(messageId)) labels.add('استعادة خدمة');
    if (evaluation?.opening.evidence.messageIds.includes(messageId)) labels.add('ترحيب');
    if (evaluation?.closing.evidence.messageIds.includes(messageId)) labels.add('ختام');
    for (const followup of evaluation?.followups || []) {
      if (followup.evidenceMessageIds.includes(messageId)) labels.add('متابعة');
    }

    for (const product of smart?.requestedProducts || []) {
      if (!product.evidenceMessageIds.includes(messageId)) continue;
      if (product.status === 'requested') labels.add('طلب صنف');
      else if (product.status === 'recommended') labels.add('ترشيح صنف');
      else if (product.status === 'unavailable') labels.add('عدم توفر');
      else if (product.status === 'accepted') labels.add('قبول صنف');
      else labels.add('صنف');
    }

    return [...labels].slice(0, 3);
  }

  function invoiceTruthBadge(item: StaffRun) {
    const invoice = item.snapshot.smartIntelligence?.invoiceVerification;
    const invoiceNumber = invoice?.bestCandidate?.invoiceNumber;
    if (item.canonicalSaleProofState === 'proven') {
      return {
        label: invoiceNumber ? `فاتورة مثبتة #${invoiceNumber}` : 'فاتورة مثبتة Canonical',
        cls: 'border border-emerald-800/40 bg-emerald-500/10 text-emerald-200',
      };
    }
    if (invoice?.status === 'verified') {
      return {
        label: invoiceNumber ? `مطابقة قوية #${invoiceNumber}` : 'مطابقة فاتورة قوية',
        cls: 'border border-amber-800/40 bg-amber-500/10 text-amber-200',
      };
    }
    if (invoice?.status === 'probable') {
      return {
        label: invoiceNumber ? `فاتورة مرشحة #${invoiceNumber}` : 'فاتورة مرشحة',
        cls: 'border border-amber-900/40 bg-amber-950/20 text-amber-300',
      };
    }
    return {
      label: 'لا توجد مطابقة فاتورة',
      cls: 'border border-slate-700 bg-slate-900/70 text-slate-500',
    };
  }

  function truthQualityBadge(item: StaffRun) {
    const quality = item.snapshot.smartIntelligence?.groundedSaleJourneyV33?.truthQuality;
    if (!quality) return null;
    if (quality.status === 'grounded') {
      return { label: 'حقيقة موثقة', cls: 'bg-emerald-500/10 text-emerald-200', evidenceCount: quality.directMessageEvidenceCount };
    }
    if (quality.status === 'partial') {
      return { label: 'حقيقة جزئية', cls: 'bg-amber-500/10 text-amber-200', evidenceCount: quality.directMessageEvidenceCount };
    }
    return { label: 'تحتاج مراجعة', cls: 'bg-rose-500/10 text-rose-200', evidenceCount: quality.directMessageEvidenceCount };
  }

  function nextDecisionLabel(item: StaffRun) {
    const smart = item.snapshot.smartIntelligence;
    const grounded = smart?.groundedSaleJourneyV33;
    const canonicalFollowup = smart?.evaluationV2?.followups?.[0];
    if (item.actions.followup || canonicalFollowup) {
      return {
        label: 'متابعة العميل',
        detail: item.actions.followup?.reason || canonicalFollowup?.reason || canonicalFollowup?.label || 'يوجد سبب متابعة موثق في المحادثة.',
        cls: 'bg-cyan-500/10 text-cyan-200 border-cyan-800/40'
      };
    }
    if (grounded && !grounded.truthQuality.decisionReady) {
      return {
        label: 'مراجعة الأدلة',
        detail: grounded.truthQuality.blockers[0] || grounded.warnings[0] || 'الحقيقة غير مكتملة بما يكفي للاعتماد السريع.',
        cls: 'bg-rose-500/10 text-rose-200 border-rose-800/40'
      };
    }
    if (item.decision === 'issue') {
      return { label: 'مراجعة ملاحظة', detail: item.reasons[0] || 'يوجد بند يحتاج قرارًا بشريًا قبل الاعتماد.', cls: 'bg-amber-500/10 text-amber-200 border-amber-800/40' };
    }
    if (item.decision === 'detailed_review') {
      return { label: 'مراجعة بشرية', detail: item.reasons[0] || 'الأدلة غير كافية للاعتماد السريع.', cls: 'bg-rose-500/10 text-rose-200 border-rose-800/40' };
    }
    return { label: 'جاهز للمراجعة النهائية', detail: 'الحقيقة الأساسية مكتملة؛ راجع الأدلة ثم اعتمد عند الاطمئنان.', cls: 'bg-emerald-500/10 text-emerald-200 border-emerald-800/40' };
  }

  type ProductTruthRow = {
    kind:
      | 'invoice_service'
      | 'customer_requested_in_invoice'
      | 'recommended_in_invoice'
      | 'pharmacy_mentioned_in_invoice'
      | 'invoice_only'
      | 'customer_requested_not_in_invoice';
    productName: string;
    invoiceQuantity: number | null;
    requestedQuantity: number | null;
    lineTotal: number | null;
    sourceLineCount: number;
  };

  function productTruthPresentation(kind: ProductTruthRow['kind']) {
    if (kind === 'customer_requested_in_invoice') {
      return { label: 'طلب العميل · ظهر بالفاتورة', shortLabel: 'طلب العميل', cls: 'bg-cyan-500/10 text-cyan-300', border: 'border-cyan-800/30' };
    }
    if (kind === 'customer_requested_not_in_invoice') {
      return { label: 'طلب العميل · غير ظاهر بالفاتورة', shortLabel: 'ناقص من الفاتورة', cls: 'bg-amber-500/10 text-amber-300', border: 'border-amber-800/30' };
    }
    if (kind === 'recommended_in_invoice') {
      return { label: 'ترشيح الصيدلية · ظهر بالفاتورة', shortLabel: 'ترشيح', cls: 'bg-violet-500/10 text-violet-300', border: 'border-violet-800/30' };
    }
    if (kind === 'pharmacy_mentioned_in_invoice') {
      return { label: 'ذكرته الصيدلية · ظهر بالفاتورة', shortLabel: 'ذكر الصيدلية', cls: 'bg-indigo-500/10 text-indigo-300', border: 'border-indigo-800/30' };
    }
    if (kind === 'invoice_service') {
      return { label: 'خدمة/رسوم بالفاتورة', shortLabel: 'خدمة/رسوم', cls: 'bg-slate-700/50 text-slate-300', border: 'border-slate-700' };
    }
    return { label: 'ظهر في الفاتورة فقط', shortLabel: 'فاتورة فقط', cls: 'bg-sky-500/10 text-sky-300', border: 'border-sky-800/30' };
  }

  function productTruthRows(item: StaffRun): ProductTruthRow[] {
    const smart = item.snapshot.smartIntelligence;
    const rawInvoiceItems = smart?.invoiceItems || [];
    const productSignals = smart?.requestedProducts || [];

    const isServiceLine = (row: { productName?: string | null }) =>
      /(توصيل\s*منزلي|خدمة\s*توصيل|رسوم\s*توصيل|delivery\s*(?:fee|service)?)/i.test(String(row.productName || ''));

    const groupedInvoiceItems = (() => {
      const grouped = new Map<string, {
        productId: string | null;
        productCode: string | null;
        productName: string;
        quantity: number | null;
        effectiveQuantity: number | null;
        lineTotal: number | null;
        serviceLine: boolean;
        sourceLineCount: number;
      }>();

      for (const row of rawInvoiceItems) {
        const key = row.productId
          ? `id:${row.productId}`
          : row.productCode
            ? `code:${normalizeProductForCompare(row.productCode)}`
            : `name:${normalizeProductForCompare(row.productName)}`;
        const previous = grouped.get(key);
        const quantityValue = row.quantity == null ? null : Number(row.quantity);
        const effectiveValue = row.effectiveQuantity == null ? quantityValue : Number(row.effectiveQuantity);
        const lineTotalValue = row.lineTotal == null ? null : Number(row.lineTotal);
        if (!previous) {
          grouped.set(key, {
            productId: row.productId || null,
            productCode: row.productCode || null,
            productName: row.productName,
            quantity: Number.isFinite(quantityValue as number) ? quantityValue : null,
            effectiveQuantity: Number.isFinite(effectiveValue as number) ? effectiveValue : null,
            lineTotal: Number.isFinite(lineTotalValue as number) ? lineTotalValue : null,
            serviceLine: isServiceLine(row),
            sourceLineCount: 1,
          });
          continue;
        }
        previous.quantity =
          previous.quantity == null && quantityValue == null
            ? null
            : Number(previous.quantity || 0) + (Number.isFinite(quantityValue as number) ? Number(quantityValue) : 0);
        previous.effectiveQuantity =
          previous.effectiveQuantity == null && effectiveValue == null
            ? null
            : Number(previous.effectiveQuantity || 0) + (Number.isFinite(effectiveValue as number) ? Number(effectiveValue) : 0);
        previous.lineTotal =
          previous.lineTotal == null && lineTotalValue == null
            ? null
            : Number(previous.lineTotal || 0) + (Number.isFinite(lineTotalValue as number) ? Number(lineTotalValue) : 0);
        previous.sourceLineCount += 1;
      }
      return [...grouped.values()];
    })();

    const customerDemand = productSignals.filter((row) =>
      row.sourceDirection === 'inbound' &&
      row.requestProven === true &&
      ['requested', 'accepted', 'unavailable'].includes(row.status)
    );
    const recommendations = productSignals.filter((row) =>
      row.status === 'recommended' || row.mentionOrigin === 'recommendation'
    );
    const pharmacyMentions = productSignals.filter((row) =>
      row.mentionOrigin === 'pharmacy_mention' && row.status === 'mentioned'
    );

    const keysForSignal = (row: any) => [
      row.canonicalName,
      row.rawName,
      row.productCode,
    ].map(normalizeProductForCompare).filter(Boolean);

    const matchesInvoiceItem = (invoiceItem: any, signal: any) => {
      const invoiceKeys = [invoiceItem.productName, invoiceItem.productCode]
        .map(normalizeProductForCompare).filter(Boolean);
      const signalKeys = keysForSignal(signal);
      const exactIdMatch = Boolean(invoiceItem.productId && signal.productId && invoiceItem.productId === signal.productId);
      const exactCodeMatch = Boolean(
        invoiceItem.productCode &&
        signal.productCode &&
        normalizeProductForCompare(invoiceItem.productCode) === normalizeProductForCompare(signal.productCode)
      );
      const textMatch = invoiceKeys.some((left) => signalKeys.some((right) =>
        left === right || (left.length >= 4 && right.length >= 4 && (left.includes(right) || right.includes(left)))
      ));
      return exactIdMatch || exactCodeMatch || textMatch;
    };

    const matchedDemandIndexes = new Set<number>();
    const matchedRecommendationIndexes = new Set<number>();
    const matchedMentionIndexes = new Set<number>();

    const rows: ProductTruthRow[] = groupedInvoiceItems.map((invoiceItem): ProductTruthRow => {
      if (invoiceItem.serviceLine) {
        return {
          kind: 'invoice_service' as const,
          productName: invoiceItem.productName,
          invoiceQuantity: invoiceItem.effectiveQuantity ?? invoiceItem.quantity,
          requestedQuantity: null,
          lineTotal: invoiceItem.lineTotal,
          sourceLineCount: invoiceItem.sourceLineCount,
        };
      }

      const demandIndex = customerDemand.findIndex((signal, index) =>
        !matchedDemandIndexes.has(index) && matchesInvoiceItem(invoiceItem, signal)
      );
      if (demandIndex >= 0) {
        matchedDemandIndexes.add(demandIndex);
        return {
          kind: 'customer_requested_in_invoice' as const,
          productName: invoiceItem.productName,
          invoiceQuantity: invoiceItem.effectiveQuantity ?? invoiceItem.quantity,
          requestedQuantity: customerDemand[demandIndex].quantity,
          lineTotal: invoiceItem.lineTotal,
          sourceLineCount: invoiceItem.sourceLineCount,
        };
      }

      const recommendationIndex = recommendations.findIndex((signal, index) =>
        !matchedRecommendationIndexes.has(index) && matchesInvoiceItem(invoiceItem, signal)
      );
      if (recommendationIndex >= 0) {
        matchedRecommendationIndexes.add(recommendationIndex);
        return {
          kind: 'recommended_in_invoice' as const,
          productName: invoiceItem.productName,
          invoiceQuantity: invoiceItem.effectiveQuantity ?? invoiceItem.quantity,
          requestedQuantity: recommendations[recommendationIndex].quantity,
          lineTotal: invoiceItem.lineTotal,
          sourceLineCount: invoiceItem.sourceLineCount,
        };
      }

      const mentionIndex = pharmacyMentions.findIndex((signal, index) =>
        !matchedMentionIndexes.has(index) && matchesInvoiceItem(invoiceItem, signal)
      );
      if (mentionIndex >= 0) {
        matchedMentionIndexes.add(mentionIndex);
        return {
          kind: 'pharmacy_mentioned_in_invoice' as const,
          productName: invoiceItem.productName,
          invoiceQuantity: invoiceItem.effectiveQuantity ?? invoiceItem.quantity,
          requestedQuantity: pharmacyMentions[mentionIndex].quantity,
          lineTotal: invoiceItem.lineTotal,
          sourceLineCount: invoiceItem.sourceLineCount,
        };
      }

      return {
        kind: 'invoice_only' as const,
        productName: invoiceItem.productName,
        invoiceQuantity: invoiceItem.effectiveQuantity ?? invoiceItem.quantity,
        requestedQuantity: null,
        lineTotal: invoiceItem.lineTotal,
        sourceLineCount: invoiceItem.sourceLineCount,
      };
    });

    customerDemand.forEach((request, index) => {
      if (matchedDemandIndexes.has(index)) return;
      rows.push({
        kind: 'customer_requested_not_in_invoice' as const,
        productName: request.canonicalName || request.rawName,
        invoiceQuantity: null,
        requestedQuantity: request.quantity,
        lineTotal: null,
        sourceLineCount: 0,
      });
    });

    return rows;
  }

  return (
    <div dir="rtl" className="mx-auto max-w-7xl space-y-4 p-3 md:p-5">
      <section className="dawaa-card dawaa-card--raised overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 p-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-black text-cyan-300"><Sparkles size={14} /> SMART REVIEW</div>
            <h1 className="mt-1 text-xl font-black text-white md:text-2xl">مركز مراجعة محادثات واتساب</h1>
            <p className="mt-1 text-xs text-slate-400">ابدأ بالحالات التي تحتاج تدخلًا، وافتح كل حالة لترى البيع والفاتورة والأصناف والعميل وجودة المحادثة في ملخص واحد.</p>
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
              {failedInboxCount > 0 && (
                <button type="button" disabled={scanning} onClick={() => void retryFailedOnly()} className="rounded-xl border border-rose-700/60 bg-rose-950/20 px-3 py-2 text-xs font-black text-rose-100 disabled:opacity-50">
                  إعادة محاولة المتعطلة ({failedInboxCount})
                </button>
              )}
            </div>
          )}
        </div>

        <div className="grid gap-2 border-t border-slate-800 bg-slate-950/10 p-3 sm:grid-cols-2 lg:grid-cols-6">
          {[
            ['الملفات المحللة', overview.files, 'text-white', 'كل الملفات داخل الفلتر الحالي'],
            ['تحتاج تدخل', overview.actionNeeded, overview.actionNeeded ? 'text-rose-300' : 'text-emerald-300', 'مراجعة أو ملاحظة قبل الاعتماد'],
            ['سليمة', overview.clear, 'text-emerald-300', 'لا يظهر فيها تدخل مؤثر'],
            ['متابعات', overview.followups, 'text-cyan-300', 'حالات تحتاج تواصل لاحق'],
            ['فرص بيع', overview.opportunities, 'text-violet-300', 'فرص تجارية مرصودة'],
            ['أخطاء', overview.failed, overview.failed ? 'text-rose-300' : 'text-slate-400', 'ملفات تعطل تحليلها'],
          ].map(([label, value, tone, helper]) => (
            <div key={String(label)} className="rounded-2xl border border-slate-800 bg-[#111c2b] px-3 py-3">
              <div className="flex items-end justify-between gap-2">
                <div className="text-[10px] font-black text-slate-500">{label}</div>
                <div className={`text-xl font-black ${tone}`}>{value}</div>
              </div>
              <div className="mt-1 text-[9px] leading-4 text-slate-600">{helper}</div>
            </div>
          ))}
        </div>
        {connected ? <div className="border-t border-slate-800 px-4 py-2 text-[11px] font-bold text-emerald-300">● الفولدر متصل — فحص تلقائي كل دقيقة أثناء فتح التطبيق</div> : null}
      </section>

      <section className="dawaa-card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 p-3">
          <div>
            <div className="font-black text-white">الملفات المحللة</div>
            <div className="mt-1 text-[10px] text-slate-500">الفلتر يعتمد على تاريخ المحادثة، وليس وقت رفع الملف. المعروض {filteredRuns.length} من إجمالي {runs.length} ملف.</div>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto">
            <div className="flex flex-wrap gap-1">
              {[
                ['today','اليوم'],
                ['yesterday','أمس'],
                ['all','كل الأيام'],
              ].map(([value,label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setDayFilter(value as 'today' | 'yesterday' | 'all')}
                  className={`rounded-lg border px-2.5 py-1.5 text-[10px] font-black ${dayFilter===value ? 'border-cyan-500 bg-cyan-500/15 text-cyan-200' : 'border-slate-700 bg-slate-900 text-slate-400'}`}
                >
                  {label}
                </button>
              ))}
              <input
                type="date"
                value={customDay}
                onChange={(event) => {
                  setCustomDay(event.target.value);
                  if (event.target.value) setDayFilter('custom');
                }}
                className="rounded-lg border border-slate-700 bg-slate-950/50 px-2 py-1.5 text-[10px] text-slate-300 outline-none focus:border-cyan-600"
                title="اختيار يوم محدد"
              />
              <button
                type="button"
                disabled={scanning || (!filteredRuns.length && !runQuery.trim())}
                onClick={() => void reanalyzeVisibleRuns()}
                className="rounded-lg border border-violet-700/60 bg-violet-950/20 px-2.5 py-1.5 text-[10px] font-black text-violet-200 disabled:opacity-40"
              >
                إعادة تحليل الظاهر فقط
              </button>
            </div>
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
        </div>

        {!filteredRuns.length ? (
          <div className="p-8 text-center text-sm text-slate-400">
            {runs.length
              ? 'لا توجد نتائج مطابقة للبحث.'
              : runQuery.trim()
                ? 'السجل المحلي فارغ، لكن يمكنك الضغط على «إعادة تحليل الظاهر فقط» للبحث عن الملف داخل الفولدر وإعادة تحليله فقط.'
                : 'لسه مفيش ملفات محللة. اكتب اسم العميل أو الملف في البحث ثم استخدم «إعادة تحليل الظاهر فقط» لإعادة ملف محدد بأمان.'}
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
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <div className="truncate font-black text-white">{run.fileName}</div>
                        {reanalyzingNames.has(run.fileName) ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-black text-violet-200">
                            <Loader2 size={10} className="animate-spin" /> جاري إعادة التحليل
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                        <span className="font-bold text-slate-400">المحادثة: {formatCairoDateTime(runConversationStart(run))}</span>
                        <span>آخر تحليل: {formatCairoDateTime(runAnalyzedAt(run))}</span>
                        {cairoDayKey(runConversationStart(run))===cairoDayKey(new Date()) ? <span className="rounded-full bg-cyan-500/10 px-2 py-0.5 text-[10px] font-black text-cyan-300">محادثة اليوم</span> : <span className="rounded-full bg-slate-700/40 px-2 py-0.5 text-[10px] font-bold text-slate-400">محادثة قديمة</span>}
                        {cairoDayKey(runAnalyzedAt(run))===cairoDayKey(new Date()) ? <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-black text-emerald-300">تحليل اليوم</span> : <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-300">تحليل قديم</span>}
                        {run.analysisMs ? <span>زمن التحليل: {(run.analysisMs/1000).toFixed(1)} ث</span> : null}
                        <span>{run.messages} رسالة</span><span>{run.sessions} جلسة خام</span><span>{run.cases ?? run.sessions} حالة/رحلة</span><span>{run.staffRuns.length} مسؤول</span>
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
                                  <div className="text-xs font-black text-cyan-200">{caseGroup.customerName || `رحلة عميل ${caseIndex + 1}`}</div>
                                  <div className="mt-1 text-[10px] text-slate-500">
                                    {caseGroup.summary} · {caseGroup.sessionCount} جلسة مرتبطة · {caseGroup.items.length} مسؤول
                                  </div>
                                  {caseGroup.startedAt && caseGroup.endedAt ? (
                                    <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-cyan-300/80">
                                      <span>من {new Date(caseGroup.startedAt).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' })}</span>
                                      <span>إلى {new Date(caseGroup.endedAt).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' })}</span>
                                      <span>
                                        مدة الرحلة {timingDuration(Math.max(0, Math.round((new Date(caseGroup.endedAt).getTime() - new Date(caseGroup.startedAt).getTime()) / 1000)))}
                                      </span>
                                    </div>
                                  ) : null}
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
                                    className="group w-full rounded-2xl border border-slate-800 bg-[#111c2b]/75 px-3.5 py-3 text-right transition hover:-translate-y-0.5 hover:border-cyan-700/60 hover:bg-cyan-950/10 hover:shadow-lg hover:shadow-cyan-950/10"
                                  >
                                    <div className="flex items-start justify-between gap-3">
                                      <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                          <div className="truncate text-sm font-black text-white">{item.staffIdentity.canonicalStaffName || item.staffName}</div>
                                          <span className="rounded-full border border-slate-700 bg-slate-900/70 px-2 py-0.5 text-[9px] font-black text-slate-300">{roleLabel(item.role)}</span>
                                          <span className="rounded-full border border-cyan-900/50 bg-cyan-950/20 px-2 py-0.5 text-[9px] font-black text-cyan-200">{item.staffIdentity.branch || item.branchHint.value || 'فرع غير محدد'}</span>
                                        </div>
                                        <div className="mt-1.5 text-sm font-black text-slate-100">{saleTruth(item).label}</div>
                                        <div className="mt-0.5 text-[10px] text-slate-500">{caseLabel(item)}</div>
                                      </div>
                                      <div className="flex shrink-0 items-center gap-2">
                                        <span className={`max-w-[180px] rounded-full border px-2.5 py-1 text-[10px] font-black ${nextDecisionLabel(item).cls}`}>
                                          {nextDecisionLabel(item).label}
                                        </span>
                                        <ArrowLeft size={14} className="text-cyan-300 transition group-hover:-translate-x-0.5" />
                                      </div>
                                    </div>
                                    <div className="mt-3 flex flex-wrap gap-1.5 text-[9px] font-black">
                                      <span className={`rounded-full px-2 py-1 ${invoiceTruthBadge(item).cls}`}>{invoiceTruthBadge(item).label}</span>
                                      {item.actions.followup || item.snapshot.smartIntelligence?.evaluationV2?.followups?.length ? (
                                        <span className="rounded-full bg-violet-500/10 px-2 py-1 text-violet-200">متابعة موثقة</span>
                                      ) : null}
                                      {(item.snapshot.smartIntelligence?.evaluationV2?.opportunities?.detected ?? item.intelligence?.salesOpportunities.length ?? 0) > 0 ? (
                                        <span className="rounded-full bg-amber-500/10 px-2 py-1 text-amber-200">
                                          {item.snapshot.smartIntelligence?.evaluationV2?.opportunities?.detected ?? item.intelligence?.salesOpportunities.length ?? 0} فرصة
                                        </span>
                                      ) : null}
                                      {truthQualityBadge(item) ? (
                                        <span className={`rounded-full px-2 py-1 ${truthQualityBadge(item)!.cls}`}>
                                          {truthQualityBadge(item)!.label}
                                          {truthQualityBadge(item)!.evidenceCount ? ` · ${truthQualityBadge(item)!.evidenceCount} دليل` : ''}
                                        </span>
                                      ) : null}
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
          <div className="mx-auto flex h-full max-w-[1480px] flex-col overflow-hidden border-x border-slate-700 bg-[#111c2b] shadow-2xl md:my-2 md:h-[calc(100%-1rem)] md:rounded-3xl md:border" onClick={(event) => event.stopPropagation()}>
            <div className="shrink-0 border-b border-slate-700 bg-[#111c2b]/95 p-4 backdrop-blur">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="truncate text-xl font-black text-white">
                      {selected.snapshot.smartIntelligence?.customer?.customer?.name || selected.customerName || 'عميل غير محدد'}
                    </div>
                    <span className="rounded-full border border-cyan-700/40 bg-cyan-950/30 px-2.5 py-1 text-[10px] font-black text-cyan-100">
                      {saleTruth(selected).label}
                    </span>
                    {truthQualityBadge(selected) ? (
                      <span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${truthQualityBadge(selected)!.cls}`}>
                        {truthQualityBadge(selected)!.label}
                        {truthQualityBadge(selected)!.evidenceCount ? ` · ${truthQualityBadge(selected)!.evidenceCount} دليل` : ''}
                      </span>
                    ) : null}
                    <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black ${nextDecisionLabel(selected).cls}`}>
                      {nextDecisionLabel(selected).label}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
                    <span>{selected.staffIdentity.canonicalStaffName || selected.staffName}</span>
                    <span>·</span>
                    <span>{roleLabel(selected.role)}</span>
                    <span>·</span>
                    <span>{selected.staffIdentity.branch || selected.branchHint.value || 'فرع غير محدد'}</span>
                    {selected.snapshot.smartIntelligence?.customer?.customer?.code ? <><span>·</span><span>كود العميل {selected.snapshot.smartIntelligence.customer.customer.code}</span></> : null}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[9px] font-black">
                    <span className={`rounded-full px-2 py-1 ${invoiceTruthBadge(selected).cls}`}>{invoiceTruthBadge(selected).label}</span>
                    {selected.actions.followup || selected.snapshot.smartIntelligence?.evaluationV2?.followups?.length ? (
                      <span className="rounded-full bg-violet-500/10 px-2 py-1 text-violet-200">متابعة موثقة</span>
                    ) : null}
                    <span className="rounded-full bg-slate-900/70 px-2 py-1 text-slate-400">
                      {selected.snapshot.messages.length} رسالة تقييم
                    </span>
                  </div>
                </div>
                <button type="button" onClick={() => setSelected(null)} className="rounded-xl border border-slate-700 bg-slate-950/30 p-2 text-slate-300 transition hover:border-slate-500 hover:text-white"><X size={18} /></button>
              </div>
            </div>

            <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-slate-800 bg-slate-950/20 px-3 pt-2">
              <button
                type="button"
                onClick={() => setDetailTab('overview')}
                className={`min-w-fit rounded-t-xl px-4 py-2 text-right transition ${detailTab === 'overview' ? 'bg-cyan-500 text-slate-950' : 'text-slate-400 hover:bg-slate-800/60 hover:text-white'}`}
              >
                <div className="text-xs font-black">الملخص التنفيذي</div>
                <div className={`mt-0.5 text-[9px] ${detailTab === 'overview' ? 'text-slate-800' : 'text-slate-600'}`}>{nextDecisionLabel(selected).label}</div>
              </button>
              <button
                type="button"
                onClick={() => setDetailTab('conversation')}
                className={`min-w-fit rounded-t-xl px-4 py-2 text-right transition ${detailTab === 'conversation' ? 'bg-cyan-500 text-slate-950' : 'text-slate-400 hover:bg-slate-800/60 hover:text-white'}`}
              >
                <div className="text-xs font-black">المحادثة والأدلة</div>
                <div className={`mt-0.5 text-[9px] ${detailTab === 'conversation' ? 'text-slate-800' : 'text-slate-600'}`}>
                  {selected.snapshot.messages.length} رسالة · {selected.snapshot.messages.filter((message) => message.evidence || messageEvidenceLabels(selected, message.id).length > 0).length} دليل
                </div>
              </button>
              <button
                type="button"
                onClick={() => setDetailTab('review')}
                className={`min-w-fit rounded-t-xl px-4 py-2 text-right transition ${detailTab === 'review' ? 'bg-cyan-500 text-slate-950' : 'text-slate-400 hover:bg-slate-800/60 hover:text-white'}`}
              >
                <div className="text-xs font-black">تقييم الخدمة</div>
                <div className={`mt-0.5 text-[9px] ${detailTab === 'review' ? 'text-slate-800' : 'text-slate-600'}`}>
                  {selected.snapshot.smartIntelligence?.evaluationV2?.qualityScore != null
                    ? `${selected.snapshot.smartIntelligence.evaluationV2.qualityScore}/100`
                    : 'درجة غير محسومة'}
                  {selected.snapshot.officialReviewDraft ? ` · ${selected.snapshot.officialReviewDraft.needsReviewCriteriaCount} بند مراجعة` : ''}
                </div>
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {detailTab === 'overview' ? (
                <div className="space-y-3">
                  {(() => {
                    const truth = saleTruth(selected);
                    const protocol = protocolStatus(selected);
                    const invoice = selected.snapshot.smartIntelligence?.invoiceVerification;
                    const customer = selected.snapshot.smartIntelligence?.customer;
                    const customerContact = selected.snapshot.smartIntelligence?.customerContact;
                    const evalV2 = selected.snapshot.smartIntelligence?.evaluationV2;
                    const phoneItem = evalV2?.orderCompleteness.items.find((row) => row.key === 'phone');
                    const addressItem = evalV2?.orderCompleteness.items.find((row) => row.key === 'address');
                    const hasSavedPhone = Boolean(
                      customerContact?.phone ||
                      customerContact?.customerPhone ||
                      customerContact?.mobile ||
                      customerContact?.normalizedPhone ||
                      customerContact?.whatsappPhone ||
                      customerContact?.alternatePhone
                    );
                    const hasSavedAddress = Boolean(customerContact?.address);
                    const phoneSource = hasSavedPhone
                      ? 'من ملف العميل'
                      : invoice?.bestCandidate?.customerPhone
                        ? 'من الفاتورة'
                        : phoneItem?.evidenceMessageIds?.length
                          ? 'من المحادثة'
                          : null;
                    const addressSource = hasSavedAddress
                      ? 'من ملف العميل'
                      : invoice?.bestCandidate?.customerAddress
                        ? 'من الفاتورة'
                        : addressItem?.evidenceMessageIds?.length
                          ? 'من المحادثة'
                          : null;
                    const groundedJourney = selected.snapshot.smartIntelligence?.groundedSaleJourneyV33;
                    const productRows = productTruthRows(selected);
                    const nextDecision = nextDecisionLabel(selected);
                    const soldRequestedCount = productRows.filter((row) => row.kind === 'customer_requested_in_invoice').length;
                    const recommendedInInvoiceCount = productRows.filter((row) => row.kind === 'recommended_in_invoice').length;
                    const pharmacyMentionedInInvoiceCount = productRows.filter((row) => row.kind === 'pharmacy_mentioned_in_invoice').length;
                    const invoiceOnlyCount = productRows.filter((row) => row.kind === 'invoice_only').length;
                    const serviceLineCount = productRows.filter((row) => row.kind === 'invoice_service').length;
                    const missingFromInvoiceCount = productRows.filter((row) => row.kind === 'customer_requested_not_in_invoice').length;
                    const invoiceItemsTotal = (selected.snapshot.smartIntelligence?.invoiceItems || [])
                      .reduce((sum, row) => sum + (Number.isFinite(Number(row.lineTotal)) ? Number(row.lineTotal) : 0), 0);
                    const invoiceItemsDifference = invoice?.revenue != null && invoiceItemsTotal > 0
                      ? Math.abs(Number(invoice.revenue) - invoiceItemsTotal)
                      : null;
                    const toneClass = truth.tone === 'emerald'
                      ? 'border-emerald-700/50 bg-emerald-950/15'
                      : truth.tone === 'amber'
                        ? 'border-amber-700/50 bg-amber-950/15'
                        : truth.tone === 'cyan'
                          ? 'border-cyan-700/50 bg-cyan-950/15'
                          : 'border-slate-700 bg-slate-950/20';
                    return (
                      <section className={`rounded-2xl border p-4 ${toneClass}`}>
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-[10px] font-black text-slate-400">الخلاصة التنفيذية</div>
                            <div className="mt-1 text-lg font-black text-white">{truth.label}</div>
                            <div className="mt-1 text-xs leading-6 text-slate-300">{truth.detail}</div>
                          </div>
                          <div className="rounded-xl bg-black/15 px-3 py-2 text-center">
                            <div className="text-[10px] text-slate-500">حالة المراجعة</div>
                            <div className="mt-1 text-xs font-black text-white">{decisionLabel(selected.decision)}</div>
                          </div>
                        </div>

                        {groundedJourney?.truthQuality ? (
                          <div className={`mt-4 rounded-xl border px-3 py-2.5 ${
                            groundedJourney.truthQuality.status === 'grounded'
                              ? 'border-emerald-800/40 bg-emerald-950/10'
                              : groundedJourney.truthQuality.status === 'partial'
                                ? 'border-amber-800/40 bg-amber-950/10'
                                : 'border-rose-800/40 bg-rose-950/10'
                          }`}>
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <div className="text-[10px] font-black text-slate-500">جودة حقيقة التحليل</div>
                                <div className={`mt-0.5 text-sm font-black ${
                                  groundedJourney.truthQuality.status === 'grounded'
                                    ? 'text-emerald-200'
                                    : groundedJourney.truthQuality.status === 'partial'
                                      ? 'text-amber-200'
                                      : 'text-rose-200'
                                }`}>
                                  {groundedJourney.truthQuality.status === 'grounded'
                                    ? 'موثقة بالأدلة'
                                    : groundedJourney.truthQuality.status === 'partial'
                                      ? 'موثقة جزئيًا'
                                      : 'تحتاج مراجعة قبل الاعتماد'}
                                </div>
                              </div>
                              <div className="flex flex-wrap gap-1.5 text-[9px]">
                                <span className="rounded-full bg-black/15 px-2 py-1 text-slate-300">{groundedJourney.truthQuality.directMessageEvidenceCount} دليل رسالة</span>
                                <span className={`rounded-full px-2 py-1 ${groundedJourney.truthQuality.invoiceCandidateStrong ? 'bg-emerald-500/10 text-emerald-300' : 'bg-slate-800 text-slate-500'}`}>{groundedJourney.truthQuality.invoiceCandidateStrong ? 'مطابقة فاتورة قوية' : 'لا توجد مطابقة قوية'}</span>
                                <span className={`rounded-full px-2 py-1 ${groundedJourney.truthQuality.customerResolved ? 'bg-emerald-500/10 text-emerald-300' : 'bg-slate-800 text-slate-500'}`}>{groundedJourney.truthQuality.customerResolved ? 'عميل مربوط' : 'هوية غير محسومة'}</span>
                              </div>
                            </div>
                            {groundedJourney.truthQuality.blockers.length || groundedJourney.truthQuality.caveats.length ? (
                              <div className="mt-2 grid gap-1 text-[10px] leading-5">
                                {groundedJourney.truthQuality.blockers.map((item) => <div key={item} className="text-rose-200">• مانع اعتماد: {item}</div>)}
                                {groundedJourney.truthQuality.caveats.map((item) => <div key={item} className="text-amber-100">• تنبيه: {item}</div>)}
                              </div>
                            ) : null}
                          </div>
                        ) : null}

                        <div className={`mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-3 py-2.5 ${nextDecision.cls}`}>
                          <div>
                            <div className="text-[10px] font-black opacity-70">القرار المطلوب الآن</div>
                            <div className="mt-0.5 text-sm font-black">{nextDecision.label}</div>
                          </div>
                          <div className="max-w-2xl text-[10px] leading-5 opacity-80">{nextDecision.detail}</div>
                        </div>

                        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
                          <div className="rounded-xl border border-sky-800/35 bg-sky-950/10 p-3 xl:col-span-2">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div>
                                <div className="text-[10px] font-black text-sky-300/70">الفاتورة والبيع</div>
                                <div className="mt-1 text-sm font-black text-white">
                                  {invoice?.bestCandidate?.invoiceNumber ? `فاتورة #${invoice.bestCandidate.invoiceNumber}` : 'لا توجد فاتورة مرتبطة'}
                                </div>
                              </div>
                              <span className={`rounded-full px-2 py-1 text-[9px] font-black ${invoiceTruthBadge(selected).cls}`}>{invoiceTruthBadge(selected).label}</span>
                            </div>
                            <div className="mt-2 flex flex-wrap items-end justify-between gap-2">
                              <div>
                                <div className="text-[9px] text-slate-500">قيمة الفاتورة</div>
                                <div className="mt-0.5 text-lg font-black text-sky-100">{invoice?.revenue != null ? `${invoice.revenue} ج` : '—'}</div>
                              </div>
                              {invoiceItemsTotal > 0 ? (
                                <div className="text-left">
                                  <div className="text-[9px] text-slate-500">مجموع البنود</div>
                                  <div className={`mt-0.5 text-xs font-black ${invoiceItemsDifference != null && invoiceItemsDifference > 0.05 ? 'text-amber-300' : 'text-emerald-300'}`}>
                                    {invoiceItemsTotal.toFixed(2)} ج
                                    {invoiceItemsDifference != null ? (invoiceItemsDifference <= 0.05 ? ' · مطابق' : ` · فرق ${invoiceItemsDifference.toFixed(2)} ج`) : ''}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                            {selected.canonicalSaleProofState === 'proven' ? (
                              <div className="mt-2 rounded-lg border border-emerald-700/40 bg-emerald-950/20 px-2 py-1.5 text-[10px] font-black text-emerald-200">
                                ✓ Sale Proof Canonical — Proven
                              </div>
                            ) : invoice?.bestCandidate?.invoiceId && selected.sourceId ? (
                              <button
                                type="button"
                                disabled={confirmingInvoiceSourceId === selected.sourceId}
                                onClick={() => void confirmSelectedInvoiceLink()}
                                className="mt-2 w-full rounded-lg border border-cyan-700/50 bg-cyan-950/25 px-2 py-1.5 text-[10px] font-black text-cyan-100 transition hover:border-cyan-500 disabled:opacity-50"
                              >
                                {confirmingInvoiceSourceId === selected.sourceId
                                  ? 'جاري اعتماد الربط وفحص Canonical...'
                                  : `اعتماد ربط الفاتورة #${invoice.bestCandidate.invoiceNumber || ''}`}
                              </button>
                            ) : (
                              <div className="mt-2 text-[9px] leading-4 text-slate-500">{invoice?.reason || 'لا توجد فاتورة مرشحة قوية لهذه الحالة.'}</div>
                            )}
                            {invoice?.bestCandidate?.invoiceId && selected.canonicalSaleProofState && selected.canonicalSaleProofState !== 'proven' ? (
                              <div className="mt-1 text-[9px] leading-4 text-amber-300">
                                الربط اتراجع Canonical لكن لم يصل Proven بعد: {selected.canonicalSaleProofState}
                              </div>
                            ) : null}
                          </div>

                          <div className="rounded-xl border border-violet-800/35 bg-violet-950/10 p-3 xl:col-span-2">
                            <div className="text-[10px] font-black text-violet-300/70">هوية العميل</div>
                            <div className="mt-1 text-sm font-black text-white">
                              {customer?.customer?.name || selected.customerName || 'عميل غير محدد'}
                            </div>
                            <div className="mt-1 text-[10px] text-slate-400">
                              {customer?.customer
                                ? `مربوط بسجل العميل · كود ${customer.customer.code || '—'}`
                                : 'الاسم موجود لكن الربط بسجل العميل غير محسوم'}
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1.5 text-[9px] font-black">
                              <span className={`rounded-full px-2 py-1 ${customer?.customer ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-300'}`}>
                                {customer?.customer ? 'هوية مربوطة' : 'تحتاج مراجعة الهوية'}
                              </span>
                              <span className={`rounded-full px-2 py-1 ${phoneSource ? 'bg-emerald-500/10 text-emerald-300' : 'bg-slate-800 text-slate-500'}`}>
                                {phoneSource ? `تليفون · ${phoneSource}` : 'تليفون غير متاح'}
                              </span>
                              <span className={`rounded-full px-2 py-1 ${addressSource ? 'bg-emerald-500/10 text-emerald-300' : 'bg-slate-800 text-slate-500'}`}>
                                {addressSource ? `عنوان · ${addressSource}` : 'عنوان غير مثبت'}
                              </span>
                            </div>
                            {!customer?.customer && customer?.reason ? <div className="mt-2 text-[9px] leading-4 text-amber-200">{customer.reason}</div> : null}
                          </div>

                          <div className={`rounded-xl border p-3 ${protocol.orderConfirmationConfirmed ? 'border-emerald-800/40 bg-emerald-950/10' : 'border-amber-800/30 bg-amber-950/5'}`}>
                            <div className="text-[10px] font-black text-slate-500">اكتمال الطلب</div>
                            <div className={`mt-1 text-lg font-black ${protocol.orderConfirmationConfirmed ? 'text-emerald-200' : 'text-amber-200'}`}>
                              {evalV2?.orderCompleteness?.applicable
                                ? `${evalV2.orderCompleteness.confirmedCount}/${evalV2.orderCompleteness.requiredCount}`
                                : 'غير منطبق'}
                            </div>
                            <div className="mt-1 text-[10px] font-black text-slate-300">{protocol.orderConfirmation}</div>
                            {evalV2?.orderCompleteness?.missingCritical?.length ? (
                              <div className="mt-2 flex flex-wrap gap-1">
                                {evalV2.orderCompleteness.missingCritical.slice(0, 3).map((item) => <span key={item} className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[9px] text-amber-300">{item}</span>)}
                              </div>
                            ) : null}
                          </div>

                          <div className="rounded-xl border border-slate-800 bg-black/10 p-3">
                            <div className="text-[10px] font-black text-slate-500">بروتوكول المحادثة</div>
                            <div className="mt-2 space-y-2 text-[10px]">
                              <div className="flex items-center justify-between gap-2"><span className="text-slate-500">الترحيب</span><span className={`rounded-full px-2 py-1 font-black ${protocol.openingOfficial ? 'bg-emerald-500/10 text-emerald-300' : 'bg-slate-800 text-slate-300'}`}>{protocol.opening}</span></div>
                              <div className="flex items-center justify-between gap-2"><span className="text-slate-500">الختام</span><span className={`rounded-full px-2 py-1 font-black ${protocol.closingOfficial ? 'bg-emerald-500/10 text-emerald-300' : 'bg-slate-800 text-slate-300'}`}>{protocol.closing}</span></div>
                            </div>
                          </div>
                        </div>

                        <div className="mt-3 grid gap-2 lg:grid-cols-3">
                          <div className="rounded-xl bg-black/10 p-3">
                            <div className="text-[10px] font-black text-slate-500">فهم الطلب</div>
                            <div className="mt-1 text-xs leading-5 text-slate-300">
                              {evalV2?.orderCompleteness?.applicable
                                ? `تم إثبات ${evalV2.orderCompleteness.confirmedCount} من ${evalV2.orderCompleteness.requiredCount} عنصر مطلوب للتنفيذ.`
                                : 'لا توجد عناصر طلب كافية للحكم الكامل على اكتمال الطلب.'}
                            </div>
                          </div>
                          <div className="rounded-xl bg-black/10 p-3">
                            <div className="text-[10px] font-black text-slate-500">الأصناف</div>
                            <div className="mt-1 text-xs leading-5 text-slate-300">
                              {productRows.length
                                ? [
                                    `${productRows.filter((row) => row.kind !== 'invoice_service').length} صنف مجمع`,
                                    soldRequestedCount ? `${soldRequestedCount} طلبه العميل وظهر بالفاتورة` : null,
                                    recommendedInInvoiceCount ? `${recommendedInInvoiceCount} ترشيح وظهر بالفاتورة` : null,
                                    pharmacyMentionedInInvoiceCount ? `${pharmacyMentionedInInvoiceCount} ذكرته الصيدلية وظهر بالفاتورة` : null,
                                    invoiceOnlyCount ? `${invoiceOnlyCount} بالفاتورة فقط` : null,
                                    missingFromInvoiceCount ? `${missingFromInvoiceCount} طلبه العميل ولم يظهر بالفاتورة` : null,
                                    serviceLineCount ? `${serviceLineCount} خدمة/رسوم` : null,
                                  ].filter(Boolean).join(' · ')
                                : invoice?.status === 'verified'
                                  ? 'توجد مطابقة فاتورة قوية لكن تفاصيل الأصناف لم تُحمّل لهذه الحالة بعد.'
                                  : 'لا توجد فاتورة مرشحة قوية تسمح بمقارنة الأصناف حتى الآن.'}
                            </div>
                          </div>
                          <div className="rounded-xl bg-black/10 p-3">
                            <div className="text-[10px] font-black text-slate-500">ما يحتاج مراجعة؟</div>
                            <div className="mt-1 text-xs leading-5 text-slate-300">
                              {selected.reasons.length ? selected.reasons.slice(0, 2).join(' · ') : 'لا توجد ملاحظات مؤثرة غير محسومة.'}
                            </div>
                          </div>
                        </div>

                        {productRows.length ? (
                          <div className="mt-3 overflow-hidden rounded-xl border border-slate-800 bg-black/10">
                            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-3 py-2">
                              <div className="text-xs font-black text-white">مطابقة طلب العميل مع أصناف الفاتورة</div>
                              <div className="text-[10px] text-slate-500">
                                {invoice?.status === 'verified'
                                  ? 'هذه مطابقة فاتورة آلية قوية وليست Sale Proof نهائيًا قبل اعتماد الربط؛ نص المحادثة يفسّر مصدر كل صنف.'
                                  : 'الفاتورة مرشحة وليست حقيقة نهائية بعد؛ المقارنة للمعاينة وتحتاج مراجعة.'}
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2 border-b border-slate-800 bg-slate-950/20 p-3 sm:grid-cols-4">
                              <div className="rounded-xl border border-cyan-800/30 bg-cyan-950/10 p-2.5">
                                <div className="text-[9px] font-black text-cyan-300/70">طلب العميل + الفاتورة</div>
                                <div className="mt-1 text-lg font-black text-cyan-100">{soldRequestedCount}</div>
                              </div>
                              <div className="rounded-xl border border-amber-800/30 bg-amber-950/10 p-2.5">
                                <div className="text-[9px] font-black text-amber-300/70">طلب ناقص من الفاتورة</div>
                                <div className="mt-1 text-lg font-black text-amber-100">{missingFromInvoiceCount}</div>
                              </div>
                              <div className="rounded-xl border border-violet-800/30 bg-violet-950/10 p-2.5">
                                <div className="text-[9px] font-black text-violet-300/70">ترشيح ظهر بالفاتورة</div>
                                <div className="mt-1 text-lg font-black text-violet-100">{recommendedInInvoiceCount}</div>
                              </div>
                              <div className="rounded-xl border border-sky-800/30 bg-sky-950/10 p-2.5">
                                <div className="text-[9px] font-black text-sky-300/70">فاتورة فقط</div>
                                <div className="mt-1 text-lg font-black text-sky-100">{invoiceOnlyCount}</div>
                              </div>
                            </div>
                            {(pharmacyMentionedInInvoiceCount || serviceLineCount) ? (
                              <div className="flex flex-wrap gap-1.5 border-b border-slate-800 px-3 py-2 text-[9px] font-black">
                                {pharmacyMentionedInInvoiceCount ? <span className="rounded-full bg-indigo-500/10 px-2 py-1 text-indigo-300">{pharmacyMentionedInInvoiceCount} ذكر للصيدلية ظهر بالفاتورة</span> : null}
                                {serviceLineCount ? <span className="rounded-full bg-slate-800 px-2 py-1 text-slate-400">{serviceLineCount} خدمة/رسوم</span> : null}
                              </div>
                            ) : null}
                            <div className="divide-y divide-slate-800">
                              {productRows.slice(0, 18).map((row, index) => {
                                const badge = productTruthPresentation(row.kind);
                                const quantityStatus =
                                  row.invoiceQuantity != null && row.requestedQuantity != null
                                    ? Number(row.invoiceQuantity) === Number(row.requestedQuantity)
                                      ? { label: 'الكمية مطابقة', cls: 'text-emerald-300' }
                                      : { label: `اختلاف كمية: طلب ${row.requestedQuantity} / فاتورة ${row.invoiceQuantity}`, cls: 'text-amber-300' }
                                    : row.requestedQuantity != null
                                      ? { label: `كمية الطلب: ${row.requestedQuantity}`, cls: 'text-slate-400' }
                                      : row.invoiceQuantity != null
                                        ? { label: `كمية الفاتورة: ${row.invoiceQuantity}`, cls: 'text-slate-400' }
                                        : { label: 'الكمية غير محسومة', cls: 'text-slate-500' };
                                return (
                                  <div key={`${row.productName}-${index}`} className={`border-r-2 px-3 py-3 text-xs transition hover:bg-white/[0.02] ${badge.border}`}>
                                    <div className="flex flex-wrap items-start justify-between gap-2">
                                      <div className="min-w-0">
                                        <div className="font-black text-white">
                                          {row.productName}
                                          {row.sourceLineCount > 1 ? <span className="mr-1 text-[9px] font-normal text-slate-500">({row.sourceLineCount} سطور مجمعة)</span> : null}
                                        </div>
                                        <div className="mt-1 flex flex-wrap gap-1.5">
                                          <span className={`w-fit rounded-full px-2 py-1 text-[9px] font-black ${badge.cls}`}>{badge.label}</span>
                                          <span className={`rounded-full bg-slate-900/60 px-2 py-1 text-[9px] font-bold ${quantityStatus.cls}`}>{quantityStatus.label}</span>
                                        </div>
                                      </div>
                                      <div className="shrink-0 text-left">
                                        <div className="text-[9px] text-slate-500">قيمة البند</div>
                                        <div className="mt-0.5 text-sm font-black text-slate-200">{row.lineTotal != null ? `${Number(row.lineTotal).toFixed(2)} ج` : '—'}</div>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                            {productRows.length > 18 ? <div className="border-t border-slate-800 px-3 py-2 text-[10px] text-slate-500">+ {productRows.length - 18} صنف إضافي</div> : null}
                          </div>
                        ) : null}
                      </section>
                    );
                  })()}

                  {selected.snapshot.smartIntelligence?.groundedSaleJourneyV33 ? (() => {
                    const journey = selected.snapshot.smartIntelligence.groundedSaleJourneyV33;
                    return (
                      <section className="rounded-2xl border border-cyan-800/40 bg-cyan-950/10 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="text-[10px] font-black text-cyan-300">رحلة البيع الموثقة</div>
                            <div className="mt-1 text-base font-black text-white">{journey.outcomeLabel}</div>
                            <div className="mt-1 text-[11px] leading-5 text-slate-400">
                              البداية: {journey.saleWindow.startedAt ? formatCairoDateTime(journey.saleWindow.startedAt) : 'غير مثبتة'}
                              {' · '}
                              النهاية: {journey.saleWindow.endedAt ? formatCairoDateTime(journey.saleWindow.endedAt) : 'غير مثبتة'}
                              {' · '}
                              ثقة {journey.confidence}% · تغطية أدلة {journey.evidenceCoverage}%
                            </div>
                          </div>
                          <div className="rounded-xl border border-cyan-800/30 bg-black/10 px-3 py-2 text-center">
                            <div className="text-[10px] text-slate-500">رسائل رحلة البيع</div>
                            <div className="mt-1 text-lg font-black text-cyan-100">{journey.saleWindow.messageIds.length}</div>
                          </div>
                        </div>

                        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                          {journey.stages.map((stage, stageIndex) => {
                            const hasEvidence = stage.evidenceMessageIds.length > 0;
                            return (
                              <button
                                type="button"
                                key={stage.key}
                                disabled={!hasEvidence}
                                onClick={() => {
                                  if (hasEvidence) {
                                    setConversationFocusMode('sale');
                                    setDetailTab('conversation');
                                  }
                                }}
                                className={`rounded-xl border p-3 text-right transition ${
                                  stage.detected
                                    ? hasEvidence
                                      ? 'border-emerald-800/35 bg-emerald-950/10 hover:border-emerald-600/50 hover:bg-emerald-950/20'
                                      : 'border-emerald-900/25 bg-emerald-950/5'
                                    : 'border-slate-800 bg-slate-950/20 opacity-60'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-2">
                                    <span className={`grid h-5 w-5 place-items-center rounded-full text-[9px] font-black ${stage.detected ? 'bg-emerald-500/15 text-emerald-200' : 'bg-slate-800 text-slate-500'}`}>{stageIndex + 1}</span>
                                    <span className="text-[10px] font-black text-slate-400">{stage.label}</span>
                                  </div>
                                  <span className={`text-[9px] font-black ${stage.detected ? 'text-emerald-300' : 'text-slate-600'}`}>{stage.detected ? 'مثبت' : 'غير مثبت'}</span>
                                </div>
                                <div className="mt-2 text-xs font-black text-white">{stage.at ? formatCairoDateTime(stage.at) : '—'}</div>
                                <div className="mt-1 line-clamp-2 text-[9px] leading-4 text-slate-500">{stage.reason}</div>
                                <div className="mt-2 flex items-center justify-between gap-2 text-[9px] font-black">
                                  <span className={hasEvidence ? 'text-cyan-300' : 'text-slate-600'}>
                                    {stage.evidenceMessageIds.length} دليل
                                  </span>
                                  {hasEvidence ? <span className="text-cyan-300">عرض الدليل ←</span> : <span className="text-slate-600">لا دليل مباشر</span>}
                                </div>
                              </button>
                            );
                          })}
                        </div>

                        {journey.warnings.length ? (
                          <div className="mt-3 rounded-xl border border-amber-800/30 bg-amber-950/10 p-3 text-[10px] leading-5 text-amber-100">
                            {journey.warnings.map((warning) => <div key={warning}>• {warning}</div>)}
                          </div>
                        ) : null}
                      </section>
                    );
                  })() : null}

                  <section className="rounded-2xl border border-violet-800/40 bg-violet-950/10 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-[10px] font-black text-violet-300">سياق رحلة العميل</div>
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
                          <div className="text-[10px] font-black text-cyan-300">الزمن ومسار التنفيذ</div>
                          <div className="mt-1 text-sm font-black text-white">من طلب العميل حتى الرد والتأكيد والتنفيذ</div>
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
                          <div className="text-[10px] font-black text-amber-300">تحليل سبب التأخير</div>
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
                      <div className="text-[10px] font-black text-slate-500">ربط المسؤول</div>
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
                      <div className="text-[10px] font-black text-slate-500">ربط العميل</div>
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
                    <div className="rounded-xl border border-slate-800 bg-slate-950/30 p-3"><div className="text-[10px] text-slate-500">جاهزية الاعتماد</div><div className="mt-1 text-sm font-black text-white">{selected.safe ? 'ممكن بعد مراجعة' : 'غير مسموح'}</div></div>
                  </section>

                  {selected.snapshot.smartIntelligence?.evaluationV2 ? (
                    <section className="rounded-2xl border border-cyan-800/40 bg-cyan-950/10 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="text-[10px] font-black text-cyan-300">جودة المحادثة</div>
                          <div className="mt-1 text-base font-black text-white">تقييم جودة التعامل مع المحادثة</div>
                          <div className="mt-1 text-xs leading-6 text-slate-400">البيع والفاتورة محسومان في الملخص التنفيذي بالأعلى؛ هنا التركيز على جودة الخدمة، اكتمال الطلب، وسلامة الإغلاق.</div>
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
                      <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-black text-sky-200">مراجعة تشخيصية</span>
                      <b className="text-sm text-white">{selected.journeyCrossCheck.journeyLabel}</b>
                    </div>
                    <div className="mt-1 text-xs text-slate-400">{selected.journeyCrossCheck.saleStateLabel}</div>
                    <div className="mt-1 text-[10px] text-slate-500">للتفسير والمراجعة فقط؛ لا يتقدم على حقيقة الفاتورة أو ملخص القرار بالأعلى.</div>
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
                            تقييم المسؤول ({selected.snapshot.messages.length})
                          </button>
                          <button type="button" onClick={() => setConversationFocusMode('sale')} className={`rounded-lg px-3 py-1.5 ${conversationFocusMode === 'sale' ? 'bg-cyan-500 text-slate-950' : 'text-slate-300'}`}>
                            رحلة البيع ({selected.snapshot.smartIntelligence?.groundedSaleJourneyV33?.saleWindow.messageIds.length || 0})
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
                      <div className="sticky top-0 z-10 mx-auto mb-4 flex max-w-3xl flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-700/70 bg-[#111b21]/95 px-3 py-2 text-[10px] shadow-lg backdrop-blur">
                        <div className="font-black text-slate-200">
                          {conversationFocusMode === 'focused' ? 'رسائل التقييم الفعلية' : conversationFocusMode === 'sale' ? 'رسائل رحلة البيع فقط' : 'الرحلة الكاملة'}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          <span className="rounded-full bg-violet-500/10 px-2 py-1 font-black text-violet-200">{messagesForConversationMode(selected, conversationFocusMode).filter((m) => (m.focusLevel || (m.evidence ? 'primary' : m.scope === 'context' ? 'background' : 'supporting')) === 'primary').length} محوري</span>
                          <span className="rounded-full bg-cyan-500/10 px-2 py-1 font-black text-cyan-200">{messagesForConversationMode(selected, conversationFocusMode).filter((m) => m.evidence).length} دليل</span>
                          <span className="rounded-full bg-slate-800 px-2 py-1 font-black text-slate-400">{messagesForConversationMode(selected, conversationFocusMode).length} رسالة</span>
                        </div>
                      </div>
                      <div className="mx-auto max-w-3xl space-y-2" dir="rtl">
                        {messagesForConversationMode(selected, conversationFocusMode).map((message) => {
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
                          const evidenceLabels = messageEvidenceLabels(selected, message.id);
                          const hasTypedEvidence = evidenceLabels.length > 0;
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
                                  <div className={`relative rounded-2xl px-3.5 py-2.5 shadow-sm ${inbound ? 'rounded-tl-sm bg-[#202c33] text-slate-100' : 'rounded-tr-sm bg-[#005c4b] text-white'} ${message.evidence || hasTypedEvidence ? 'ring-2 ring-cyan-400/80 ring-offset-2 ring-offset-[#0b141a]' : ''}`}>
                                    <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[10px] font-bold opacity-80">
                                      <span>{inbound ? 'العميل' : message.sender || selected.staffName}</span>
                                      {evidenceLabels.map((label) => <span key={label} className="rounded bg-cyan-400/15 px-1.5 py-0.5 text-cyan-100">{label}</span>)}
                                      {message.evidence && !hasTypedEvidence ? <span className="rounded bg-cyan-400/15 px-1.5 py-0.5 text-cyan-100">دليل</span> : null}
                                      {focusLevel === 'primary' ? <span className="rounded bg-violet-400/15 px-1.5 py-0.5 text-violet-100">محوري</span> : focusLevel === 'supporting' ? <span className="rounded bg-sky-400/10 px-1.5 py-0.5 text-sky-100">مساند</span> : <span className="rounded bg-white/10 px-1.5 py-0.5">خلفية</span>}
                                    </div>
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
                      {messagesForConversationMode(selected, conversationFocusMode).map((message) => {
                        const evidenceLabels = messageEvidenceLabels(selected, message.id);
                        const context = message.scope === 'context';
                        const focusLevel = message.focusLevel || (message.evidence ? 'primary' : context ? 'background' : 'supporting');
                        const hasTypedEvidence = evidenceLabels.length > 0;
                        return (
                          <div
                            key={message.id}
                            className={`rounded-xl border p-3 transition ${
                              hasTypedEvidence || message.evidence
                                ? 'border-cyan-500/60 bg-cyan-950/20'
                                : context
                                  ? 'border-dashed border-slate-700 bg-slate-950/20 opacity-70'
                                  : 'border-slate-800 bg-slate-950/35'
                            }`}
                          >
                            <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                              <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-black">
                                <span className="text-slate-300">{message.direction === 'inbound' ? 'العميل' : message.sender || selected.staffName}</span>
                                {evidenceLabels.map((label) => (
                                  <span key={label} className="rounded-full bg-cyan-500/10 px-2 py-1 text-cyan-200">{label}</span>
                                ))}
                                {message.evidence && !hasTypedEvidence ? <span className="rounded-full bg-cyan-500/10 px-2 py-1 text-cyan-200">دليل</span> : null}
                                <span className={`rounded-full px-2 py-1 ${
                                  focusLevel === 'primary'
                                    ? 'bg-violet-500/10 text-violet-200'
                                    : focusLevel === 'supporting'
                                      ? 'bg-sky-500/10 text-sky-200'
                                      : 'bg-slate-800 text-slate-500'
                                }`}>
                                  {focusLevel === 'primary' ? 'محوري' : focusLevel === 'supporting' ? 'مساند' : 'خلفية'}
                                </span>
                              </div>
                              <span className="text-[10px] text-slate-600">{new Date(message.timestamp).toLocaleString('ar-EG')}</span>
                            </div>
                            <div className="text-sm leading-6 text-slate-200">{messageBody(message.kind, message.text)}</div>
                          </div>
                        );
                      })}
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

                      <section className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                        <div className="rounded-2xl border border-emerald-800/35 bg-emerald-950/10 p-3.5">
                          <div className="text-[10px] font-black text-emerald-300/70">أقوى نقطة</div>
                          <div className="mt-1 text-sm font-black text-emerald-100">
                            {selected.snapshot.smartIntelligence.evaluationV2.strongestAxis || 'غير محسومة بالأدلة'}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-amber-800/35 bg-amber-950/10 p-3.5">
                          <div className="text-[10px] font-black text-amber-300/70">أهم نقطة تحسين</div>
                          <div className="mt-1 text-sm font-black text-amber-100">
                            {selected.snapshot.smartIntelligence.evaluationV2.weakestAxis || 'لا توجد نقطة ضعف مؤكدة'}
                          </div>
                        </div>
                        <div className={`rounded-2xl border p-3.5 ${nextDecisionLabel(selected).cls}`}>
                          <div className="text-[10px] font-black opacity-70">القرار التالي</div>
                          <div className="mt-1 text-sm font-black">{nextDecisionLabel(selected).label}</div>
                          <div className="mt-1 line-clamp-2 text-[10px] leading-5 opacity-75">{nextDecisionLabel(selected).detail}</div>
                        </div>
                        <div className={`rounded-2xl border p-3.5 ${
                          selected.snapshot.smartIntelligence.evaluationV2.warnings.length
                            ? 'border-rose-800/35 bg-rose-950/10 text-rose-100'
                            : 'border-slate-800 bg-slate-950/25 text-slate-300'
                        }`}>
                          <div className="text-[10px] font-black opacity-70">تحذيرات الأدلة</div>
                          <div className="mt-1 text-xs font-bold leading-5">
                            {selected.snapshot.smartIntelligence.evaluationV2.warnings.length
                              ? selected.snapshot.smartIntelligence.evaluationV2.warnings.slice(0, 2).join(' • ')
                              : 'لا توجد تحذيرات مؤثرة على القراءة الحالية.'}
                          </div>
                        </div>
                      </section>

                      <section className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                        {selected.snapshot.smartIntelligence.evaluationV2.axes.map((axis) => {
                          const scoreTone = axis.score == null
                            ? 'text-slate-500'
                            : axis.score >= 85
                              ? 'text-emerald-300'
                              : axis.score >= 65
                                ? 'text-cyan-200'
                                : 'text-amber-300';
                          const stateLabel = axis.score == null
                            ? 'غير محسوم'
                            : axis.coverage < 50
                              ? 'أدلة محدودة'
                              : axis.score >= 85
                                ? 'قوي'
                                : axis.score >= 65
                                  ? 'جيد'
                                  : 'يحتاج تحسين';
                          const stateClass = axis.score == null
                            ? 'bg-slate-800 text-slate-400'
                            : axis.coverage < 50
                              ? 'bg-amber-500/10 text-amber-300'
                              : axis.score >= 85
                                ? 'bg-emerald-500/10 text-emerald-300'
                                : axis.score >= 65
                                  ? 'bg-cyan-500/10 text-cyan-200'
                                  : 'bg-amber-500/10 text-amber-300';
                          return (
                            <div key={axis.key} className="rounded-2xl border border-slate-800 bg-slate-950/25 p-3.5">
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <div className="text-[10px] font-black text-slate-500">{axis.label}</div>
                                  <div className={`mt-1 text-2xl font-black ${scoreTone}`}>{axis.score ?? '—'}</div>
                                </div>
                                <div className="flex flex-col items-end gap-1">
                                  <span className={`rounded-full px-2 py-1 text-[9px] font-black ${stateClass}`}>{stateLabel}</span>
                                  <span className="text-[9px] font-black text-slate-600">تغطية {axis.coverage}%</span>
                                </div>
                              </div>
                              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800">
                                <div className={`h-full rounded-full ${scoreTone.replace('text-', 'bg-')} opacity-70`} style={{ width: `${Math.max(0, Math.min(100, axis.score || 0))}%` }} />
                              </div>
                              <div className="mt-2 text-[10px] leading-5 text-slate-400">{axis.summary}</div>
                            </div>
                          );
                        })}
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
                          <div className="text-xs font-black text-emerald-200">حقيقة البيع والتنفيذ</div>
                          <div className="mt-1 text-base font-black text-white">{saleTruth(selected).label}</div>
                          <div className="mt-1 text-xs leading-6 text-slate-400">{saleTruth(selected).detail}</div>
                          <div className="mt-2 text-[10px] leading-5 text-slate-500">
                            مطابقة الفاتورة الآلية — حتى لو كانت قوية — تظل مرشحًا للمراجعة ولا تثبت البيع وحدها. البيع الرسمي لا يُحسب إلا عند Canonical Sale Proof، بينما تأكيد الدكتور للأصناف مع العميل يُقيَّم كخطوة خدمة مستقلة.
                          </div>
                        </div>
                        <div className="rounded-2xl border border-sky-800/30 bg-sky-950/10 p-4">
                          <div className="text-xs font-black text-sky-200">اكتمال الأوردر</div>
                          <div className="mt-1 text-base font-black text-white">{selected.snapshot.smartIntelligence.evaluationV2.orderCompleteness.applicable ? `${selected.snapshot.smartIntelligence.evaluationV2.orderCompleteness.confirmedCount}/${selected.snapshot.smartIntelligence.evaluationV2.orderCompleteness.requiredCount}` : 'غير منطبق'}</div>
                          {selected.snapshot.smartIntelligence.evaluationV2.orderCompleteness.applicable ? (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {selected.snapshot.smartIntelligence.evaluationV2.orderCompleteness.items.filter((item) => item.status !== 'not_applicable').map((item) => (
                                <span key={item.key} className={`rounded-full px-2 py-1 text-[10px] font-black ${item.status === 'confirmed' ? 'bg-emerald-500/10 text-emerald-300' : item.status === 'missing' ? 'bg-rose-500/10 text-rose-300' : 'bg-slate-800 text-slate-400'}`}>
                                  {item.status === 'confirmed' ? '✓ ' : item.status === 'missing' ? 'ناقص: ' : ''}{item.label}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </section>

                      <section className="grid gap-3 lg:grid-cols-2">
                        <div className="rounded-2xl border border-slate-800 p-4">
                          <div className="text-xs font-black text-white">الترحيب والختام</div>
                          <div className="mt-3 grid grid-cols-2 gap-2">
                            <div className="rounded-xl bg-slate-950/30 p-3">
                              <div className="flex items-center justify-between gap-2"><span className="text-[10px] text-slate-500">الترحيب</span><b className="text-white">{selected.snapshot.smartIntelligence.evaluationV2.opening.score ?? '—'}</b></div>
                              <div className="mt-1 text-[10px] leading-5 text-slate-500">{selected.snapshot.smartIntelligence.evaluationV2.opening.missing.length ? `ناقص: ${selected.snapshot.smartIntelligence.evaluationV2.opening.missing.join('، ')}` : 'مكتمل'}</div>
                              <div className="mt-1 text-[9px] leading-4 text-slate-600">{selected.snapshot.smartIntelligence.evaluationV2.opening.evidence.reason}</div>
                            </div>
                            <div className="rounded-xl bg-slate-950/30 p-3">
                              <div className="flex items-center justify-between gap-2"><span className="text-[10px] text-slate-500">الختام</span><b className="text-white">{selected.snapshot.smartIntelligence.evaluationV2.closing.score ?? '—'}</b></div>
                              <div className="mt-1 text-[10px] leading-5 text-slate-500">{selected.snapshot.smartIntelligence.evaluationV2.closing.missing.length ? `ناقص: ${selected.snapshot.smartIntelligence.evaluationV2.closing.missing.join('، ')}` : 'مكتمل'}</div>
                              <div className="mt-1 text-[9px] leading-4 text-slate-600">{selected.snapshot.smartIntelligence.evaluationV2.closing.evidence.reason}</div>
                            </div>
                          </div>
                        </div>
                        <div className="rounded-2xl border border-cyan-800/30 bg-cyan-950/10 p-4">
                          <div className="text-xs font-black text-cyan-200">فرص المتابعة القادمة</div>
                          <div className="mt-2 space-y-2">
                            {selected.snapshot.smartIntelligence.evaluationV2.followups.length ? selected.snapshot.smartIntelligence.evaluationV2.followups.map((item) => (
                              <div key={item.type} className="rounded-xl border border-cyan-900/30 bg-black/10 p-3 text-xs">
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                  <div>
                                    <div className="font-black text-white">{item.label}</div>
                                    <div className="mt-0.5 text-[10px] text-slate-500">{item.timingLabel}</div>
                                  </div>
                                  <div className="flex flex-wrap gap-1.5 text-[9px] font-black">
                                    <span className={`rounded-full px-2 py-1 ${item.priority === 'high' ? 'bg-rose-500/10 text-rose-300' : item.priority === 'commercial' ? 'bg-amber-500/10 text-amber-300' : 'bg-cyan-500/10 text-cyan-200'}`}>
                                      {item.priority === 'high' ? 'أولوية عالية' : item.priority === 'commercial' ? 'فرصة تجارية' : 'أولوية متوسطة'}
                                    </span>
                                    <span className="rounded-full bg-slate-800 px-2 py-1 text-slate-400">ثقة {item.confidence}%</span>
                                    <span className="rounded-full bg-violet-500/10 px-2 py-1 text-violet-300">{item.evidenceMessageIds.length} دليل</span>
                                  </div>
                                </div>
                                <div className="mt-2 leading-5 text-slate-400">{item.reason}</div>
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
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                <div className={`min-w-0 flex-1 rounded-xl border px-3 py-2 ${nextDecisionLabel(selected).cls}`}>
                  <div className="text-[9px] font-black opacity-70">القرار التالي</div>
                  <div className="mt-0.5 text-xs font-black">{nextDecisionLabel(selected).label}</div>
                  <div className="mt-0.5 line-clamp-1 text-[10px] leading-5 opacity-75">{nextDecisionLabel(selected).detail}</div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => openOfficialReview(selected)} className="inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-black text-slate-950 transition hover:bg-cyan-400"><FileText size={16} /> مراجعة واعتماد التقييم</button>
                  {selected.actions.followup ? <button type="button" onClick={() => openFollowup(selected)} className="rounded-xl border border-emerald-700/60 bg-emerald-950/30 px-3 py-2.5 text-xs font-black text-emerald-100 transition hover:bg-emerald-900/40">فتح متابعة العميل</button> : null}
                  {selected.actions.customerRequest ? <button type="button" onClick={() => openCustomerRequest(selected)} className="rounded-xl border border-amber-700/60 bg-amber-950/30 px-3 py-2.5 text-xs font-black text-amber-100 transition hover:bg-amber-900/30">تسجيل الطلب المطلوب</button> : null}
                </div>
              </div>
              <div className="mt-2 text-[9px] text-slate-600">التحليل يساعد على القرار؛ النقاط والحفظ الرسمي لا يتمان قبل الاعتماد البشري.</div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
