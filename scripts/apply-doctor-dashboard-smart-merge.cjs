const fs = require('fs');
const path = require('path');

function read(rel) {
  const file = path.join(process.cwd(), rel);
  if (!fs.existsSync(file)) throw new Error(`[doctor-smart-merge] missing ${rel}`);
  return { file, source: fs.readFileSync(file, 'utf8') };
}
function save(file, before, after, label) {
  if (after !== before) fs.writeFileSync(file, after);
  console.log(`[doctor-smart-merge] ${label}: changed=${after !== before}`);
}
function addAfter(source, anchor, addition, label) {
  if (source.includes(addition.trim())) return source;
  if (!source.includes(anchor)) throw new Error(`[doctor-smart-merge] anchor not found: ${label}`);
  return source.replace(anchor, `${anchor}${addition}`);
}
function replaceRequired(source, find, replacement, label) {
  if (source.includes(replacement.trim())) return source;
  const next = typeof find === 'string' ? source.replace(find, replacement) : source.replace(find, replacement);
  if (next === source) throw new Error(`[doctor-smart-merge] replacement not applied: ${label}`);
  return next;
}

// 1) Dynamic customer routes must never bypass the permission system.
{
  const { file, source: before } = read('src/lib/core/permissionSystem.ts');
  let source = before;
  if (!source.includes("pathname.startsWith('/customers/')")) {
    source = replaceRequired(
      source,
      "  if (pathname.startsWith('/staff/')) return ['view_staff_details'];\n  return undefined;",
      "  if (pathname.startsWith('/staff/')) return ['view_staff_details'];\n  if (pathname.startsWith('/customers/')) return ['view_customer_360'];\n  if (pathname.startsWith('/customer-health/')) return ['view_customer_details'];\n  return undefined;",
      'customer dynamic route permissions'
    );
  }
  save(file, before, source, 'permission routes');
}

// 2) One safe helper for notifying every active doctor/supervisor in a branch.
{
  const { file, source: before } = read('src/lib/staffNotificationService.ts');
  let source = before;
  if (!source.includes('export async function notifyBranchDoctors')) {
    const addition = `\n\nexport async function notifyBranchDoctors(\n  branch: string,\n  notification: Omit<CreateStaffNotificationInput, 'recipientStaffId'>\n): Promise<{ sent: number; failed: number }> {\n  const branchValue = text(branch);\n  if (!branchValue) return { sent: 0, failed: 0 };\n  const doctorRoles = [\n    'pharmacist', 'shift_supervisor_morning', 'shift_supervisor_evening',\n    'shift_supervisor_night', 'branch_manager', 'customer_service_manager'\n  ];\n  const { data, error } = await supabase\n    .from('staff_accounts')\n    .select('staff_id')\n    .eq('branch', branchValue)\n    .in('role', doctorRoles)\n    .eq('active', true)\n    .eq('can_login', true);\n  if (error || !data) return { sent: 0, failed: 0 };\n  const staffIds = [...new Set(data.map((row) => text((row as RawRow).staff_id)).filter(Boolean))];\n  const results = await Promise.allSettled(\n    staffIds.map((recipientStaffId) => createStaffNotification({ ...notification, recipientStaffId }))\n  );\n  return {\n    sent: results.filter((result) => result.status === 'fulfilled').length,\n    failed: results.filter((result) => result.status === 'rejected').length,\n  };\n}\n`;
    source = addAfter(source, "  return data ? mapRow(data as RawRow) : null;\n}", addition, 'notifyBranchDoctors');
  }
  save(file, before, source, 'branch notification helper');
}

