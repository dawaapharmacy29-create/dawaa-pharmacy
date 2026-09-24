import { supabase } from '@/lib/supabase';
import { readWhatsAppExportFile } from '@/lib/whatsappExportFileReader';
import {
  parseWhatsAppExport,
  splitWhatsAppSessions,
  type WhatsAppConversationSession,
} from '@/lib/whatsappConversationParser';
import { buildSmartConversationReviewSummary } from '@/lib/whatsappSmartReviewSummary';
import {
  detectFollowupSignals,
  type DetectedFollowupSignal,
} from '@/lib/whatsappFollowupSignalDetector';
import {
  attachInvoiceVerificationToQueue,
  hashWhatsAppSession,
} from '@/lib/whatsappReviewPersistenceV4';
import { buildUnifiedConversationIntelligence, verifySessionAgainstInvoices } from '@/lib/whatsappUnifiedIntelligenceV4';
import {
  buildWhatsAppOperationalIntelligenceV6,
  enrichWhatsAppOperationalProductsV6,
  syncWhatsAppOperationalActionsV6,
} from '@/lib/whatsappOperationalIntelligenceV6';
import { enrichWhatsAppOperationalJourneysV7 } from '@/lib/whatsappProductJourneyV7';
import { syncWhatsAppEvidenceLedgerV17 } from '@/lib/whatsappEvidenceLedgerV17';
import { persistAutomaticWhatsAppReview } from '@/lib/whatsappAutomaticReviewPersistence';
import { getCycleForDate } from '@/lib/pharmacy-cycle';

type CustomerIdentity = {
  customerId: string | null;
  customerCode: string | null;
  customerName: string | null;
  customerPhone: string | null;
  branch: string | null;
  matchedBy: 'phone' | 'name' | 'none';
};

type CustomerRow = {
  id: string;
  customer_code: string | null;
  display_name: string | null;
  name: string | null;
  customer_name: string | null;
  normalized_phone: string | null;
  phone: string | null;
  customer_phone: string | null;
  whatsapp_phone: string | null;
  mobile: string | null;
  whatsapp: string | null;
  phone_alt: string | null;
  effective_branch: string | null;
  branch: string | null;
};

export interface IngestOneFileResult {
  fileName: string;
  sessionsFound: number;
  sessionsSaved: number;
  sessionsDuplicate: number;
  customersMatched: number;
  followupsCreated: number;
  followupsDuplicate: number;
  invoicesVerified: number;
  invoicesProbable: number;
  invoicesNotFound: number;
  invoiceChecksSkipped: number;
  autoReviewsCreated: number;
  autoReviewsSkipped: number;
  autoReviewsPointsFailed: number;
  errors: string[];
}

const CUSTOMER_SELECT = [
  'id',
  'customer_code',
  'display_name',
  'name',
  'customer_name',
  'normalized_phone',
  'phone',
  'customer_phone',
  'whatsapp_phone',
  'mobile',
  'whatsapp',
  'phone_alt',
  'effective_branch',
  'branch',
].join(',');

function normalizeDigits(value: string) {
  return value
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[^\d]/g, '');
}

function normalizeEgyptPhone(value: unknown) {
  let digits = normalizeDigits(String(value ?? ''));
  if (digits.startsWith('0020')) digits = `0${digits.slice(4)}`;
  else if (/^20[1]\d{9}$/.test(digits)) digits = `0${digits.slice(2)}`;
  if (/^01\d{9}$/.test(digits)) return digits;
  return null;
}

function phoneFromSession(session: WhatsAppConversationSession) {
  const candidates = [
    session.customerName,
    ...session.messages
      .filter((message) => message.direction === 'inbound')
      .map((message) => message.sender),
  ];
  for (const candidate of candidates) {
    const phone = normalizeEgyptPhone(candidate);
    if (phone) return phone;
  }
  return null;
}

