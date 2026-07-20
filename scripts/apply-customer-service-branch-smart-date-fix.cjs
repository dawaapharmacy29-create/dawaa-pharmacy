const fs = require('node:fs');
const path = require('node:path');

const file = path.join(process.cwd(), 'src/components/customerService/UnifiedCustomerServiceWorkspace.tsx');
let source = fs.readFileSync(file, 'utf8');

function replaceOnce(anchor, replacement, label) {
  if (!source.includes(anchor)) {
    if (source.includes(replacement)) return;
    throw new Error(`Missing patch anchor: ${label}`);
  }
  source = source.replace(anchor, replacement);
}

replaceOnce(
`function yesterdayIso() {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return localDateKey(date);
}
`,
`function yesterdayIso() {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return localDateKey(date);
}

function parseSmartFollowupDate(input: string) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const normalized = raw
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim();

  const direct = normalized.match(/^(\\d{4})[-\\/](\\d{1,2})[-\\/](\\d{1,2})$/);
  if (direct) {
    const date = new Date(Number(direct[1]), Number(direct[2]) - 1, Number(direct[3]), 10, 0, 0);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const today = new Date();
  today.setHours(10, 0, 0, 0);
  if (/^(اليوم|النهارده)$/.test(normalized)) return today;
  if (/^(بكره|غدا|غدًا)$/.test(normalized)) {
    today.setDate(today.getDate() + 1);
    return today;
  }

  const afterDays = normalized.match(/بعد\\s+(\\d+)\\s*(يوم|ايام)/);
  if (afterDays) {
    today.setDate(today.getDate() + Number(afterDays[1]));
    return today;
  }

  const dayNames = [
    ['الاحد', 0],
    ['الاثنين', 1],
    ['الاتنين', 1],
    ['الثلاثاء', 2],
    ['الاربعاء', 3],
    ['الخميس', 4],
    ['الجمعه', 5],
    ['السبت', 6],
  ];
  const matchedDay = dayNames.find(([name]) => normalized.includes(String(name)));
  if (matchedDay) {
    const targetDay = Number(matchedDay[1]);
    let delta = (targetDay - today.getDay() + 7) % 7;
    if (delta === 0 || /القادم|الجاي|اللي جاي/.test(normalized)) delta = delta || 7;
    today.setDate(today.getDate() + delta);
    return today;
  }

  return null;
}
`,
'insert smart Arabic date parser'
);

replaceOnce(
'      const followups = followupsResult.value;\n',
`      const targetBranch = normalizeBranchName(branch);
      const followups = followupsResult.value.filter(
        (row) => normalizeBranchName(followupToItem(row).branch) === targetBranch
      );
`,
'filter loaded followups by selected branch'
);

replaceOnce(
`  async function postponeFollowup(item: QueueItem) {
    const date = window.prompt('اكتب موعد المتابعة القادمة بصيغة YYYY-MM-DD:');
    if (!date) return;
    const parsed = new Date(\`${'${date}'}T10:00:00\`);
    if (Number.isNaN(parsed.getTime()) || date < todayIso()) {
      toast.error('موعد التأجيل غير صحيح أو في الماضي');
      return;
    }
    try {
      const followup = await ensureFollowup(item);
      await updateFollowupResult(followup.id, {
        postponed_until: parsed.toISOString(),
        next_followup_date: parsed.toISOString(),
        needs_next_followup: true,
        status: 'مؤجل',
        followup_status: 'مؤجل',
        updated_by: user?.id || null,
      } as Parameters<typeof updateFollowupResult>[1]);
      await updateDailyQueueItem(item.queueItemId || '', {
        status: 'scheduled',
        nextFollowupDate: parsed.toISOString(),
      });
      await appendFollowupEvent({
        followupId: followup.id,
        queueItemId: item.queueItemId,
        eventType: 'scheduled',
        status: 'مؤجل',
        actorStaffId: user?.staffId || user?.id || null,
        actorName: user?.name || null,
        notes: \`تم التأجيل إلى ${'${date}'}\`,
      });
      toast.success(\`تم تأجيل المتابعة إلى ${'${date}'}\`);
      await loadWorkspace({ silent: true });
    } catch (error) {
      toast.error(\`تعذر تأجيل المتابعة: ${'${(error as Error).message}'}\`);
    }
  }
`,
`  async function postponeFollowup(item: QueueItem) {
    const input = window.prompt(
      'اكتب الموعد بطريقتك، مثل: السبت القادم، بكرة، بعد 3 أيام، أو 2026-07-25'
    );
    if (!input) return;
    const parsed = parseSmartFollowupDate(input);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (!parsed || parsed.getTime() < today.getTime()) {
      toast.error('لم أستطع فهم الموعد. اكتب مثلًا: السبت القادم أو بعد 3 أيام');
      return;
    }
    const date = localDateKey(parsed);
    try {
      const followup = await ensureFollowup(item);
      await updateFollowupResult(followup.id, {
        postponed_until: parsed.toISOString(),
        next_followup_date: parsed.toISOString(),
        needs_next_followup: true,
        status: 'مؤجل',
        followup_status: 'مؤجل',
        updated_by: user?.id || null,
      } as Parameters<typeof updateFollowupResult>[1]);
      await updateDailyQueueItem(item.queueItemId || '', {
        status: 'scheduled',
        nextFollowupDate: parsed.toISOString(),
      });
      try {
        await appendFollowupEvent({
          followupId: followup.id,
          queueItemId: item.queueItemId,
          eventType: 'scheduled',
          status: 'مؤجل',
          actorStaffId: user?.staffId || user?.id || null,
          actorName: user?.name || null,
          notes: \`تم التأجيل إلى ${'${date}'} — الإدخال: ${'${input}'}\`,
        });
      } catch (eventError) {
        console.warn('Followup postpone event logging skipped', eventError);
      }
      toast.success(\`تم تأجيل المتابعة إلى ${'${date}'}\`);
      await loadWorkspace({ silent: true });
    } catch (error) {
      toast.error(\`تعذر تأجيل المتابعة: ${'${(error as Error).message}'}\`);
    }
  }
`,
'replace rigid postponement prompt'
);

replaceOnce(
`      await appendFollowupEvent({
        followupId: followup.id,
        queueItemId: item.queueItemId,
        eventType: 'cancelled',
        status: 'ملغي',
        actorStaffId: user?.staffId || user?.id || null,
        actorName: user?.name || null,
        notes: reason,
      });
`,
`      try {
        await appendFollowupEvent({
          followupId: followup.id,
          queueItemId: item.queueItemId,
          eventType: 'cancelled',
          status: 'ملغي',
          actorStaffId: user?.staffId || user?.id || null,
          actorName: user?.name || null,
          notes: reason,
        });
      } catch (eventError) {
        console.warn('Followup cancellation event logging skipped', eventError);
      }
`,
'make cancellation independent from strict event actor lookup'
);

replaceOnce(
`  )
    .filter((item) => {
`,
`  )
    .filter((item) => normalizeBranchName(item.branch) === normalizeBranchName(branch))
    .filter((item) => {
`,
'enforce selected branch in every visible queue tab'
);

fs.writeFileSync(file, source, 'utf8');
console.log('Applied customer-service branch, smart-date, and cancellation fixes.');
