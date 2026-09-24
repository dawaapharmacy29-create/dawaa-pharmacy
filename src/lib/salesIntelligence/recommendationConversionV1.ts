import type { WhatsAppConversationSession } from '@/lib/whatsappConversationParser';
import type {
  WhatsAppProductJourneySummaryV7,
  WhatsAppProductJourneyV7,
} from '@/lib/whatsappProductJourneyV7';

export type RecommendationInvoiceEvidenceLevel =
  | 'official'
  | 'candidate'
  | 'unavailable';

export type RecommendationConversionStatus =
  | 'official_sale'
  | 'candidate_invoice_match'
  | 'accepted_waiting_official_invoice'
  | 'recommended_not_accepted'
  | 'rejected'
  | 'ambiguous_recommender'
  | 'product_identity_unresolved';

export interface RecommendationInvoiceLineV1 {
  productId: string | null;
  productCode: string | null;
  productName: string;
  quantity: number | null;
  netLineAmount: number | null;
  staffId: string | null;
  staffName: string | null;
}

export interface RecommendationConversionFactV1 {
  productId: string | null;
  productCode: string | null;
  productName: string;
  recommenderName: string | null;
  recommendationMessageIds: string[];
  acceptedInChat: boolean;
  rejectedInChat: boolean;
  invoiceEvidenceLevel: RecommendationInvoiceEvidenceLevel;
  invoiceContainsProduct: boolean;
  officialSaleFromRecommendation: boolean;
  soldQuantity: number | null;
  soldNetValue: number | null;
  invoiceStaffName: string | null;
  conversionStatus: RecommendationConversionStatus;
  needsHumanReview: boolean;
}

function journeyRecommendationEvent(journey: WhatsAppProductJourneyV7) {
  return (
    journey.events.find((event) => event.stage === 'recommended') ??
    journey.events.find((event) => event.stage === 'alternative_offered') ??
    null
  );
}

function sameProduct(
  journey: WhatsAppProductJourneyV7,
  line: RecommendationInvoiceLineV1
) {
  if (journey.productId && line.productId) {
    return journey.productId === line.productId;
  }
  if (journey.productCode && line.productCode) {
    return journey.productCode === line.productCode;
  }
  return false;
}

export function deriveRecommendationConversionFactsV1(input: {
  session: WhatsAppConversationSession;
  journeySummary: WhatsAppProductJourneySummaryV7;
  invoiceLines: RecommendationInvoiceLineV1[];
  invoiceEvidenceLevel: RecommendationInvoiceEvidenceLevel;
}): RecommendationConversionFactV1[] {
  const messagesById = new Map(input.session.messages.map((message) => [message.id, message]));

  return input.journeySummary.journeys
    .map((journey) => {
      const recommendationEvent = journeyRecommendationEvent(journey);
      if (!recommendationEvent) return null;

      const recommenders = Array.from(
        new Set(
          recommendationEvent.messageIds
            .map((id) => messagesById.get(id))
            .filter((message) => message?.direction === 'outbound')
            .map((message) => String(message?.sender || '').trim())
            .filter(Boolean)
        )
      );
      const recommenderName = recommenders.length === 1 ? recommenders[0] : null;
      const acceptedInChat = journey.events.some((event) => event.stage === 'accepted');
      const rejectedInChat = journey.events.some((event) => event.stage === 'rejected');

      const matchingLines = input.invoiceLines.filter(
        (line) =>
          sameProduct(journey, line) &&
          line.quantity != null &&
          Number(line.quantity) > 0 &&
          line.netLineAmount != null &&
          Number(line.netLineAmount) > 0
      );
      const invoiceContainsProduct = matchingLines.length > 0;
      const soldQuantity = invoiceContainsProduct
        ? matchingLines.reduce((sum, line) => sum + (Number(line.quantity) || 0), 0)
        : null;
      const soldNetValue = invoiceContainsProduct
        ? matchingLines.reduce((sum, line) => sum + (Number(line.netLineAmount) || 0), 0)
        : null;
      const invoiceStaffNames = Array.from(
        new Set(matchingLines.map((line) => String(line.staffName || '').trim()).filter(Boolean))
      );
      const invoiceStaffName = invoiceStaffNames.length === 1 ? invoiceStaffNames[0] : null;

      let conversionStatus: RecommendationConversionStatus;
      let needsHumanReview = false;

      if (!journey.productId && !journey.productCode) {
        conversionStatus = 'product_identity_unresolved';
        needsHumanReview = true;
      } else if (recommenders.length !== 1) {
        conversionStatus = 'ambiguous_recommender';
        needsHumanReview = true;
      } else if (rejectedInChat) {
        conversionStatus = 'rejected';
      } else if (
        input.invoiceEvidenceLevel === 'official' &&
        invoiceContainsProduct
      ) {
        conversionStatus = 'official_sale';
      } else if (
        input.invoiceEvidenceLevel === 'candidate' &&
        invoiceContainsProduct
      ) {
        conversionStatus = 'candidate_invoice_match';
        needsHumanReview = true;
      } else if (acceptedInChat) {
        conversionStatus = 'accepted_waiting_official_invoice';
      } else {
        conversionStatus = 'recommended_not_accepted';
      }

      return {
        productId: journey.productId,
        productCode: journey.productCode,
        productName: journey.productName,
        recommenderName,
        recommendationMessageIds: recommendationEvent.messageIds,
        acceptedInChat,
        rejectedInChat,
        invoiceEvidenceLevel: input.invoiceEvidenceLevel,
        invoiceContainsProduct,
        officialSaleFromRecommendation:
          conversionStatus === 'official_sale',
        soldQuantity,
        soldNetValue,
        invoiceStaffName,
        conversionStatus,
        needsHumanReview,
      } satisfies RecommendationConversionFactV1;
    })
    .filter((fact): fact is RecommendationConversionFactV1 => Boolean(fact));
}