function normalizedName(value: unknown) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function customerCodeFromSession(session: WhatsAppConversationSession) {
  const candidates = [
    session.customerName,
    ...session.messages.filter((message) => message.direction === 'inbound').map((message) => message.sender),
  ];
  for (const candidate of candidates) {
    const raw = String(candidate ?? '')
      .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
      .trim();
    const match = raw.match(/(?:^|[^0-9])(\d{2,9})\s*\)?\s*$/);
    if (!match) continue;
    const digits = match[1];
    if (digits.length >= 10 || /^01[0125]\d{8}$/.test(digits)) continue;
    return digits.replace(/\.0+$/, '');
  }
  return null;
}

function customerDisplayNameWithoutCode(value: unknown) {
  return normalizedName(String(value ?? '').replace(/[٠-٩0-9]{2,9}\s*\)?\s*$/, '')) || null;
}

function mapCustomerIdentity(
  row: CustomerRow,
  fallbackName: string | null,
  fallbackPhone: string | null,
  matchedBy: 'phone' | 'name'
): CustomerIdentity {
  return {
    customerId: row.id,
    customerCode: row.customer_code,
    customerName: row.display_name || row.name || row.customer_name || fallbackName,
    customerPhone:
      normalizeEgyptPhone(row.normalized_phone) ||
      normalizeEgyptPhone(row.phone) ||
      normalizeEgyptPhone(row.customer_phone) ||
      normalizeEgyptPhone(row.whatsapp_phone) ||
      normalizeEgyptPhone(row.mobile) ||
      normalizeEgyptPhone(row.whatsapp) ||
      normalizeEgyptPhone(row.phone_alt) ||
      fallbackPhone,
    branch: row.effective_branch || row.branch || null,
    matchedBy,
  };
}

async function resolveCustomerIdentity(
  session: WhatsAppConversationSession
): Promise<CustomerIdentity> {
  const rawFallbackName = normalizedName(session.customerName) || null;
  const code = customerCodeFromSession(session);
  const fallbackName = customerDisplayNameWithoutCode(rawFallbackName) || rawFallbackName;
  const phone = phoneFromSession(session);

  if (phone) {
    const phoneTail = phone.slice(-10);
    const { data, error } = await supabase
      .from('customers')
      .select(CUSTOMER_SELECT)
      .eq('is_duplicate', false)
      .or(
        [
          `normalized_phone.eq.${phone}`,
          `normalized_phone.ilike.%${phoneTail}`,
          `phone.eq.${phone}`,
          `customer_phone.eq.${phone}`,
          `whatsapp_phone.eq.${phone}`,
          `mobile.eq.${phone}`,
          `whatsapp.eq.${phone}`,
          `phone_alt.eq.${phone}`,
        ].join(',')
      )
      .limit(3);
    if (error) throw error;
    const matches = (data || []) as CustomerRow[];
    if (matches.length === 1) return mapCustomerIdentity(matches[0], fallbackName, phone, 'phone');
  }

  if (code) {
    const { data, error } = await supabase
      .from('customers')
      .select(CUSTOMER_SELECT)
      .eq('is_duplicate', false)
      .eq('customer_code', code)
      .limit(3);
    if (error) throw error;
    let matches = (data || []) as CustomerRow[];
    if (matches.length > 1 && fallbackName) {
      const normalizedFallback = normalizedName(fallbackName).toLowerCase();
      const nameMatches = matches.filter((row) =>
        [row.display_name, row.name, row.customer_name]
          .map((value) => normalizedName(value).toLowerCase())
          .some((value) => value && (value.includes(normalizedFallback) || normalizedFallback.includes(value)))
      );
      if (nameMatches.length === 1) matches = nameMatches;
    }
    if (matches.length === 1) return mapCustomerIdentity(matches[0], fallbackName, phone, 'name');
  }

  if (fallbackName && fallbackName.length >= 3) {
    for (const column of ['display_name', 'name', 'customer_name'] as const) {
      const { data, error } = await supabase
        .from('customers')
        .select(CUSTOMER_SELECT)
        .eq('is_duplicate', false)
        .ilike(column, fallbackName)
        .limit(2);
      if (error) throw error;
      const matches = (data || []) as CustomerRow[];
      if (matches.length === 1) return mapCustomerIdentity(matches[0], fallbackName, phone, 'name');
      if (matches.length > 1) break;
    }
  }

  return {
    customerId: null,
    customerCode: null,
    customerName: fallbackName,
    customerPhone: phone,
    branch: null,
    matchedBy: 'none',
  };
}

