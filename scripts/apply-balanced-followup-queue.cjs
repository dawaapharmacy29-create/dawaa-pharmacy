const fs = require('node:fs');
const path = require('node:path');

const target = path.join(process.cwd(), 'src/components/customerService/CustomerFollowupCockpitPanel.tsx');
let source = fs.readFileSync(target, 'utf8');

const replacements = [
  [
    "const DAILY_QUEUE_LIMIT = 45;",
    "const PER_BRANCH_QUEUE_LIMIT = 25;\nconst TOTAL_DAILY_QUEUE_LIMIT = PER_BRANCH_QUEUE_LIMIT * 2;",
  ],
  [
    "type WorkspaceTab = 'queue' | 'waiting' | 'contacted' | 'performance';",
    "type WorkspaceTab = 'queue' | 'waiting' | 'review' | 'contacted' | 'performance';",
  ],
  [
    "type QuickAction = 'message_sent' | 'no_answer' | 'replied' | 'scheduled' | 'completed';",
    "type QuickAction = 'message_sent' | 'no_answer' | 'replied' | 'scheduled' | 'completed';\ntype ReviewAction = 'approved' | 'returned_for_completion' | 'escalated';",
  ],
  [
    "const isDueNow = (row: FollowupRow) => !dayKey(row.next_followup_date) || dayKey(row.next_followup_date) <= localDayKey();",
    "const isDueNow = (row: FollowupRow) => !dayKey(row.next_followup_date) || dayKey(row.next_followup_date) <= localDayKey();\nconst isPendingReview = (row: FollowupRow) => /pending_review|انتظار مراجعة|في انتظار المراجعة/i.test(rawStatus(row));",
  ],
  [
    "const canExecute = currentProfile.role === 'executor';",
    "const canExecute = ['executor', 'reviewer', 'general_manager'].includes(currentProfile.role);",
  ],
  [
    "const queueCandidates = useMemo(() => rows.filter((row) => !isWaiting(row) && isDueNow(row)).sort((a, b) => smartScore(b) - smartScore(a)), [rows]);",
    "const reviewRows = useMemo(() => rows.filter(isPendingReview).sort((a, b) => smartScore(b) - smartScore(a)), [rows]);\n  const queueCandidates = useMemo(() => rows.filter((row) => !isWaiting(row) && !isPendingReview(row) && isDueNow(row)).sort((a, b) => smartScore(b) - smartScore(a)), [rows]);",
  ],
  [
    "const smartQueue = useMemo(() => queueCandidates.slice(0, DAILY_QUEUE_LIMIT), [queueCandidates]);",
    `const smartQueue = useMemo(() => {
    if (branch !== ALL_BRANCHES) {
      return queueCandidates.slice(0, PER_BRANCH_QUEUE_LIMIT);
    }

    const shamyQueue = queueCandidates
      .filter((row) => normalizeBranchName(row.branch || '').includes('الشامي'))
      .slice(0, PER_BRANCH_QUEUE_LIMIT);

    const shokryQueue = queueCandidates
      .filter((row) => normalizeBranchName(row.branch || '').includes('شكري'))
      .slice(0, PER_BRANCH_QUEUE_LIMIT);

    return [...shamyQueue, ...shokryQueue].sort((a, b) => smartScore(b) - smartScore(a));
  }, [branch, queueCandidates]);`,
  ],
  [
    "const source = tab === 'waiting' ? waitingRows : smartQueue;",
    "const source = tab === 'waiting' ? waitingRows : tab === 'review' ? reviewRows : smartQueue;",
  ],
  [
    "}, [search, smartQueue, tab, waitingRows]);",
    "}, [reviewRows, search, smartQueue, tab, waitingRows]);",
  ],
  [
    "const contactedEvents = useMemo(() => events.filter((event) => EXECUTION_ACTIONS.has(event.action) && actorProfile(event.actor_name).role === 'executor'), [events]);",
    "const contactedEvents = useMemo(() => events.filter((event) => EXECUTION_ACTIONS.has(event.action)), [events]);",
  ],
  [
    "toast.error('التنفيذ متاح فقط لد/ ضحى لفرع الشامي ود/ دنيا لفرع شكري. حسابك للمراجعة والإشراف.');",
    "toast.error('حسابك لا يملك صلاحية تنفيذ المتابعات. التنفيذ متاح لد/ ضحى ود/ دنيا ود/ علا والمدير العام.');",
  ],
  [
    "payload = { ...payload, completed_at: now, status: 'completed', followup_status: 'completed', followup_result: actionNote.trim(), followup_summary: actionNote.trim(), needs_next_followup: false, is_hidden: true, hidden_at: now, hidden_by: currentProfile.displayName, hidden_reason: 'تم إكمال المتابعة من قائمة التشغيل الذكية' };",
    "payload = { ...payload, status: 'pending_review', followup_status: 'pending_review', contact_status: 'في انتظار المراجعة', followup_result: actionNote.trim(), followup_summary: actionNote.trim(), needs_next_followup: false, is_hidden: false };",
  ],
  [
    "toast.success(action === 'completed' ? 'تم الإكمال وظهر العميل التالي تلقائيًا' : 'تم حفظ الإجراء');",
    "toast.success(action === 'completed' ? 'تم إرسال المتابعة لمراجعة د/ علا وظهر العميل التالي تلقائيًا' : 'تم حفظ الإجراء');",
  ],
  [
    "  const tabs: Array<[WorkspaceTab, string, number, typeof Inbox]> = [",
    `  const executeReviewAction = async (action: ReviewAction) => {
    if (!selected || !isPendingReview(selected)) return;
    if (!['reviewer', 'general_manager'].includes(currentProfile.role)) {
      toast.error('الاعتماد أو الإعادة متاحان لد/ علا والمدير العام فقط.');
      return;
    }
    if (action !== 'approved' && actionNote.trim().length < 3) {
      toast.error('اكتب سبب الإعادة أو التصعيد قبل الحفظ.');
      return;
    }

    setSaving(true);
    try {
      const now = new Date().toISOString();
      let payload: Record<string, unknown>;
      let result: string;

      if (action === 'approved') {
        result = 'تم اعتماد المتابعة وإغلاقها نهائيًا';
        payload = {
          completed_at: now,
          status: 'completed',
          followup_status: 'completed',
          contact_status: 'تم الاعتماد',
          needs_next_followup: false,
          is_hidden: true,
          hidden_at: now,
          hidden_by: currentProfile.displayName,
          hidden_reason: 'تم اعتماد المتابعة بعد المراجعة',
          updated_by: user?.id || null,
        };
      } else if (action === 'returned_for_completion') {
        result = 'أُعيدت المتابعة للمنفذة لاستكمال البيانات أو التواصل';
        payload = {
          status: 'open',
          followup_status: 'returned_for_completion',
          contact_status: 'أُعيدت للاستكمال',
          needs_next_followup: true,
          next_followup_date: localDayKey(),
          is_hidden: false,
          followup_summary: actionNote.trim(),
          updated_by: user?.id || null,
        };
      } else {
        result = 'تم تصعيد الحالة للإدارة';
        payload = {
          status: 'pending_review',
          followup_status: 'pending_review',
          contact_status: 'تم التصعيد',
          needs_manager: true,
          is_hidden: false,
          followup_summary: actionNote.trim(),
          updated_by: user?.id || null,
        };
      }

      const { error } = await supabase.from('daily_followups').update(payload).eq('id', selected.id);
      if (error) throw error;
      await audit(selected, action, {
        result,
        notes: actionNote.trim() || null,
        customer_name: customerName(selected),
        customer_code: selected.customer_code,
        reviewed_by: currentProfile.displayName,
      });
      toast.success(result);
      setSelected(null);
      setActionNote('');
      await load();
    } catch (error) {
      toast.error(\`تعذر حفظ قرار المراجعة: \${(error as Error).message}\`);
    } finally {
      setSaving(false);
    }
  };

  const tabs: Array<[WorkspaceTab, string, number, typeof Inbox]> = [`,
  ],
  [
    "['waiting', 'انتظار الرد', waitingRows.length, Clock3],",
    "['waiting', 'انتظار الرد', waitingRows.length, Clock3],\n    ['review', 'انتظار مراجعة د/ علا', reviewRows.length, ShieldCheck],",
  ],
  [
    "{smartQueue.length} / 45",
    "{smartQueue.length} / {branch === ALL_BRANCHES ? TOTAL_DAILY_QUEUE_LIMIT : PER_BRANCH_QUEUE_LIMIT}",
  ],
  [
    "{(tab === 'queue' || tab === 'waiting') ? <>",
    "{(tab === 'queue' || tab === 'waiting' || tab === 'review') ? <>",
  ],
  [
    "حسابك للمراجعة أو الإدارة؛ أزرار التنفيذ موقوفة.",
    "حسابك للعرض فقط؛ أزرار التنفيذ موقوفة.",
  ],
  [
    "disabled={saving || !canExecute}",
    "disabled={saving || !canExecute || isPendingReview(selected)}",
  ],
  [
    "    </aside></div> : null}",
    `{isPendingReview(selected) && ['reviewer', 'general_manager'].includes(currentProfile.role) ? <div className="mt-5 rounded-2xl border border-violet-400/20 bg-violet-400/10 p-4"><div className="mb-3 font-black text-violet-100">قرار المراجعة</div><div className="grid gap-2 sm:grid-cols-3"><button className="btn-primary" disabled={saving} onClick={() => void executeReviewAction('approved')}>اعتماد وإغلاق</button><button className="btn-secondary" disabled={saving} onClick={() => void executeReviewAction('returned_for_completion')}>إعادة للاستكمال</button><button className="btn-secondary" disabled={saving} onClick={() => void executeReviewAction('escalated')}>تصعيد للإدارة</button></div></div> : null}
    </aside></div> : null}`,
  ],
];

for (const [before, after] of replacements) {
  if (source.includes(after)) continue;
  if (!source.includes(before)) {
    throw new Error(`Expected follow-up workflow snippet was not found: ${before}`);
  }
  source = source.split(before).join(after);
}

fs.writeFileSync(target, source, 'utf8');
console.log('Customer follow-up workflow applied: balanced 25-per-branch queue, management execution permissions, and review/approval stage.');
