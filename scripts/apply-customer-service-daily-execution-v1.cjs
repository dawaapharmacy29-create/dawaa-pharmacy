const fs = require('node:fs');

const filePath = 'src/components/customerService/UnifiedCustomerServiceWorkspace.tsx';
let source = fs.readFileSync(filePath, 'utf8');

// Vercel runs this repair during every build. Once the persistent queue and
// event tracking are present, rerunning the textual patch must be a safe no-op.
if (source.includes('loadOrCreateDailyQueue(') && source.includes('appendFollowupEvent({') && source.includes('queueItemId?: string | null;')) {
  console.log('Customer service daily execution v1 already applied.');
  process.exit(0);
}

function replaceOnce(search, replacement, label) {
  if (source.includes(replacement)) return;
  if (!source.includes(search)) throw new Error(`customer service execution patch missing: ${label}`);
  source = source.replace(search, replacement);
}

replaceOnce(
  `import type { DailyFollowup } from '@/types/database';`,
  `import type { DailyFollowup } from '@/types/database';
import {
  appendFollowupEvent,
  loadOrCreateDailyQueue,
  notifyIncompleteDailyQueue,
  updateDailyQueueItem,
} from '@/lib/customerServiceDailyExecution';`,
  'daily execution imports'
);

replaceOnce(
  `  completed: boolean;
};`,
  `  completed: boolean;
  queueItemId?: string | null;
};`,
  'queue item id'
);

replaceOnce(
  `      const doctorRequests = followups.filter((row) => !isCompleted(row) && sourceFromRow(row) === 'doctor_request').map((row) => followupToItem(row, 'doctor_request'));`,
  `      const doctorRequests = followups.filter((row) => !isCompleted(row) && sourceFromRow(row) === 'doctor_request').map((row) => followupToItem(row, 'doctor_request'));
      const scheduledToday = followups
        .filter((row) => !isCompleted(row) && String(row.next_followup_date || '').slice(0, 10) === todayIso())
        .map((row) => followupToItem(row, sourceFromRow(row)));`,
  'scheduled followups'
);

replaceOnce(
  `      add(doctorRequests, 10);
      add(yesterday, 10);`,
  `      add(scheduledToday, 30);
      add(doctorRequests, 10);
      add(yesterday, 10);`,
  'scheduled priority'
);

replaceOnce(
  `      const finalQueue = [...map.values()].slice(0, 30);
      setQueue(finalQueue);
      setSelectedKey((current) => current && finalQueue.some((item) => item.key === current) ? current : finalQueue[0]?.key || '');`,
  `      const proposedQueue = [...map.values()].slice(0, 30);
      const snapshot = await loadOrCreateDailyQueue(
        branch,
        proposedQueue.map((item) => ({
          key: item.key,
          source: item.source,
          customerId: item.customer?.customer_id || item.customer?.id || item.row?.customer_id || null,
          code: item.code || null,
          name: item.name,
          phone: item.phone || null,
          branch: item.branch,
          priority: item.priority,
          reason: item.reason,
          nextFollowupDate: item.row?.next_followup_date || null,
          linkedFollowupId: item.row?.id || null,
        })),
        { id: user?.id || null, name: user?.name || null }
      );
      const proposedByKey = new Map(proposedQueue.map((item) => [item.key, item]));
      const finalQueue = snapshot.items.map((saved) => {
        const original = proposedByKey.get(saved.key);
        if (original) return { ...original, queueItemId: saved.id, completed: saved.status === 'completed' || original.completed };
        return {
          key: saved.key,
          source: saved.source as QueueSource,
          row: followups.find((row) => row.id === saved.linkedFollowupId) || null,
          customer: null,
          name: saved.name,
          code: saved.code || '',
          phone: saved.phone || '',
          branch: saved.branch,
          segment: 'غير مصنف',
          status: saved.status,
          priority: saved.priority || 'مهم',
          reason: saved.reason || 'متابعة اليوم',
          avgMonthly: 0,
          totalSpent: 0,
          avgInvoice: 0,
          lastPurchase: '',
          completed: saved.status === 'completed',
          queueItemId: saved.id,
        };
      });
      setQueue(finalQueue);
      const completedCount = finalQueue.filter((item) => item.completed).length;
      const needsManagerCount = followups.filter((row) => row.needs_manager && !isCompleted(row)).length;
      void notifyIncompleteDailyQueue({ branch, ownerName: BRANCH_OWNER[branch] || 'مسئول خدمة العملاء', total: finalQueue.length, completed: completedCount, needsManager: needsManagerCount });
      setSelectedKey((current) => current && finalQueue.some((item) => item.key === current) ? current : finalQueue[0]?.key || '');`,
  'persistent queue snapshot'
);

