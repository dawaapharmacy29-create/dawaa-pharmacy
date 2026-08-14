const fs = require('fs');
function replaceOnce(src, oldText, newText, label) {
  if (!src.includes(oldText)) throw new Error(label + ' anchor not found');
  return src.replace(oldText, newText);
}

{
  const file = 'src/lib/api/customerRequestsCommandCenter.ts';
  let src = fs.readFileSync(file, 'utf8');
  src = replaceOnce(
    src,
    "export type CustomerRequestQuickFilter = 'all' | 'today' | 'recent' | 'attention' | 'overdue' | 'urgent' | 'unassigned' | 'unlinked' | 'sync_review' | 'backlog';",
    "export type CustomerRequestQuickFilter = 'all' | 'today' | 'recent' | 'attention' | 'followup_due' | 'overdue' | 'urgent' | 'unassigned' | 'unlinked' | 'sync_review' | 'backlog';",
    'quick filter type'
  );
  src = replaceOnce(
    src,
    "  let query = supabase.from('customer_requests').select('*', { count: 'exact' }).order('is_urgent', { ascending: false }).order('updated_at', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false, nullsFirst: false });",
    "  let query = supabase.from('customer_requests').select('*', { count: 'exact' });\n  if ((options.quickFilter || 'all') === 'followup_due') {\n    query = query.order('due_date', { ascending: true, nullsFirst: false }).order('is_urgent', { ascending: false });\n  } else {\n    query = query.order('is_urgent', { ascending: false }).order('updated_at', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false, nullsFirst: false });\n  }",
    'query ordering'
  );
  src = replaceOnce(
    src,
    "  if (quick === 'urgent') query = query.or('is_urgent.eq.true,urgency.eq.urgent,urgency.eq.high,priority.eq.high');",
    "  if (quick === 'followup_due') query = query.not('status', 'in', `(${CLOSED.join(',')})`).not('due_date', 'is', null).lte('due_date', new Date().toISOString());\n  if (quick === 'urgent') query = query.or('is_urgent.eq.true,urgency.eq.urgent,urgency.eq.high,priority.eq.high');",
    'due filter'
  );
  fs.writeFileSync(file, src);
}

{
  const file = 'src/pages/CustomerRequests.tsx';
  let src = fs.readFileSync(file, 'utf8');
  src = replaceOnce(
    src,
    "const QUICK_FILTERS: Array<{ value: CustomerRequestQuickFilter; label: string; description: string }> = [\n  { value: 'attention', label: 'يحتاج تدخل الآن', description: 'طلبات مفتوحة وحديثة' },",
    "const QUICK_FILTERS: Array<{ value: CustomerRequestQuickFilter; label: string; description: string }> = [\n  { value: 'followup_due', label: 'متابعات مستحقة الآن', description: 'مواعيد تواصل وصلت أو تأخرت' },\n  { value: 'attention', label: 'يحتاج تدخل الآن', description: 'طلبات مفتوحة وحديثة' },",
    'quick filter UI'
  );
  src = replaceOnce(
    src,
    "  const [quickFilter, setQuickFilter] = useState<CustomerRequestQuickFilter>(() => {\n    const value = searchParams.get('quick') as CustomerRequestQuickFilter | null;\n    return QUICK_FILTERS.some((item) => item.value === value) ? (value as CustomerRequestQuickFilter) : 'attention';\n  });",
    "  const [quickFilter, setQuickFilter] = useState<CustomerRequestQuickFilter>(() => {\n    const value = searchParams.get('quick') as CustomerRequestQuickFilter | null;\n    return QUICK_FILTERS.some((item) => item.value === value) ? (value as CustomerRequestQuickFilter) : 'followup_due';\n  });",
    'default quick filter'
  );
  src = replaceOnce(
    src,
    "    if (quickFilter !== 'attention') next.set('quick', quickFilter);",
    "    if (quickFilter !== 'followup_due') next.set('quick', quickFilter);",
    'url default quick filter'
  );
  src = replaceOnce(
    src,
    "        if (tab === 'requests') { setQuickFilter('attention'); setStatusFilter('all'); }",
    "        if (tab === 'requests') { setQuickFilter('followup_due'); setStatusFilter('all'); }",
    'requests tab default'
  );
  fs.writeFileSync(file, src);
}
