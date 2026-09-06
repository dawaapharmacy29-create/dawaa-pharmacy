const fs = require('fs');

function patchSchedule() {
  const path = 'src/pages/Schedule.tsx';
  let s = fs.readFileSync(path, 'utf8');
  s = s.replace("import { useState } from 'react';", "import { useEffect, useState } from 'react';");
  const anchor = "import { toast } from 'sonner';";
  const addition = "import { listStaffTimeOffRequests, type StaffTimeOffRequest } from '@/lib/timeOffService';";
  if (!s.includes(addition)) s = s.replace(anchor, `${anchor}\n${addition}`);

  s = s.replace(/interface ShiftException \{[\s\S]*?\n\}\n\nconst ROLE_COLORS/, 'const ROLE_COLORS');

  const oldQuery = `  const { data: exceptions } = useSupabaseQuery<ShiftException>({\n    table: 'shift_exceptions',\n    filters: [{ column: 'status', operator: 'eq', value: 'approved' }],\n    realtimeEnabled: true,\n  });`;
  const newQuery = `  const [exceptions, setExceptions] = useState<StaffTimeOffRequest[]>([]);\n  useEffect(() => {\n    let alive = true;\n    void listStaffTimeOffRequests({ status: 'approved', limit: 300 })\n      .then((rows) => { if (alive) setExceptions(rows); })\n      .catch((error) => console.warn('[Schedule] canonical time-off unavailable', error));\n    return () => { alive = false; };\n  }, []);`;
  if (!s.includes(oldQuery)) throw new Error('Schedule legacy exception query anchor not found');
  s = s.replace(oldQuery, newQuery);

  const oldPredicate = `    const exception = exceptions?.find(\n      (item) =>\n        item.staff_name === emp.name &&\n        normalizeBranch(item.branch) === normalizeBranch(emp.branch) &&\n        item.status === 'approved' &&\n        (item.type.includes('إجازة') || item.type === 'غياب') &&\n        ((item.date &&\n          item.date <= targetDateStr &&\n          (!item.date_end || item.date_end >= targetDateStr)) ||\n          item.day_name === day)\n    );`;
  const newPredicate = `    const exception = exceptions.find(\n      (item) =>\n        item.staff_id === emp.id &&\n        normalizeBranch(item.branch_snapshot) === normalizeBranch(emp.branch) &&\n        item.status === 'approved' &&\n        ['annual_leave', 'sick_leave', 'exceptional_leave', 'approved_absence'].includes(item.request_kind) &&\n        item.start_date <= targetDateStr &&\n        item.end_date >= targetDateStr\n    );`;
  if (!s.includes(oldPredicate)) throw new Error('Schedule legacy exception predicate anchor not found');
  s = s.replace(oldPredicate, newPredicate);
  fs.writeFileSync(path, s);
}

function patchStaffDetail() {
  const path = 'src/lib/staffDetailLoader.ts';
  let s = fs.readFileSync(path, 'utf8');
  const anchor = "import type { PharmacyCycle } from '@/lib/pharmacy-cycle';";
  const addition = "import { listStaffTimeOffRequests } from '@/lib/timeOffService';";
  if (!s.includes(addition)) s = s.replace(anchor, `${anchor}\n${addition}`);
  const oldBlock = `      const timeOffRes = await supabase\n        .from('shift_exceptions')\n        .select('*')\n        .eq('staff_id', args.staffId)\n        .order('date', { ascending: false })\n        .limit(80);\n      return {\n        schedule: (scheduleRes.data || []) as Record<string, unknown>[],\n        timeOff: (timeOffRes.data || []) as Record<string, unknown>[],\n      };`;
  const newBlock = `      const timeOff = await listStaffTimeOffRequests({\n        staffId: args.staffId,\n        from: cycleStart,\n        to: args.cycle.end.toISOString().slice(0, 10),\n        limit: 80,\n      });\n      return {\n        schedule: (scheduleRes.data || []) as Record<string, unknown>[],\n        timeOff: timeOff as unknown as Record<string, unknown>[],\n      };`;
  if (!s.includes(oldBlock)) throw new Error('staffDetailLoader legacy time-off anchor not found');
  s = s.replace(oldBlock, newBlock);
  fs.writeFileSync(path, s);
}

patchSchedule();
patchStaffDetail();
console.log('Canonical time-off readers wired.');
