// Contracts 1, 2, 3, 14, 15, 16 (canonical identity, source branch, retry idempotency, stale state).
// Pure helper tests plus source scans of the wiring in the screens that write or show current cases.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  canonicalCustomerSourceColumns,
  resolveCanonicalCustomerIdentity,
  type CustomerIdentityCandidate,
  type CustomerIdentityCandidates,
} from '@/lib/customers/canonicalCustomerIdentityResolver';
import {
  clearedReviewCustomerFields,
  deterministicActionUuid,
  isReviewCustomerLocked,
  legacyEditIdentityPatch,
  newReviewSourceBranch,
  reviewCustomerFieldsFromRecord,
  reviewCustomerLookup,
  reviewCustomerPayload,
  reviewPointsConvergencePlan,
  reviewResponsibleStaffId,
  staffAttributionOrFilter,
  type ReviewPointsWrite,
} from '@/lib/reviews/reviewIdentity';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';
const STAFF_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const STAFF_2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PHONE = '01012345678';

function candidates(rows: Array<Partial<CustomerIdentityCandidate> & { id: string }>): CustomerIdentityCandidates {
  return {
    byId: new Map(
      rows.map((row) => [
        row.id,
        { customerCode: null, phones: [], name: null, branch: null, isDuplicate: false, ...row } as CustomerIdentityCandidate,
      ])
    ),
    aliasToCanonical: new Map(),
  };
}

