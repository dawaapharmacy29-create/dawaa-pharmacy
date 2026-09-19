import type { ConversationJourneyResult } from './conversationJourneyClassifier';
import type { StaffMessageEffort } from './outboundMessageBursts';
import type { BestMessageAggregate } from './messageTemplateNormalization';
import type { UnifiedInvoiceVerification } from '@/lib/whatsappUnifiedIntelligenceV4';
import type { BranchHintResult } from '@/lib/whatsappConversationBranchHint';
import type { WhatsAppResolvedCustomer } from '@/lib/whatsappCustomerResolverV4';
import { WHATSAPP_OPERATIONAL_ENGINE_VERSION } from '@/lib/whatsappOperationalEngineVersion';

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
  customer: WhatsAppResolvedCustomer | null;
  purchaseHistory: SmartIntelligenceCustomerPurchaseHistory | null;
  branchHint: BranchHintResult | null;
  bestMessageSignals: BestMessageAggregate[];
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
    evidence: {
      engineVersions: {
        v6: WHATSAPP_OPERATIONAL_ENGINE_VERSION,
        v15: 'whatsapp-participant-role-v15',
        v4: 'whatsapp-unified-intelligence-v4',
      },
    },
  };
}
