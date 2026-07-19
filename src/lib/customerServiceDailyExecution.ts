import { supabase } from '@/lib/supabase';
import { normalizeBranchName } from '@/lib/branch';
import { createStaffNotification } from '@/lib/staffNotificationService';

export type DailyQueueCandidate = {
  key: string;
  source: string;
  customerId?: string | null;
  code?: string | null;
  name: string;
  phone?: string | null;
  branch: string;
  priority?: string | null;
  reason?: string | null;
  nextFollowupDate?: string | null;
  linkedFollowupId?: string | null;
  metadata?: Record<string, unknown>;
};

export type DailyQueueItem = DailyQueueCandidate & {
  id: string;
  queueDate: string;
  status: string;
  startedAt?: string | null;
  completedAt?: string | null;
};

const QUEUE_VERSION = 'canonical-customer-master-v4';
const text = (value: unknown) => String(value ?? '').trim();
const todayKey = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};
const normalizeKey = (value: unknown) =>
  text(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
const digits = (value: unknown) =>
  text(value)
    .replace(/\D/g, '')
    .replace(/^20(?=1\d{9}$)/, '');
const missingRelation = (message: string) =>
  /does not exist|schema cache|relation .* not found/i.test(message);
const sameBranch = (a: unknown, b: unknown) => normalizeBranchName(a) === normalizeBranchName(b);

function normalizedCustomerName(value: unknown) {
  return normalizeKey(value)
    .replace(/^(عميل|customer)(غيرمسجل|غيرمحدد|مجهول)?$/i, '')
    .replace(/^(بدوناسم|لايوجد|غيرمعروف|test|تجربه|تجربة)$/i, '');
}

function validCustomerPhone(value: unknown) {
  const phone = digits(value);
  return /^01[0125]\d{8}$/.test(phone) || /^1[0125]\d{8}$/.test(phone);
}

function qualityIssues(item: DailyQueueCandidate) {
  const issues: string[] = [];
  if (!normalizedCustomerName(item.name) || normalizedCustomerName(item.name).length < 3)
    issues.push('invalid_name');
  const code = normalizeKey(item.code);
  const hasCode = Boolean(code && !/^(0+|غيرمسجل|بدونكود|unknown|null)$/.test(code));
  if (!hasCode && !validCustomerPhone(item.phone)) issues.push('missing_identity');
  if (!sameBranch(item.branch, normalizeBranchName(item.branch))) issues.push('invalid_branch');
  return issues;
}

function isEligibleCustomer(item: DailyQueueCandidate) {
  return qualityIssues(item).length === 0;
}

function canonicalIdentity(item: DailyQueueCandidate) {
  const code = normalizeKey(item.code);
  if (code && !/^(0+|غيرمسجل|بدونكود|unknown|null)$/.test(code)) return `code:${code}`;
  const phone = digits(item.phone);
  if (validCustomerPhone(phone)) return `phone:${phone.slice(-11)}`;
  const customerId = normalizeKey(item.customerId);
  if (customerId) return `id:${customerId}`;
  return `name:${normalizedCustomerName(item.name)}:branch:${normalizeKey(normalizeBranchName(item.branch))}`;
}

function candidateScore(item: DailyQueueCandidate) {
  const source = text(item.source).toLowerCase();
  const priority = text(item.priority).toLowerCase();
  const reason = text(item.reason).toLowerCase();
  const scheduledToday = text(item.nextFollowupDate).slice(0, 10) === todayKey();
  let score = 0;
  if (source === 'doctor_request') score += 1000;
  if (scheduledToday) score += 900;
  if (/شكوى|complaint|manager|مدير|عاجل|urgent/.test(`${source} ${priority} ${reason}`))
    score += 800;
  if (/at_risk|مهدد|متوقف/.test(`${source} ${reason}`)) score += 600;
  if (/important|vip|مهم جدا|مهم جدًا/.test(`${source} ${priority} ${reason}`)) score += 450;
  if (/yesterday|امس|أمس|شراء/.test(`${source} ${reason}`)) score += 250;
  const metadataScore = Number(item.metadata?.smartScore ?? item.metadata?.smart_score ?? 0);
  if (Number.isFinite(metadataScore)) score += Math.min(500, metadataScore);
  return score;
}

function mapRow(row: Record<string, unknown>): DailyQueueItem {
  return {
    id: text(row.id),
    queueDate: text(row.queue_date),
    branch: text(row.branch),
    key: text(row.customer_key),
    customerId: text(row.customer_id) || null,
    code: text(row.customer_code) || null,
    name: text(row.customer_name) || 'عميل غير مسجل',
    phone: text(row.customer_phone) || null,
    source: text(row.source) || 'important',
    priority: text(row.priority) || 'مهم',
    reason: text(row.reason) || null,
    status: text(row.status) || 'not_started',
    linkedFollowupId: text(row.linked_followup_id) || null,
    nextFollowupDate: text(row.next_followup_date) || null,
    startedAt: text(row.started_at) || null,
    completedAt: text(row.completed_at) || null,
    metadata: (row.metadata && typeof row.metadata === 'object' ? row.metadata : {}) as Record<
      string,
      unknown
    >,
  };
}

async function recentCustomerKeys(branch: string, days = 7) {
  const start = new Date();
  start.setDate(start.getDate() - days);
  const startKey = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
  const { data, error } = await supabase
    .from('customer_service_daily_queue_items')
    .select(
      'customer_key,customer_id,customer_code,customer_phone,customer_name,branch,queue_date,next_followup_date,status'
    )
    .gte('queue_date', startKey)
    .lt('queue_date', todayKey())
    .limit(3000);
  if (error) {
    if (missingRelation(error.message)) return new Set<string>();
    throw error;
  }
  const today = todayKey();
  return new Set(
    (data || [])
      .map((row) => mapRow(row as Record<string, unknown>))
      .filter(
        (row) =>
          sameBranch(row.branch, branch) &&
          isEligibleCustomer(row) &&
          text(row.nextFollowupDate) !== today
      )
      .map((row) => canonicalIdentity(row))
      .filter(Boolean)
  );
}

export async function loadOrCreateDailyQueue(
  branch: string,
  candidates: DailyQueueCandidate[],
  actor?: { id?: string | null; name?: string | null }
): Promise<{ items: DailyQueueItem[]; persistent: boolean }> {
  const queueDate = todayKey();
  const targetBranch = normalizeBranchName(branch);
  const scopedCandidates = candidates.filter(
    (item) => sameBranch(item.branch, targetBranch) && isEligibleCustomer(item)
  );
  const current = await supabase
    .from('customer_service_daily_queue_items')
    .select('*')
    .eq('queue_date', queueDate)
    .order('created_at', { ascending: true })
    .limit(1000);
  if (current.error) {
    if (missingRelation(current.error.message))
      return {
        items: dedupeCandidates(scopedCandidates)
          .slice(0, 30)
          .map((item, index) => ({
            ...item,
            id: `fallback-${index}`,
            queueDate,
            status: 'not_started',
          })),
        persistent: false,
      };
    throw current.error;
  }

  const currentAll = (current.data || []).map((row) => mapRow(row as Record<string, unknown>));
  const currentScoped = currentAll.filter(
    (row) => sameBranch(row.branch, targetBranch) && isEligibleCustomer(row)
  );
  const pollutedScoped = currentAll.filter(
    (row) => sameBranch(row.branch, targetBranch) && !isEligibleCustomer(row)
  );
  const isCurrentVersion =
    currentScoped.length > 0 &&
    pollutedScoped.length === 0 &&
    currentScoped.every((row) => row.metadata?.queueVersion === QUEUE_VERSION);
  if (isCurrentVersion) {
    const existingKeys = new Set(currentScoped.map(canonicalIdentity));
    const mandatoryNew = dedupeCandidates(scopedCandidates)
      .filter((item) => {
        const scheduledToday = text(item.nextFollowupDate).slice(0, 10) === queueDate;
        return item.source === 'doctor_request' || scheduledToday || candidateScore(item) >= 700;
      })
      .filter((item) => !existingKeys.has(canonicalIdentity(item)))
      .map((item) => ({ ...item, key: canonicalIdentity(item), branch: targetBranch }));
    if (!mandatoryNew.length) return { items: dedupeRows(currentScoped), persistent: true };

    const additions = mandatoryNew.map((item) => ({
      queue_date: queueDate,
      branch: targetBranch,
      customer_key: item.key,
      customer_id: item.customerId || null,
      customer_code: item.code || null,
      customer_name: item.name,
      customer_phone: item.phone || null,
      source: item.source,
      priority: item.priority || 'مهم',
      reason: item.reason || null,
      status: 'not_started',
      linked_followup_id: item.linkedFollowupId || null,
      next_followup_date: item.nextFollowupDate ? item.nextFollowupDate.slice(0, 10) : null,
      created_by: actor?.id || null,
      created_by_name: actor?.name || null,
      metadata: {
        ...(item.metadata || {}),
        queueVersion: QUEUE_VERSION,
        canonicalBranch: targetBranch,
        smartScore: candidateScore(item),
        qualityStatus: 'valid',
        customerMasterSource: 'dawaa_customer_metrics_app_view_v2',
        addedAfterQueueCreation: true,
      },
    }));
    const inserted = await supabase
      .from('customer_service_daily_queue_items')
      .upsert(additions, { onConflict: 'queue_date,branch,customer_key' })
      .select('*');
    if (inserted.error) throw inserted.error;
    const insertedRows = (inserted.data || []).map((row) => mapRow(row as Record<string, unknown>));
    return { items: dedupeRows([...currentScoped, ...insertedRows]), persistent: true };
  }

  const idsToRebuild = currentAll
    .filter((row) => sameBranch(row.branch, targetBranch))
    .map((row) => row.id)
    .filter(Boolean);
  if (idsToRebuild.length)
    await supabase.from('customer_service_daily_queue_items').delete().in('id', idsToRebuild);

  const recent = await recentCustomerKeys(targetBranch);
  const ranked = dedupeCandidates(scopedCandidates).sort(
    (a, b) => candidateScore(b) - candidateScore(a)
  );
  const selected: DailyQueueCandidate[] = [];
  for (const candidate of ranked) {
    const identity = canonicalIdentity(candidate);
    const scheduledToday = text(candidate.nextFollowupDate).slice(0, 10) === queueDate;
    const urgent =
      candidate.source === 'doctor_request' || scheduledToday || candidateScore(candidate) >= 700;
    if (!urgent && recent.has(identity)) continue;
    selected.push({ ...candidate, key: identity, branch: targetBranch });
    if (selected.length >= 30) break;
  }
  if (!selected.length) return { items: [], persistent: true };

  const payload = selected.map((item) => ({
    queue_date: queueDate,
    branch: targetBranch,
    customer_key: item.key,
    customer_id: item.customerId || null,
    customer_code: item.code || null,
    customer_name: item.name,
    customer_phone: item.phone || null,
    source: item.source,
    priority: item.priority || 'مهم',
    reason: item.reason || null,
    status: 'not_started',
    linked_followup_id: item.linkedFollowupId || null,
    next_followup_date: item.nextFollowupDate ? item.nextFollowupDate.slice(0, 10) : null,
    created_by: actor?.id || null,
    created_by_name: actor?.name || null,
    metadata: {
      ...(item.metadata || {}),
      queueVersion: QUEUE_VERSION,
      canonicalBranch: targetBranch,
      smartScore: candidateScore(item),
      qualityStatus: 'valid',
      customerMasterSource: 'dawaa_customer_metrics_app_view_v2',
    },
  }));
  const inserted = await supabase
    .from('customer_service_daily_queue_items')
    .upsert(payload, { onConflict: 'queue_date,branch,customer_key' })
    .select('*');
  if (inserted.error) throw inserted.error;
  return {
    items: dedupeRows(
      (inserted.data || [])
        .map((row) => mapRow(row as Record<string, unknown>))
        .filter(isEligibleCustomer)
    ),
    persistent: true,
  };
}

function dedupeCandidates(items: DailyQueueCandidate[]) {
  const map = new Map<string, DailyQueueCandidate>();
  for (const item of items) {
    if (!isEligibleCustomer(item)) continue;
    const identity = canonicalIdentity(item);
    const old = map.get(identity);
    if (!old || candidateScore(item) > candidateScore(old))
      map.set(identity, { ...item, key: identity });
  }
  return [...map.values()];
}

function dedupeRows(items: DailyQueueItem[]) {
  const map = new Map<string, DailyQueueItem>();
  for (const item of items) {
    if (!isEligibleCustomer(item)) continue;
    const identity = canonicalIdentity(item);
    const old = map.get(identity);
    if (!old || candidateScore(item) > candidateScore(old))
      map.set(identity, { ...item, key: identity });
  }
  return [...map.values()].sort((a, b) => candidateScore(b) - candidateScore(a));
}

export async function updateDailyQueueItem(
  id: string,
  patch: {
    status?: string;
    linkedFollowupId?: string | null;
    nextFollowupDate?: string | null;
    completed?: boolean;
    started?: boolean;
  }
) {
  if (!id || id.startsWith('fallback-')) return;
  const now = new Date().toISOString();
  const payload: Record<string, unknown> = { last_action_at: now };
  if (patch.status) payload.status = patch.status;
  if (patch.linkedFollowupId !== undefined) payload.linked_followup_id = patch.linkedFollowupId;
  if (patch.nextFollowupDate !== undefined)
    payload.next_followup_date = patch.nextFollowupDate
      ? patch.nextFollowupDate.slice(0, 10)
      : null;
  if (patch.started) payload.started_at = now;
  if (patch.completed) payload.completed_at = now;
  const { error } = await supabase
    .from('customer_service_daily_queue_items')
    .update(payload)
    .eq('id', id);
  if (error && !missingRelation(error.message)) throw error;
}

export async function appendFollowupEvent(input: {
  followupId?: string | null;
  queueItemId?: string | null;
  eventType: string;
  status?: string | null;
  actorStaffId?: string | null;
  actorName?: string | null;
  notes?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const { error } = await supabase.from('customer_service_followup_events').insert({
    followup_id: input.followupId || null,
    queue_item_id: input.queueItemId || null,
    event_type: input.eventType,
    event_status: input.status || null,
    actor_staff_id: input.actorStaffId || null,
    actor_name: input.actorName || null,
    notes: input.notes || null,
    metadata: input.metadata || {},
  });
  if (error && !missingRelation(error.message)) throw error;
}

export async function notifyIncompleteDailyQueue(input: {
  branch: string;
  ownerName: string;
  total: number;
  completed: number;
  needsManager: number;
}) {
  if (!input.total || input.completed >= input.total) return;
  const hour = new Date().getHours();
  const stage = hour >= 19 ? 'end' : hour >= 15 ? 'mid' : '';
  if (!stage) return;
  const roles = [
    'customer_service_manager',
    'branch_manager',
    'branches_manager',
    'general_manager',
  ];
  const accounts = await supabase
    .from('staff_accounts')
    .select('staff_id,id,role,branch,active,status')
    .in('role', roles)
    .limit(100);
  if (accounts.error) return;
  const eligibleRecipients = (accounts.data || []).filter((row) => {
    if (row.active === false || text(row.status).includes('موقوف')) return false;
    const role = text(row.role);
    if (role === 'branch_manager' || role === 'customer_service_manager')
      return !row.branch || sameBranch(row.branch, input.branch);
    return true;
  });
  const recipientsByStaffId = new Map<string, (typeof eligibleRecipients)[number]>();
  for (const row of eligibleRecipients) {
    const staffId = text(row.staff_id || row.id);
    if (staffId && !recipientsByStaffId.has(staffId)) recipientsByStaffId.set(staffId, row);
  }
  const recipients = [...recipientsByStaffId.values()];
  const remaining = Math.max(0, input.total - input.completed);
  await Promise.allSettled(
    recipients.map((row) =>
      createStaffNotification({
        recipientStaffId: text(row.staff_id || row.id),
        type: 'customer_service_queue_incomplete',
        title: stage === 'end' ? 'قائمة خدمة العملاء لم تكتمل' : 'تنبيه تقدم قائمة خدمة العملاء',
        message: `${normalizeBranchName(input.branch)}: تم تنفيذ ${input.completed} من ${input.total}، والمتبقي ${remaining}${input.needsManager ? `، ومنها ${input.needsManager} تحتاج مديرًا` : ''}.`,
        priority: stage === 'end' || input.needsManager ? 'urgent' : 'high',
        entityType: 'customer_service_daily_queue',
        entityId: `${todayKey()}:${normalizeBranchName(input.branch)}:${stage}`,
        actionUrl: `/customer-service?branch=${encodeURIComponent(normalizeBranchName(input.branch))}`,
        metadata: {
          branch: normalizeBranchName(input.branch),
          owner: input.ownerName,
          total: input.total,
          completed: input.completed,
          remaining,
          needsManager: input.needsManager,
          stage,
        },
      })
    )
  );
}