async function saveSessionReview(
  session: WhatsAppConversationSession,
  sourceFileName: string,
  innerFileName: string | null,
  identity: CustomerIdentity
) {
  const sourceHash = await hashWhatsAppSession(session);
  const { data: existing, error: existingError } = await supabase
    .from('whatsapp_review_sources')
    .select('id')
    .eq('source_hash', sourceHash)
    .maybeSingle();
  if (existingError && existingError.code !== 'PGRST116') throw existingError;
  if (existing?.id) return { sourceId: String(existing.id), duplicate: true as const };

  const summary = buildSmartConversationReviewSummary(session);
  const staffName = session.outboundStaffNames[0] || null;

  const { data, error } = await supabase
    .from('whatsapp_review_sources')
    .insert({
      source_hash: sourceHash,
      source_type: 'whatsapp_export_auto',
      source_filename: sourceFileName,
      inner_filename: innerFileName,
      branch: identity.branch,
      customer_id: identity.customerId,
      customer_code: identity.customerCode,
      customer_name: identity.customerName || session.customerName,
      customer_phone: identity.customerPhone,
      staff_name: staffName,
      conversation_started_at: session.startedAt.toISOString(),
      conversation_ended_at: session.endedAt.toISOString(),
      message_count: session.messages.length,
      parser_version: 'whatsapp-auto-ingest-v3',
      analysis_version: 'smart-summary-v1',
      analysis_status: 'analyzed',
      review_status: summary.confidence < 60 ? 'needs_context' : 'ready_quick',
      priority: summary.outcome === 'sale_intent' ? 'important' : 'normal',
      analysis_confidence: summary.confidence,
      commercial_eligible: summary.outcome === 'sale_intent',
      followup_required: summary.flags.length > 0,
      suggested_followup_reason: summary.flags.join('، ') || null,
      analysis_json: {
        ...JSON.parse(JSON.stringify(summary)),
        customerIdentity: {
          matchedBy: identity.matchedBy,
          customerId: identity.customerId,
          customerCode: identity.customerCode,
          customerPhone: identity.customerPhone,
          branch: identity.branch,
        },
      },
    })
    .select('id')
    .single();
  if (error) {
    if (error.code === '23505') {
      const { data: duplicate, error: duplicateError } = await supabase
        .from('whatsapp_review_sources')
        .select('id')
        .eq('source_hash', sourceHash)
        .single();
      if (duplicateError) throw duplicateError;
      return { sourceId: String(duplicate.id), duplicate: true as const };
    }
    throw error;
  }
  return { sourceId: String(data.id), duplicate: false as const, summary };
}

async function verifySessionSale(
  session: WhatsAppConversationSession,
  sourceId: string,
  identity: CustomerIdentity
) {
  const verification = await verifySessionAgainstInvoices(session, {
    customerId: identity.customerId,
    customerCode: identity.customerCode,
    customerPhone: identity.customerPhone,
    customerName: identity.customerName,
    branch: identity.branch,
  });
  await attachInvoiceVerificationToQueue(sourceId, verification);
  return verification.status;
}

function followupKey(
  signalType: string,
  evidenceTimestamp: string | Date | null,
  evidenceQuote: string
) {
  const timestamp = evidenceTimestamp
    ? (evidenceTimestamp instanceof Date
        ? evidenceTimestamp
        : new Date(evidenceTimestamp)
      ).toISOString()
    : '';
  return `${signalType}|${timestamp}|${String(evidenceQuote || '')
    .replace(/\s+/g, ' ')
    .trim()}`;
}

