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

const insightReplacements = [
  [
    "  return score;\n}\n\nconst actionLabels",
    `  return score;
}

function suggestedFollowupScript(row: FollowupRow, kind: 'general' | 'inactive' | 'missing' | 'thanks') {
  const name = customerName(row);
  if (kind === 'inactive') return \`أهلًا أ/ \${name}، مع حضرتك صيدليات دواء. لاحظنا إن زيارات حضرتك قلت الفترة الأخيرة وحبينا نطمن إن كل احتياجاتك متوفرة. هل في صنف أو خدمة نقدر نساعد حضرتك فيها؟\`;
  if (kind === 'missing') return \`أهلًا أ/ \${name}، مع حضرتك صيدليات دواء. بنراجع احتياجات حضرتك وعايزين نتأكد إن الأصناف المطلوبة متوفرة، ولو في صنف ناقص نسجله ونوفره لحضرتك في أسرع وقت.\`;
  if (kind === 'thanks') return \`أهلًا أ/ \${name}، بنشكرك على ثقتك في صيدليات دواء. حابين نطمن إن آخر طلب وصل بشكل سليم وإن كل الأصناف مناسبة لحضرتك.\`;
  return \`أهلًا أ/ \${name}، مع حضرتك صيدليات دواء. حابين نطمن على حضرتك ونعرف هل في أي احتياج أو ملاحظة نقدر نساعد فيها؟\`;
}

const actionLabels`,
  ],
  [
    "      {historyOpen ?",
    `      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-2xl border border-cyan-400/15 bg-cyan-400/10 p-3"><div className="text-xs font-black text-cyan-200">الأهمية</div><div className="mt-1 font-black text-white">{importance(selected).label}</div></div>
        <div className="rounded-2xl border border-cyan-400/15 bg-cyan-400/10 p-3"><div className="text-xs font-black text-cyan-200">حالة النشاط</div><div className="mt-1 font-black text-white">{activity(selected).label}</div></div>
        <div className="rounded-2xl border border-cyan-400/15 bg-cyan-400/10 p-3"><div className="text-xs font-black text-cyan-200">آخر شراء</div><div className="mt-1 font-black text-white">{lastPurchase(selected) || 'غير معروف'}</div></div>
        <div className="rounded-2xl border border-cyan-400/15 bg-cyan-400/10 p-3"><div className="text-xs font-black text-cyan-200">المتوسط الشهري</div><div className="mt-1 font-black text-white">{formatCurrency(monthlyAverage(selected))}</div></div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-3"><div className="text-xs font-black text-slate-400">إجمالي المشتريات</div><div className="mt-1 font-black text-white">{formatCurrency(Number(selected.total_spent || metricNumber(selected, 'total_spent')))}</div></div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-3"><div className="text-xs font-black text-slate-400">عدد مرات الشراء</div><div className="mt-1 font-black text-white">{metricNumber(selected, 'invoices_count')}</div></div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-3"><div className="text-xs font-black text-slate-400">متوسط الفاتورة</div><div className="mt-1 font-black text-white">{formatCurrency(metricNumber(selected, 'avg_invoice'))}</div></div>
        <button type="button" className="rounded-2xl border border-emerald-300/30 bg-emerald-400/15 p-3 text-right" onClick={() => setDetailsOpen(true)}><div className="text-xs font-black text-emerald-200">الملف الكامل</div><div className="mt-1 font-black text-white">ملف العميل 360</div></button>
      </div>

      <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.035] p-4">
        <div className="text-xs font-black text-slate-400">سبب المتابعة</div>
        <div className="mt-1 text-sm font-bold leading-7 text-white">{selected.followup_reason || selected.request_details || selected.notes || 'غير مسجل'}</div>
        <div className="mt-3 text-xs font-black text-slate-400">آخر نتيجة مسجلة</div>
        <div className="mt-1 text-sm font-bold leading-7 text-white">{selected.followup_result || selected.contact_result || selected.followup_summary || 'لم تسجل نتيجة بعد'}</div>
      </div>

      <div className="mt-3 rounded-2xl border border-amber-300/20 bg-amber-400/10 p-4">
        <div className="font-black text-amber-100">سكريبتات تواصل مقترحة</div>
        <p className="mt-1 text-xs font-bold text-amber-50/70">اختاري السكريبت ثم عدّليه حسب حالة العميل قبل الإرسال.</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" className="btn-secondary text-xs" onClick={() => setActionNote(suggestedFollowupScript(selected, 'general'))}>اطمئنان عام</button>
          <button type="button" className="btn-secondary text-xs" onClick={() => setActionNote(suggestedFollowupScript(selected, 'inactive'))}>استعادة عميل متوقف</button>
          <button type="button" className="btn-secondary text-xs" onClick={() => setActionNote(suggestedFollowupScript(selected, 'missing'))}>متابعة صنف أو طلب</button>
          <button type="button" className="btn-secondary text-xs" onClick={() => setActionNote(suggestedFollowupScript(selected, 'thanks'))}>شكر بعد الشراء</button>
        </div>
      </div>

      {historyOpen ?`,
  ],
];

for (const [before, after] of insightReplacements) {
  if (source.includes(after)) continue;
  if (!source.includes(before)) {
    throw new Error(`Expected customer insight snippet was not found: ${before}`);
  }
  source = source.replace(before, after);
}

fs.writeFileSync(target, source, 'utf8');
console.log('Customer follow-up workflow applied with balanced queue, review stage, full customer insights, scripts, and customer 360 access.');
