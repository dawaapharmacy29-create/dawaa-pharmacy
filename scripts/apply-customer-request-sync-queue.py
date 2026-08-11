from pathlib import Path


def patch(path: str, replacements):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    for label, old, new in replacements:
        if new in text:
            print(f'{label}: already applied')
            continue
        if old not in text:
            raise SystemExit(f'{label}: source not found')
        text = text.replace(old, new, 1)
        print(f'{label}: applied')
    p.write_text(text, encoding='utf-8')

patch('src/lib/api/customerRequestsCommandCenter.ts', [
    (
        'quick filter type',
        "export type CustomerRequestQuickFilter = 'all' | 'today' | 'recent' | 'attention' | 'overdue' | 'urgent' | 'unassigned' | 'unlinked' | 'backlog';",
        "export type CustomerRequestQuickFilter = 'all' | 'today' | 'recent' | 'attention' | 'overdue' | 'urgent' | 'unassigned' | 'unlinked' | 'sync_review' | 'backlog';",
    ),
    (
        'sync review query',
        "  if (quick === 'unassigned') query = query.is('purchasing_assignee', null).is('source_assigned_employee', null);\n  if (quick === 'backlog') {",
        "  if (quick === 'unassigned') query = query.is('purchasing_assignee', null).is('source_assigned_employee', null);\n  if (quick === 'sync_review') query = query.eq('sync_conflict', true).eq('sync_conflict_reason', 'branch_unresolved_after_customer_match');\n  if (quick === 'backlog') {",
    ),
])

patch('src/pages/CustomerRequests.tsx', [
    (
        'sync review quick filter',
        "  { value: 'unlinked', label: 'عميل غير مربوط', description: 'جودة بيانات' },\n  { value: 'backlog', label: 'الطلبات القديمة', description: 'أقدم من 7 أيام' },",
        "  { value: 'unlinked', label: 'عميل غير مربوط', description: 'جودة بيانات' },\n  { value: 'sync_review', label: 'يحتاج تحديد فرع', description: 'طلبات مزامنة لم يُحسم فرعها' },\n  { value: 'backlog', label: 'الطلبات القديمة', description: 'أقدم من 7 أيام' },",
    ),
])

print('customer request sync review queue patch prepared')