async function saveFollowupSignals(
  session: WhatsAppConversationSession,
  sourceFileName: string,
  identity: CustomerIdentity
) {
  const signals = detectFollowupSignals(session);
  if (!signals.length) return { created: 0, duplicate: 0 };

  const { data: existing, error: existingError } = await supabase
    .from('whatsapp_auto_followup_requests')
    .select('signal_type,evidence_timestamp,evidence_quote')
    .eq('conversation_session_id', session.id);
  if (existingError) throw existingError;

  const existingKeys = new Set(
    (existing || []).map((row) =>
      followupKey(
        String(row.signal_type || ''),
        row.evidence_timestamp ? String(row.evidence_timestamp) : null,
        String(row.evidence_quote || '')
      )
    )
  );

  const freshSignals: DetectedFollowupSignal[] = [];
  let duplicate = 0;
  for (const signal of signals) {
    const key = followupKey(signal.signalType, signal.evidenceTimestamp, signal.evidenceQuote);
    if (existingKeys.has(key)) {
      duplicate += 1;
      continue;
    }
    existingKeys.add(key);
    freshSignals.push(signal);
  }

  if (!freshSignals.length) return { created: 0, duplicate };

  const rows = freshSignals.map((signal) => ({
    source_file_name: sourceFileName,
    conversation_session_id: session.id,
    branch: identity.branch,
    doctor_name: session.outboundStaffNames[0] || null,
    customer_name: identity.customerName || session.customerName || 'غير معروف',
    customer_phone: identity.customerPhone,
    signal_type: signal.signalType,
    signal_type_label: signal.signalTypeLabel,
    evidence_quote: signal.evidenceQuote,
    evidence_timestamp: signal.evidenceTimestamp.toISOString(),
    requested_product_name: signal.requestedProductName || null,
    alternative_offered: signal.alternativeOffered ?? null,
    alternative_product_name: signal.alternativeProductName || null,
    ai_confidence: signal.confidence,
    status: 'جديد',
  }));

  const { error } = await supabase.from('whatsapp_auto_followup_requests').insert(rows);
  if (error) {
    if (error.code === '23505') return { created: 0, duplicate: duplicate + rows.length };
    throw error;
  }
  return { created: rows.length, duplicate };
}

async function persistOperationalJourneyIntelligence(
  session: WhatsAppConversationSession,
  sourceId: string,
  identity: CustomerIdentity
) {
  const base = buildUnifiedConversationIntelligence(session);
  const initial = buildWhatsAppOperationalIntelligenceV6(session, base);
  const productResolved = await enrichWhatsAppOperationalProductsV6(initial);
  const operational = enrichWhatsAppOperationalJourneysV7(session, productResolved);

  const { data: sourceRow, error: sourceReadError } = await supabase
    .from('whatsapp_review_sources')
    .select('analysis_json,analysis_version,staff_id,staff_name,created_by')
    .eq('id', sourceId)
    .single();
  if (sourceReadError) throw sourceReadError;

  const nextAnalysis = {
    ...(sourceRow?.analysis_json || {}),
    operational: JSON.parse(JSON.stringify(operational)),
    productDemandVersion: 'product-demand-v22.1',
  };
  const { error: sourceUpdateError } = await supabase
    .from('whatsapp_review_sources')
    .update({
      analysis_json: nextAnalysis,
      updated_at: new Date().toISOString(),
    })
    .eq('id', sourceId);
  if (sourceUpdateError) throw sourceUpdateError;

  await syncWhatsAppOperationalActionsV6(operational, {
    sourceId,
    branch: identity.branch,
    customerId: identity.customerId,
    customerCode: identity.customerCode,
    customerName: identity.customerName,
    customerPhone: identity.customerPhone,
    staffId: sourceRow?.staff_id || null,
    staffName: sourceRow?.staff_name || session.outboundStaffNames[0] || null,
    createdBy: sourceRow?.created_by || null,
  });

  await syncWhatsAppEvidenceLedgerV17(session, {
    sourceId,
    operational,
    analysisVersion: 'product-demand-v22.1',
    participantRoles: nextAnalysis.participantRoles,
  });

  return operational;
}