// 3) Central employee reward/penalty notifications.
{
  const { file, source: before } = read('src/services/employeeTransactionService.ts');
  let source = before;
  if (!source.includes("from '@/lib/staffNotificationService'")) {
    source = source.replace(
      "import { TABLES } from '@/lib/supabaseTables';",
      "import { TABLES } from '@/lib/supabaseTables';\nimport { createStaffNotification } from '@/lib/staffNotificationService';"
    );
  }
  if (!source.includes('async function notifyTransaction')) {
    const anchor = "function logEmployeeTransactionsError(error: {";
    const index = source.indexOf(anchor);
    if (index < 0) throw new Error('[doctor-smart-merge] employee transaction helper anchor missing');
    const helper = `async function notifyTransaction(input: EmployeeTransactionInput, id?: string | null) {\n  if (!input.staff_id) return;\n  const isReward = input.type === 'reward';\n  const points = Math.abs(Number(input.points ?? input.points_delta ?? 0) || 0);\n  const amount = Math.abs(Number(input.amount ?? 0) || 0);\n  const impact = [points ? \\`${'${points}'} نقطة\\` : '', amount ? \\`${'${amount.toLocaleString(\'ar-EG\')}'} جنيه\\` : ''].filter(Boolean).join(' · ');\n  await createStaffNotification({\n    recipientStaffId: input.staff_id,\n    type: isReward ? 'reward' : 'penalty',\n    title: isReward ? 'مكافأة جديدة' : 'خصم مسجل على حسابك',\n    message: [input.reason || (isReward ? 'تم تسجيل مكافأة جديدة لك.' : 'تم تسجيل خصم على حسابك.'), impact].filter(Boolean).join(' — '),\n    priority: isReward ? 'normal' : 'high',\n    entityType: 'employee_transaction',\n    entityId: id || undefined,\n    actionUrl: '/doctor-dashboard?tab=activity',\n    metadata: { points, amount, transactionType: input.type },\n  }).catch(() => null);\n}\n\n`;
    source = source.slice(0, index) + helper + source.slice(index);
  }
  source = source.replace(
    "  if (!result.error) return result;",
    "  if (!result.error) {\n    void notifyTransaction(input, result.data?.id as string | undefined);\n    return result;\n  }"
  );
  source = source.replace(
    "    if (retry.error) {\n      logEmployeeTransactionsError(retry.error);\n      logSupabaseError('create employee transaction', retry.error);\n    }\n    return retry;",
    "    if (retry.error) {\n      logEmployeeTransactionsError(retry.error);\n      logSupabaseError('create employee transaction', retry.error);\n    } else {\n      void notifyTransaction(input, retry.data?.id as string | undefined);\n    }\n    return retry;"
  );
  save(file, before, source, 'employee transaction notifications');
}

// 4) Review notification opens the doctor's own review details.
{
  const { file, source: before } = read('src/pages/Reviews.tsx');
  let source = before.replace(
    "target_route: reviewRowId ? `/reviews?id=${reviewRowId}` : '/reviews',",
    "target_route: reviewRowId ? `/doctor-dashboard?tab=reviews&reviewId=${reviewRowId}` : '/doctor-dashboard?tab=reviews',"
  );
  save(file, before, source, 'review notification route');
}
{
  const { file, source: before } = read('src/components/doctor/DoctorReviewDetails.tsx');
  let source = before;
  if (!source.includes('useSearchParams')) {
    source = source.replace(
      "import { ChevronDown, ChevronUp, ExternalLink, Image as ImageIcon, RefreshCw } from 'lucide-react';",
      "import { ChevronDown, ChevronUp, ExternalLink, Image as ImageIcon, RefreshCw } from 'lucide-react';\nimport { useSearchParams } from 'react-router-dom';"
    );
  }
  if (!source.includes("const focusReviewId = text(searchParams.get('reviewId'))")) {
    source = source.replace(
      "  const staffId = text(user?.staffId);",
      "  const staffId = text(user?.staffId);\n  const [searchParams] = useSearchParams();\n  const focusReviewId = text(searchParams.get('reviewId'));"
    );
    source = source.replace(
      "  const [openId, setOpenId] = useState<string | null>(null);",
      "  const [openId, setOpenId] = useState<string | null>(focusReviewId || null);"
    );
    source = source.replace(
      "  useEffect(() => { void load(); }, [load]);",
      "  useEffect(() => { void load(); }, [load]);\n\n  useEffect(() => {\n    if (!focusReviewId || !rows.some((row) => text(row.id) === focusReviewId)) return;\n    setOpenId(focusReviewId);\n    requestAnimationFrame(() => document.getElementById(`review-${focusReviewId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));\n  }, [focusReviewId, rows]);"
    );
    source = source.replace(
      'return <article key={id} className="rounded-2xl border border-slate-700 bg-slate-950/40 p-4">',
      'return <article key={id} id={`review-${id}`} className="scroll-mt-24 rounded-2xl border border-slate-700 bg-slate-950/40 p-4">'
    );
  }
  save(file, before, source, 'doctor review deep link');
}