describe('contract 1: canonical customer identity', () => {
  it('A: two customers sharing the contact phone stay ambiguous; no candidate is picked', () => {
    const identity = resolveCanonicalCustomerIdentity(
      { customerCodes: [], contactPhones: [PHONE], mentionedPhones: [], displayName: 'اسم من الملف' },
      candidates([
        { id: UUID_A, customerCode: 'C1', phones: [PHONE], name: 'عميل أ' },
        { id: UUID_B, customerCode: 'C2', phones: [PHONE], name: 'عميل ب' },
      ])
    );
    expect(identity.status).toBe('ambiguous');
    expect(identity.customerId).toBeNull();
    const columns = canonicalCustomerSourceColumns(identity, { name: 'اسم من الملف' });
    expect(columns.customer_id).toBeNull();
    // the unresolved hint is kept as a label; neither candidate's name or code leaks in
    expect(columns.customer_name).toBe('اسم من الملف');
    expect([columns.customer_code, columns.customer_name]).not.toContain('C1');
    expect([columns.customer_name]).not.toContain('عميل أ');
    expect([columns.customer_name]).not.toContain('عميل ب');
  });

  it('A: a review form without a picked customer saves customer_id = null (a typed code is not an identity)', () => {
    const payload = reviewCustomerPayload({ customerId: '', customerCode: '1234', customerName: 'كتابة يدوية', customerPhone: '' });
    expect(payload.customer_id).toBeNull();
    expect(payload.customer_code).toBe('1234');
    expect(isReviewCustomerLocked({ customerId: '' })).toBe(false);
  });

  it('B: a resolved customer takes id, code, name and phone from its own record, never from evidence', () => {
    const identity = resolveCanonicalCustomerIdentity(
      { customerCodes: [], contactPhones: [PHONE], mentionedPhones: [], displayName: 'اسم جهة الاتصال' },
      candidates([{ id: UUID_A, customerCode: 'C1', phones: [PHONE], name: null }])
    );
    expect(identity.status).toBe('resolved');
    expect(canonicalCustomerSourceColumns(identity, { name: 'اسم جهة الاتصال', code: 'X9' })).toEqual({
      customer_id: UUID_A,
      customer_code: 'C1',
      // the record has no name: stays empty instead of borrowing the contact label
      customer_name: null,
      customer_phone: PHONE,
    });
  });

  it('B: review form fields come from ONE record; clearing the id clears all four', () => {
    expect(reviewCustomerFieldsFromRecord({ id: UUID_A, code: 'C1', name: 'عميل أ', phone: null })).toEqual({
      customerId: UUID_A,
      customerCode: 'C1',
      customerName: 'عميل أ',
      customerPhone: '',
    });
    expect(reviewCustomerFieldsFromRecord({ id: '', code: 'C1', name: 'عميل أ', phone: PHONE })).toEqual(
      clearedReviewCustomerFields()
    );
    expect(isReviewCustomerLocked({ customerId: UUID_A })).toBe(true);
  });

  it('B: the canonical lookup reads customers.id for a uuid and customers.customer_code otherwise', () => {
    expect(reviewCustomerLookup(UUID_A)).toEqual({ column: 'id', value: UUID_A });
    expect(reviewCustomerLookup('10045')).toEqual({ column: 'customer_code', value: '10045' });
    expect(reviewCustomerLookup('  ')).toBeNull();
  });

  it('a legacy edit never rewrites a resolved customer; an unresolved row keeps its text snapshot editable', () => {
    const input = { staff_id: STAFF_1, customer_name: 'جديد', customer_code: '9', customer_phone: PHONE };
    const resolved = legacyEditIdentityPatch({ staff_id: STAFF_1, customer_id: 'C1' }, input, []);
    expect(resolved.ok && Object.keys(resolved.patch)).toEqual([]);
    const unresolved = legacyEditIdentityPatch({ staff_id: STAFF_1, customer_id: null }, input, []);
    expect(unresolved.ok && unresolved.patch).toEqual({ customer_name: 'جديد', customer_code: '9', customer_phone: PHONE });
  });

  it('Reviews wiring: picks go through the one-record helper and resolved fields are read-only', () => {
    const reviews = read('src/pages/Reviews.tsx');
    expect(reviews).toContain('...reviewCustomerPayload(form)');
    expect(reviews.match(/reviewCustomerFieldsFromRecord\(/g)?.length).toBeGreaterThanOrEqual(3);
    expect(reviews).toContain('readOnly={customerLocked}');
    expect(reviews).not.toMatch(/customer_id:\s*form\.customerId\s*\|\|\s*form\.customerCode/);
  });

  it('Smart Folder persists customer columns from one identity decision', () => {
    const watcher = read('src/pages/WhatsAppSmartFolderWatcher.tsx');
    expect(watcher).toContain('canonicalCustomerSourceColumns(');
    expect(watcher).toContain('customerId: customerColumns.customer_id');
    expect(watcher).toContain('customerName: customerColumns.customer_name');
  });
});

describe('contract 2: canonical responsible staff identity', () => {
  const directory = [
    { id: STAFF_1, name: 'نور', role: 'صيدلي', branch: 'فرع أ' },
    { id: STAFF_2, name: 'سارة', role: 'خدمة عملاء', branch: 'فرع ب' },
  ];

  it('reassignment writes id, name and role from the SAME staff record and never the branch', () => {
    const result = legacyEditIdentityPatch(
      { staff_id: STAFF_1, customer_id: 'C1', branch: 'فرع أ' },
      { staff_id: STAFF_2, customer_name: '', customer_code: '', customer_phone: '' },
      directory
    );
    expect(result).toEqual({
      ok: true,
      staffChanged: true,
      patch: { staff_id: STAFF_2, doctor_id: STAFF_2, staff_name: 'سارة', doctor_name: 'سارة', staff_role: 'خدمة عملاء' },
    });
  });

  it('an unknown or empty staff id is refused instead of saving a guessed owner', () => {
    const row = { staff_id: STAFF_1, customer_id: 'C1' };
    const base = { customer_name: '', customer_code: '', customer_phone: '' };
    expect(legacyEditIdentityPatch(row, { ...base, staff_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }, directory)).toEqual({
      ok: false,
      error: 'staff_not_found',
    });
    expect(legacyEditIdentityPatch(row, { ...base, staff_id: '' }, directory)).toEqual({ ok: false, error: 'staff_required' });
  });

  it('unchanged owner keeps the historical staff snapshot untouched', () => {
    const result = legacyEditIdentityPatch(
      { staff_id: null, doctor_id: STAFF_1, customer_id: 'C1' },
      { staff_id: STAFF_1, customer_name: '', customer_code: '', customer_phone: '' },
      directory
    );
    expect(result).toEqual({ ok: true, staffChanged: false, patch: {} });
    expect(reviewResponsibleStaffId({ staff_id: null, doctor_id: STAFF_1 })).toBe(STAFF_1);
    expect(reviewResponsibleStaffId({ staff_id: STAFF_2, doctor_id: STAFF_1 })).toBe(STAFF_2);
  });

  it('staff attribution counts doctor_id only when staff_id is empty (one owner per review)', () => {
    expect(staffAttributionOrFilter(STAFF_1)).toBe(`staff_id.eq.${STAFF_1},and(staff_id.is.null,doctor_id.eq.${STAFF_1})`);
    expect(read('src/lib/staffDetailLoader.ts')).toContain('staffAttributionOrFilter(args.staffId)');
    expect(read('src/pages/Reviews.tsx')).toContain('q.or(staffAttributionOrFilter(historyFilterStaffId))');
    for (const file of [
      'src/components/doctor/DoctorReviewDetails.tsx',
      'src/pages/DoctorDashboardStable.tsx',
      'src/lib/staff/employeeMonthlyEvidenceService.ts',
    ]) {
      expect(read(file), file).toContain(".is('staff_id', null)");
    }
  });

  it('the edit form cannot type a staff name; the canonical identity block is on both detail screens', () => {
    const reviews = read('src/pages/Reviews.tsx');
    expect(reviews).toContain('<ReviewCanonicalIdentity row={row} />');
    expect(read('src/pages/ConversationReviewDetailsFast.tsx')).toContain('<ReviewCanonicalIdentity row={row} />');
    const block = read('src/components/reviews/ReviewCanonicalIdentity.tsx');
    expect(block).toContain('لقطة تاريخية');
    expect(block).toContain('غير محسوم');
  });

  it('a Smart Folder source stores a staff name only with its resolved staff id', () => {
    const persistence = read('src/lib/whatsappReviewPersistenceV4.ts');
    expect(persistence).toContain('const staffName = context.staffId ? context.staffName || null : null;');
    expect(persistence).not.toContain('session.outboundStaffNames[0]');
  });
});

describe('contract 3: source branch is immutable provenance', () => {
  it('C: reassigning the employee never produces a branch change', () => {
    const result = legacyEditIdentityPatch(
      { staff_id: STAFF_1, customer_id: 'C1', branch: 'فرع أ' },
      { staff_id: STAFF_2, customer_name: '', customer_code: '', customer_phone: '' },
      [{ id: STAFF_2, name: 'سارة', role: null, branch: 'فرع ب' }]
    );
    expect(result.ok && 'branch' in result.patch).toBe(false);
    expect(result.ok && 'branch_id' in result.patch).toBe(false);
  });

  it('C: the edit payload and the edit UI carry no branch write', () => {
    const reviews = read('src/pages/Reviews.tsx');
    const saveEdit = reviews.slice(reviews.indexOf('const saveEdit'), reviews.indexOf('const openManagerReview'));
    expect(saveEdit).not.toMatch(/\bbranch:\s*(editForm|selectedStaff|selectedDoctor)/);
    expect(saveEdit).toContain('p_branch: editingReview.branch || null');
    expect(reviews).toContain('فرع المحادثة (ثابت)');
  });

  it('D: a cross-branch staff member does not move a new review away from the conversation branch', () => {
    expect(
      newReviewSourceBranch({ conversationBranch: 'فرع المحادثة', reviewerBranch: 'فرع المراجع', staffHomeBranch: 'فرع الموظف' })
    ).toBe('فرع المحادثة');
    expect(newReviewSourceBranch({ conversationBranch: '', reviewerBranch: 'فرع المراجع', staffHomeBranch: 'فرع الموظف' })).toBe(
      'فرع المراجع'
    );
    expect(newReviewSourceBranch({ staffHomeBranch: 'فرع الموظف' })).toBe('فرع الموظف');
    const reviews = read('src/pages/Reviews.tsx');
    expect(reviews).toContain('branch: reviewSourceBranch || null');
  });

  it("D: Smart Folder sources keep the conversation's branch hint, not the customer's home branch", () => {
    const watcher = read('src/pages/WhatsAppSmartFolderWatcher.tsx');
    // (invoice matching may still use the customer's branch as a sale-proof hint; it is not persisted)
    const persistContext = watcher.slice(watcher.indexOf('sourceFileName: file.name'), watcher.indexOf('analysisVersion: SMART_FOLDER_ANALYSIS_VERSION'));
    expect(persistContext).toContain('branch: branchHint.value || null');
    expect(persistContext).not.toContain('resolvedCustomer');
  });
});

describe('contract 14: retries converge', () => {
  // The DB upserts on (staff, cycle, source, source_id, rule): replaying the plan is idempotent.
  function applyPlan(ledger: Map<string, number>, writes: ReviewPointsWrite[]) {
    for (const write of writes) ledger.set(`${write.staffId}|${write.monthCycle}`, write.points);
    return ledger;
  }

  it('E: retrying the same points edit converges to one absolute value per key', () => {
    const previous = { staffId: STAFF_1, monthCycle: '2026-10', impact: -2 };
    const next = { staffId: STAFF_1, monthCycle: '2026-10', impact: 3 };
    const once = applyPlan(new Map([[`${STAFF_1}|2026-10`, -2]]), reviewPointsConvergencePlan(previous, next));
    const twice = applyPlan(new Map(once), reviewPointsConvergencePlan(previous, next));
    expect([...once]).toEqual([[`${STAFF_1}|2026-10`, 3]]);
    expect(twice).toEqual(once);
  });

  it('E/F: reassigning staff zeros the previous owner and gives the impact once to the new one, in any replay order', () => {
    const previous = { staffId: STAFF_1, monthCycle: '2026-10', impact: 4 };
    const next = { staffId: STAFF_2, monthCycle: '2026-10', impact: 4 };
    const plan = reviewPointsConvergencePlan(previous, next);
    expect(plan).toEqual([
      { staffId: STAFF_1, monthCycle: '2026-10', points: 0 },
      { staffId: STAFF_2, monthCycle: '2026-10', points: 4 },
    ]);
    const start = () => new Map([[`${STAFF_1}|2026-10`, 4]]);
    const serial = applyPlan(applyPlan(start(), plan), plan);
    const interleaved = applyPlan(start(), [plan[0], plan[0], plan[1], plan[1]]);
    expect(serial).toEqual(interleaved);
    expect([...serial.values()].reduce((a, b) => a + b, 0)).toBe(4);
  });

  it('a zero-impact review with no prior row writes nothing', () => {
    expect(reviewPointsConvergencePlan({ staffId: STAFF_1, monthCycle: 'c', impact: 0 }, { staffId: STAFF_1, monthCycle: 'c', impact: 0 })).toEqual([]);
  });

  it('E: the coaching note of one review always gets the same primary key', async () => {
    const first = await deterministicActionUuid('staff_coaching_notes', 'conversation_review_repeat', 'review-1');
    const retry = await deterministicActionUuid('staff_coaching_notes', 'conversation_review_repeat', 'review-1');
    const other = await deterministicActionUuid('staff_coaching_notes', 'conversation_review_repeat', 'review-2');
    expect(first).toBe(retry);
    expect(first).not.toBe(other);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('F: Reviews mutations use server keys (points upsert, manager review PK, coaching PK) plus in-flight guards', () => {
    const reviews = read('src/pages/Reviews.tsx');
    expect(reviews).toContain("supabase.rpc('record_employee_points_transaction_v4'");
    expect(reviews).toContain("p_source: 'conversation_evaluation'");
    expect(reviews).toContain('p_source_id: editingReview.id');
    expect(reviews).not.toContain('persistPointsTransaction(');
    expect(reviews).toContain('id: managerReviewAttemptRef.current');
    expect(reviews).toContain("deterministicActionUuid('staff_coaching_notes', 'conversation_review_repeat', reviewRowId)");
    expect(reviews).toMatch(/ins\.error\.code === '23505' && typeof currentPayload\.id === 'string' && \/_pkey\//);
    expect(reviews).toContain('if (editSaveInFlightRef.current) return false;');
    expect(reviews).toContain('if (managerReviewInFlightRef.current) return false;');
  });
});

describe('contracts 15/16: no stale state or cache after a mutation', () => {
  it('G: an older openEdit hydration cannot overwrite the editor opened later', () => {
    const reviews = read('src/pages/Reviews.tsx');
    expect(reviews).toContain('const openSeq = ++openEditSeqRef.current;');
    expect(reviews).toContain('if (openSeq !== openEditSeqRef.current) return;');
  });

  it('K: every review mutation invalidates the session history cache', () => {
    const reviews = read('src/pages/Reviews.tsx');
    // correction, legacy edit, new review, manager review
    expect(reviews.match(/invalidateReviewHistoryCache\(user\?\.id\)/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it('J: a cached history copy is labelled as cached, never shown as live current data', () => {
    const reviews = read('src/pages/Reviews.tsx');
    expect(reviews).toContain('setHistoryCachedAt(');
    expect(reviews).toContain('نسخة محفوظة مؤقتًا');
  });

  it('K: the canonical identity block re-reads by id and ignores a response for a previous review', () => {
    const block = read('src/components/reviews/ReviewCanonicalIdentity.tsx');
    expect(block).toContain('[customerKey, staffId]');
    expect(block).toContain('if (cancelled) return;');
  });

  it('L: Smart Folder runs restored from local history are labelled historical and merged, not swapped in', () => {
    const watcher = read('src/pages/WhatsAppSmartFolderWatcher.tsx');
    expect(watcher).toContain('restoredFromHistory: true');
    expect(watcher).toContain('لقطة تاريخية من وقت التحليل');
    expect(watcher).not.toContain('setRuns(history.map((row) => row.payload))');
  });
});