replaceOnce(
  `    setQueue((current) => current.map((row) => row.key === item.key ? { ...row, row: created } : row));
    return created;`,
  `    await updateDailyQueueItem(item.queueItemId || '', { linkedFollowupId: created.id, status: 'in_progress', started: true });
    await appendFollowupEvent({ followupId: created.id, queueItemId: item.queueItemId, eventType: 'started', status: 'in_progress', actorStaffId: user?.staff_id || user?.id || null, actorName: user?.name || null });
    setQueue((current) => current.map((row) => row.key === item.key ? { ...row, row: created, status: 'جارٍ التواصل' } : row));
    return created;`,
  'queue start tracking'
);

replaceOnce(
  `    await updateFollowupResult(resultRow.id, payload);
    setResultRow(null);
    await loadWorkspace();`,
  `    await updateFollowupResult(resultRow.id, payload);
    const queueItem = queue.find((item) => item.row?.id === resultRow.id || item.key === normalizeKey(resultRow.customer_code, resultRow.customer_phone, resultRow.phone, resultRow.customer_id, resultRow.customer_name));
    await updateDailyQueueItem(queueItem?.queueItemId || '', {
      status: completed ? 'completed' : data.result === 'يحتاج متابعة مدير' ? 'needs_manager' : 'scheduled',
      nextFollowupDate: data.nextFollowupDate || null,
      completed,
    });
    await appendFollowupEvent({ followupId: resultRow.id, queueItemId: queueItem?.queueItemId, eventType: completed ? 'completed' : 'result_saved', status: data.result, actorStaffId: user?.staff_id || user?.id || null, actorName: user?.name || null, notes: data.notes, metadata: { nextFollowupDate: data.nextFollowupDate || null, purchaseAmount: data.purchaseAmount } });
    setResultRow(null);
    await loadWorkspace();`,
  'result event tracking'
);

replaceOnce(
  `      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Stat icon={Users} label={\`قائمة \${owner}\`} value={queue.length} /><Stat icon={CheckCircle2} label="مكتمل اليوم" value={stats.completed} /><Stat icon={History} label="إجمالي السجل المكتمل" value={completedHistory.length} /><Stat icon={UserRoundSearch} label="طلبات دكاترة" value={queue.filter((item) => item.source === 'doctor_request').length} /><Stat icon={HeartHandshake} label="مهددون" value={queue.filter((item) => item.source === 'at_risk').length} /><Stat icon={Sparkles} label="عملاء مهمون" value={queue.filter((item) => item.source === 'important').length} />
      </section>`,
  `      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <button type="button" className="text-right" onClick={() => { setTab('today'); setSourceFilter('all'); setStatusFilter('all'); }}><Stat icon={Users} label={\`قائمة \${owner}\`} value={queue.length} /></button>
        <button type="button" className="text-right" onClick={() => { setTab('today'); setSourceFilter('all'); setStatusFilter('completed'); }}><Stat icon={CheckCircle2} label="مكتمل اليوم" value={stats.completed} /></button>
        <button type="button" className="text-right" onClick={() => setTab('history')}><Stat icon={History} label="إجمالي السجل المكتمل" value={completedHistory.length} /></button>
        <button type="button" className="text-right" onClick={() => { setTab('doctor-requests'); setSourceFilter('doctor_request'); setStatusFilter('all'); }}><Stat icon={UserRoundSearch} label="طلبات دكاترة" value={queue.filter((item) => item.source === 'doctor_request').length} /></button>
        <button type="button" className="text-right" onClick={() => { setTab('care'); setSourceFilter('at_risk'); setStatusFilter('all'); }}><Stat icon={HeartHandshake} label="مهددون" value={queue.filter((item) => item.source === 'at_risk').length} /></button>
        <button type="button" className="text-right" onClick={() => { setTab('care'); setSourceFilter('important'); setStatusFilter('all'); }}><Stat icon={Sparkles} label="عملاء مهمون" value={queue.filter((item) => item.source === 'important').length} /></button>
      </section>`,
  'clickable stat filters'
);

fs.writeFileSync(filePath, source);
console.log('Customer service daily execution v1 applied.');