// 5) Shift note notification to the whole branch doctor team.
{
  const { file, source: before } = read('src/pages/ShiftNotes.tsx');
  let source = before;
  if (!source.includes("notifyBranchDoctors")) {
    source = source.replace(
      "import { selectableStaffChoices } from '@/lib/staffFallback';",
      "import { selectableStaffChoices } from '@/lib/staffFallback';\nimport { notifyBranchDoctors } from '@/lib/staffNotificationService';"
    );
    const anchor = "    if (!editing) await createOccurrences(data.id);";
    const addition = `\n    if (!editing && data.branch) {\n      void notifyBranchDoctors(String(data.branch), {\n        type: 'shift_note',\n        title: 'ملاحظة شيفت جديدة في فرعك',\n        message: data.title || 'تم تسجيل ملاحظة شيفت جديدة في فرعك.',\n        priority: data.priority === 'urgent' || data.priority === 'high' ? 'high' : 'normal',\n        entityType: 'shift_note', entityId: String(data.id), actionUrl: '/shift-notes',\n        metadata: { branch: data.branch, priority: data.priority },\n      }).catch(() => null);\n    }`;
    source = addAfter(source, anchor, addition, 'shift note notification');
  }
  save(file, before, source, 'shift note notifications');
}

// 6) Stagnant medicine sale notification to the responsible doctor.
{
  const { file, source: before } = read('src/pages/StagnantMedicines.tsx');
  let source = before;
  if (!source.includes("from '@/lib/staffNotificationService'")) {
    source = source.replace(
      "import { persistPointsTransaction } from '@/lib/pointsPersistence';",
      "import { persistPointsTransaction } from '@/lib/pointsPersistence';\nimport { createStaffNotification } from '@/lib/staffNotificationService';"
    );
  }
  if (!source.includes("type: 'stagnant_sale'")) {
    const anchor = "    // Log activity";
    const addition = `    if (dispenseForm.doctor_id) {\n      void createStaffNotification({\n        recipientStaffId: dispenseForm.doctor_id, type: 'stagnant_sale',\n        title: 'تم تسجيل بيع صنف راكد باسمك',\n        message: totalIncentive ? \\`${'${quantity}'} × ${'${productName}'} — حافزك ${'${totalIncentive.toFixed(0)}'} جنيه.\\` : \\`${'${quantity}'} × ${'${productName}'}.\\`,\n        priority: 'normal', entityType: 'stagnant_medicine_dispense',\n        entityId: insertedDispense?.id || undefined, actionUrl: '/doctor-dashboard?tab=requirements',\n        metadata: { quantity, productName, incentive: totalIncentive },\n      }).catch(() => null);\n    }\n\n`;
    if (!source.includes(anchor)) throw new Error('[doctor-smart-merge] stagnant activity anchor missing');
    source = source.replace(anchor, addition + anchor);
  }
  save(file, before, source, 'stagnant sale notification');
}