export async function ingestWhatsAppExportFile(file: File): Promise<IngestOneFileResult> {
  const result: IngestOneFileResult = {
    fileName: file.name,
    sessionsFound: 0,
    sessionsSaved: 0,
    sessionsDuplicate: 0,
    customersMatched: 0,
    followupsCreated: 0,
    followupsDuplicate: 0,
    invoicesVerified: 0,
    invoicesProbable: 0,
    invoicesNotFound: 0,
    invoiceChecksSkipped: 0,
    autoReviewsCreated: 0,
    autoReviewsSkipped: 0,
    autoReviewsPointsFailed: 0,
    errors: [],
  };

  const source = await readWhatsAppExportFile(file);
  const messages = parseWhatsAppExport(source.text);
  if (!messages.length) {
    result.errors.push('لم يتم التعرف على رسائل WhatsApp داخل الملف.');
    return result;
  }

  const sessions = splitWhatsAppSessions(messages, 120);
  result.sessionsFound = sessions.length;

  for (const session of sessions) {
    try {
      const identity = await resolveCustomerIdentity(session);
      if (identity.matchedBy !== 'none') result.customersMatched += 1;

      const saved = await saveSessionReview(
        session,
        source.sourceFileName,
        source.innerFileName || null,
        identity
      );
      if (saved.duplicate) result.sessionsDuplicate += 1;
      else result.sessionsSaved += 1;

      if (!saved.duplicate) {
        try {
          const autoReview = await persistAutomaticWhatsAppReview({
            sourceId: saved.sourceId,
            session,
            branch: identity.branch,
            customerId: identity.customerId,
            customerCode: identity.customerCode,
            customerName: identity.customerName,
            customerPhone: identity.customerPhone,
            staffName: session.outboundStaffNames[0] || null,
            reviewCycle: getCycleForDate(session.startedAt),
          });
          if (autoReview.status === 'saved') {
            result.autoReviewsCreated += 1;
            if (autoReview.pointsError) {
              result.autoReviewsPointsFailed += 1;
              result.errors.push(
                `تقييم آلي رقم ${autoReview.reviewId}: تم حفظ التقييم لكن ربط النقاط فشل: ${autoReview.pointsError}`
              );
            }
          } else if (autoReview.status === 'failed') {
            result.errors.push(`تعذر إنشاء تقييم آلي لجلسة ${saved.sourceId}: ${autoReview.error}`);
          } else {
            result.autoReviewsSkipped += 1;
          }
        } catch (autoReviewError) {
          result.errors.push(
            autoReviewError instanceof Error
              ? `تقييم آلي: ${autoReviewError.message}`
              : 'خطأ غير معروف أثناء التقييم الآلي للمحادثة'
          );
        }
      }

      const invoiceStatus = await verifySessionSale(session, saved.sourceId, identity);
      if (invoiceStatus === 'verified') result.invoicesVerified += 1;
      else if (invoiceStatus === 'probable' || invoiceStatus === 'needs_review')
        result.invoicesProbable += 1;
      else if (invoiceStatus === 'not_found') result.invoicesNotFound += 1;
      else result.invoiceChecksSkipped += 1;

      try {
        await persistOperationalJourneyIntelligence(session, saved.sourceId, identity);
      } catch (operationalError) {
        result.errors.push(
          operationalError instanceof Error
            ? `تحليل طلبات وأصناف واتساب: ${operationalError.message}`
            : 'تعذر تحديث تحليل طلبات وأصناف واتساب'
        );
      }

      const followups = await saveFollowupSignals(session, source.sourceFileName, identity);
      result.followupsCreated += followups.created;
      result.followupsDuplicate += followups.duplicate;
    } catch (e) {
      result.errors.push(e instanceof Error ? e.message : 'خطأ غير معروف أثناء معالجة جلسة محادثة');
    }
  }

  return result;
}
