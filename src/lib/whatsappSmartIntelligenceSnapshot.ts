// SmartIntelligenceSnapshotV1 — عقد الخرج الموحّد الوحيد من طبقة "التحليل الذكي الإضافي"
// (journey/saleState/burst-effort/branch-hint/customer/purchase-history/best-message signals)
// للنظام الأساسي. قراءة فقط، JSON قابل للتسلسل بالكامل، مصمَّم عشان يتحط كـحقل إضافي جوه
// ConversationReviewSnapshot.smartIntelligence (نفس raw_scores.conversation_snapshot
// الموجود بالفعل) — مفيش أي جدول أو مسار كتابة جديد؛ بيتحفظ بس لما المراجع البشري يحفظ
// التقييم الرسمي من خلال المسار الموجود أصلًا (Reviews.tsx).
//
// بعض الحقول لسه null/[] لأن الـwiring بتاعها مش جزء من الخطوات المنفذة دلوقتي (customer
// resolution، purchase history، best-message aggregation مش متوصلين لصفحة الـWatcher بعد؛
// branch hint hierarchy جاهزة كـutility مستقلة في whatsappConversationBranchHint.ts بس
// مش متربطة هنا لسه) — اتسابوا بالـtype الصحيح مش أي/unknown، عشان الملء لاحقًا يبقى
// إضافة قيمة مش تغيير type.
import type { ConversationJourneyResult } from './whatsappConversationJourneyClassifier';
import type { StaffMessageEffort } from './whatsappOutboundMessageBursts';
import type { UnifiedInvoiceVerification } from './whatsappUnifiedIntelligenceV4';
import type { BranchHintResult } from './whatsappConversationBranchHint';
import type { WhatsAppResolvedCustomer } from './whatsappCustomerResolverV4';
import type { BestMessageAggregate } from './whatsappMessageTemplateNormalization';
import { WHATSAPP_OPERATIONAL_ENGINE_VERSION } from './whatsappOperationalEngineVersion';
import type { SmartConversationEvaluationV2 } from './whatsappConversationEvaluationV2';
import type { ConversationTimingV28 } from './whatsappConversationTimingV28';
import type { DelayAttributionV29 } from './whatsappDelayAttributionV29';

export interface SmartIntelligenceCustomerPurchaseHistory {
  totalPurchases: number | null;
  totalSpent: number | null;
  avgMonthly: number | null;
  lastPurchaseAt: string | null;
}

export interface SmartIntelligenceSnapshotV1 {
  version: 'smart-intelligence-snapshot-v1';
  generatedAt: string;
  journey: ConversationJourneyResult;
  staffEffort: StaffMessageEffort[];
  invoiceVerification: UnifiedInvoiceVerification;
  /** مش متربط بعد — customer resolution wiring في صفحة الـWatcher لسه مش جزء من الخطوات المنفذة. */
  customer: WhatsAppResolvedCustomer | null;
  /** مش متربط بعد — نفس السبب. */
  purchaseHistory: SmartIntelligenceCustomerPurchaseHistory | null;
  /** الـhierarchy جاهزة (whatsappConversationBranchHint.ts) بس مش متربطة بالـsnapshot لسه. */
  branchHint: BranchHintResult | null;
  /** template-effectiveness aggregation لسه مش متربطة بصفحة الـWatcher. */
  bestMessageSignals: BestMessageAggregate[];
  /** تقييم الرحلة الكامل V2: بيع/افتتاح/ختام/اكتمال الأوردر/الفرص/المتابعات/المحاور. */
  evaluationV2?: SmartConversationEvaluationV2 | null;
  /** توقيت الرحلة V28 بالكامل: turns، handoff، ومراحل الأوردر عبر الجلسات المدمجة. */
  timingV28?: ConversationTimingV28 | null;
  /** نفس محرك التوقيت لكن على Scope الموظف الحالي فقط، لمنع تحميله تأخير موظف آخر. */
  staffTimingV28?: ConversationTimingV28 | null;
  /** تفسير سبب التأخير على مستوى الـCase بدون خصم تلقائي على الموظف. */
  delayAttributionV29?: DelayAttributionV29 | null;
  evidence: {
    engineVersions: Record<string, string>;
  };
}

export function buildSmartIntelligenceSnapshotV1(args: {
  journey: ConversationJourneyResult;
  staffEffort: StaffMessageEffort[];
  invoiceVerification: UnifiedInvoiceVerification;
  customer?: WhatsAppResolvedCustomer | null;
  purchaseHistory?: SmartIntelligenceCustomerPurchaseHistory | null;
  branchHint?: BranchHintResult | null;
  bestMessageSignals?: BestMessageAggregate[];
  evaluationV2?: SmartConversationEvaluationV2 | null;
  timingV28?: ConversationTimingV28 | null;
  staffTimingV28?: ConversationTimingV28 | null;
  delayAttributionV29?: DelayAttributionV29 | null;
}): SmartIntelligenceSnapshotV1 {
  return {
    version: 'smart-intelligence-snapshot-v1',
    generatedAt: new Date().toISOString(),
    journey: args.journey,
    staffEffort: args.staffEffort,
    invoiceVerification: args.invoiceVerification,
    customer: args.customer ?? null,
    purchaseHistory: args.purchaseHistory ?? null,
    branchHint: args.branchHint ?? null,
    bestMessageSignals: args.bestMessageSignals ?? [],
    evaluationV2: args.evaluationV2 ?? null,
    timingV28: args.timingV28 ?? null,
    staffTimingV28: args.staffTimingV28 ?? null,
    delayAttributionV29: args.delayAttributionV29 ?? null,
    evidence: {
      engineVersions: {
        v6: WHATSAPP_OPERATIONAL_ENGINE_VERSION,
        v15: 'whatsapp-participant-role-v15',
        v4: 'whatsapp-unified-intelligence-v4',
      },
    },
  };
}