// 7) Doctor dashboard: real target, achieved, remaining, projection and logout.
{
  const { file, source: before } = read('src/pages/DoctorDashboardStable.tsx');
  let source = before;
  source = source.replace('MoreHorizontal, RefreshCw, ShieldCheck,', 'LogOut, MoreHorizontal, RefreshCw, ShieldCheck,');
  source = source.replace("import { useSearchParams } from 'react-router-dom';", "import { useNavigate, useSearchParams } from 'react-router-dom';");
  source = source.replace(/const BRANCH_TARGETS:[^\n]+\n/, '');
  source = source.replace(/function branchTarget\([^\n]+\n/, 'function branchTargetFallback(sales: number) { return Math.max(sales * 1.25, 1); }\n');
  source = source.replace('  const { user } = useAuth();', '  const { user, logout } = useAuth();\n  const navigate = useNavigate();');
  if (!source.includes('const [branchTargetAmount, setBranchTargetAmount]')) {
    source = source.replace(
      '  const [moreOpen, setMoreOpen] = useState(false);',
      '  const [moreOpen, setMoreOpen] = useState(false);\n  const [branchTargetAmount, setBranchTargetAmount] = useState<number | null>(null);'
    );
  }
  if (!source.includes('const loadBranchTarget = useCallback')) {
    const anchor = '  const setPart = (key: string, value: LoadState) => setPersonalState((current) => ({ ...current, [key]: value }));';
    const addition = `\n\n  const loadBranchTarget = useCallback(async () => {\n    if (!branch) return;\n    const normalized = normalizeBranchName(branch);\n    const { data } = await supabase.from('branch_sales_targets').select('*').eq('active', true);\n    const match = (data || []).find((row: Row) => normalizeBranchName(text(row.branch_name ?? row.branch)) === normalized);\n    const amount = number(match?.target_amount ?? match?.monthly_target ?? match?.target);\n    setBranchTargetAmount(amount > 0 ? amount : null);\n  }, [branch]);`;
    source = addAfter(source, anchor, addition, 'branch target loader');
  }
  if (!source.includes('void loadBranchTarget()')) {
    source = source.replace('  useEffect(() => { void load(); }, [load]);', '  useEffect(() => { void load(); }, [load]);\n  useEffect(() => { void loadBranchTarget(); }, [loadBranchTarget]);');
  }
  source = source.replace('  const target = branchTarget(branch, branchSales);', '  const target = branchTargetAmount ?? branchTargetFallback(branchSales);');
  if (!source.includes('const projectedTotal =')) {
    source = source.replace(
      '  const achievement = target ? branchSales / target * 100 : 0;',
      `  const achievement = target ? branchSales / target * 100 : 0;\n  const cycleTotalDays = Math.max(1, Math.round((cycle.end.getTime() - cycle.start.getTime()) / 86400000) + 1);\n  const cycleDaysElapsed = Math.min(cycleTotalDays, Math.max(1, Math.floor((Date.now() - cycle.start.getTime()) / 86400000) + 1));\n  const dailyAveragePace = branchSales / cycleDaysElapsed;\n  const projectedTotal = dailyAveragePace * cycleTotalDays;\n  const projectedVsTarget = target ? projectedTotal / target * 100 : 0;`
    );
  }
  if (!source.includes('aria-label="تسجيل الخروج"')) {
    source = source.replace(
      /<button\s+type="button" onClick=\{\(\) => \{ void load\(\); void loadNotifications\(\); \}\} disabled=\{state === 'loading'\}[\s\S]*?<\/button>/,
      `<div className="absolute left-4 top-4 flex items-center gap-2">\n          <button type="button" onClick={() => { void load(); void loadNotifications(); void loadBranchTarget(); }} disabled={state === 'loading'} className="rounded-full p-2 text-teal-300 transition disabled:opacity-50" style={{ background: 'rgba(0,0,0,0.2)' }}>\n            <RefreshCw size={16} className={state === 'loading' ? 'animate-spin' : ''} />\n          </button>\n          <button type="button" onClick={async () => { await logout(); navigate('/login'); }} className="rounded-full p-2 text-red-300 transition" style={{ background: 'rgba(0,0,0,0.2)' }} aria-label="تسجيل الخروج">\n            <LogOut size={16} />\n          </button>\n        </div>`
    );
  }
  if (!source.includes('لو استمرينا بنفس المعدل')) {
    source = source.replace(
      /<div className="mt-4 flex items-center justify-between rounded-xl px-3 py-2\.5 text-xs font-bold"[\s\S]*?<\/div>\n\s*<\/section>/,
      `<div className="mt-4 grid grid-cols-2 gap-2 rounded-xl p-3 text-xs font-bold sm:grid-cols-4" style={{ background: 'rgba(0,0,0,0.18)' }}>\n          <div><div className="text-slate-400">تارجت الفرع{branchTargetAmount === null ? ' (تقديري)' : ''}</div><div className="mt-0.5 text-sm font-black text-white">{formatCurrency(target)}</div></div>\n          <div><div className="text-slate-400">المحقق حتى الآن</div><div className="mt-0.5 text-sm font-black text-teal-300">{formatCurrency(branchSales)}</div></div>\n          <div><div className="text-slate-400">المتبقي</div><div className="mt-0.5 text-sm font-black text-amber-200">{formatCurrency(Math.max(0, target - branchSales))}</div></div>\n          <div><div className="text-slate-400">لو استمرينا بنفس المعدل</div><div className={\`mt-0.5 text-sm font-black ${'${projectedVsTarget >= 100 ? \'text-emerald-300\' : \'text-red-300\'}'}\`}>{formatCurrency(projectedTotal)}</div></div>\n        </div>\n        <p className="mt-2 text-[10px] font-bold text-slate-400">بمعدل {formatCurrency(dailyAveragePace)}/يوم خلال {cycleDaysElapsed} من {cycleTotalDays} يوم — {projectedVsTarget >= 100 ? 'في الطريق لتحقيق التارجت' : \`متوقع أقل من التارجت بـ ${'${formatCurrency(Math.max(0, target - projectedTotal))}'}\`}</p>\n      </section>`
    );
  }
  for (const required of ['branchTargetAmount', 'loadBranchTarget', 'projectedTotal', 'لو استمرينا بنفس المعدل', 'aria-label="تسجيل الخروج"']) {
    if (!source.includes(required)) throw new Error(`[doctor-smart-merge] dashboard missing ${required}`);
  }
  save(file, before, source, 'doctor dashboard target and logout');
}

// 8) Competition: preserve current data logic, add a clear logout action and improve mobile table usability.
{
  const { file, source: before } = read('src/pages/DoctorCompetition.tsx');
  let source = before;
  source = source.replace('Download, RefreshCw, Trophy', 'Download, LogOut, RefreshCw, Trophy');
  source = source.replace("import { useSearchParams } from 'react-router-dom';", "import { useNavigate, useSearchParams } from 'react-router-dom';");
  source = source.replace('  const { user } = useAuth();', '  const { user, logout } = useAuth();\n  const navigate = useNavigate();');
  if (!source.includes('aria-label="تسجيل الخروج"')) {
    source = source.replace(
      '<button type="button" onClick={() => void load()} disabled={loading} className="btn-primary disabled:opacity-50"><RefreshCw',
      '<button type="button" onClick={async () => { await logout(); navigate(\'/login\'); }} className="btn-secondary text-red-200" aria-label="تسجيل الخروج"><LogOut className="ml-1 inline h-4 w-4" /> خروج</button><button type="button" onClick={() => void load()} disabled={loading} className="btn-primary disabled:opacity-50"><RefreshCw'
    );
  }
  source = source.replace('className="w-full min-w-[1250px] text-right text-sm"', 'className="w-full min-w-[1050px] text-right text-sm"');
  save(file, before, source, 'competition logout and responsive table');
}

console.log('[doctor-smart-merge] all smart merge checks passed');