export interface PersistedParticipantRoleMessageV1 {
  messageId: string;
  role: string | null;
  staffName: string | null;
  staffId?: string | null;
}

export function derivePersistedRecommendationConversionFactsV1(input: {
  journeySummary: WhatsAppProductJourneySummaryV7 | null | undefined;
  participantMessages: PersistedParticipantRoleMessageV1[];
  invoiceLines: RecommendationInvoiceLineV1[];
  invoiceEvidenceLevel: RecommendationInvoiceEvidenceLevel;
}): RecommendationConversionFactV1[] {
  if (!input.journeySummary?.journeys?.length) return [];

  const roleByMessageId = new Map(
    input.participantMessages.map((row) => [row.messageId, row])
  );

  return input.journeySummary.journeys
    .map((journey) => {
      const recommendationEvent = journeyRecommendationEvent(journey);
      if (!recommendationEvent) return null;

      const recommenders = Array.from(
        new Set(
          recommendationEvent.messageIds
            .map((id) => roleByMessageId.get(id))
            .filter((row) => row?.role === 'pharmacist' || row?.role === 'staff')
            .map((row) => String(row?.staffName || '').trim())
            .filter(Boolean)
        )
      );
      const recommenderName = recommenders.length === 1 ? recommenders[0] : null;
      const acceptedInChat = journey.events.some((event) => event.stage === 'accepted');
      const rejectedInChat = journey.events.some((event) => event.stage === 'rejected');

      const matchingLines = input.invoiceLines.filter(
        (line) =>
          sameProduct(journey, line) &&
          line.quantity != null &&
          Number(line.quantity) > 0 &&
          line.netLineAmount != null &&
          Number(line.netLineAmount) > 0
      );
      const invoiceContainsProduct = matchingLines.length > 0;
      const soldQuantity = invoiceContainsProduct
        ? matchingLines.reduce((sum, line) => sum + (Number(line.quantity) || 0), 0)
        : null;
      const soldNetValue = invoiceContainsProduct
        ? matchingLines.reduce((sum, line) => sum + (Number(line.netLineAmount) || 0), 0)
        : null;
      const invoiceStaffNames = Array.from(
        new Set(matchingLines.map((line) => String(line.staffName || '').trim()).filter(Boolean))
      );
      const invoiceStaffName = invoiceStaffNames.length === 1 ? invoiceStaffNames[0] : null;

      let conversionStatus: RecommendationConversionStatus;
      let needsHumanReview = false;

      if (!journey.productId && !journey.productCode) {
        conversionStatus = 'product_identity_unresolved';
        needsHumanReview = true;
      } else if (recommenders.length !== 1) {
        conversionStatus = 'ambiguous_recommender';
        needsHumanReview = true;
      } else if (rejectedInChat) {
        conversionStatus = 'rejected';
      } else if (input.invoiceEvidenceLevel === 'official' && invoiceContainsProduct) {
        conversionStatus = 'official_sale';
      } else if (input.invoiceEvidenceLevel === 'candidate' && invoiceContainsProduct) {
        conversionStatus = 'candidate_invoice_match';
        needsHumanReview = true;
      } else if (acceptedInChat) {
        conversionStatus = 'accepted_waiting_official_invoice';
      } else {
        conversionStatus = 'recommended_not_accepted';
      }

      return {
        productId: journey.productId,
        productCode: journey.productCode,
        productName: journey.productName,
        recommenderName,
        recommendationMessageIds: recommendationEvent.messageIds,
        acceptedInChat,
        rejectedInChat,
        invoiceEvidenceLevel: input.invoiceEvidenceLevel,
        invoiceContainsProduct,
        officialSaleFromRecommendation: conversionStatus === 'official_sale',
        soldQuantity,
        soldNetValue,
        invoiceStaffName,
        conversionStatus,
        needsHumanReview,
      } satisfies RecommendationConversionFactV1;
    })
    .filter((fact): fact is RecommendationConversionFactV1 => Boolean(fact));
}
