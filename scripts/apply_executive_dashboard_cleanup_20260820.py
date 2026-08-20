from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected 1 exact match, found {count}")
    return text.replace(old, new, 1)


def regex_once(text: str, pattern: str, repl: str, label: str) -> str:
    out, count = re.subn(pattern, repl, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"{label}: expected 1 regex match, found {count}")
    return out


# -----------------------------------------------------------------------------
# 1) Current shift presence: prefer canonical linked schedules, ignore inactive
#    staff, and classify assistant pharmacists before doctor/pharmacist matching.
# -----------------------------------------------------------------------------
p = ROOT / "src/lib/attendance/currentShiftPresenceService.ts"
text = p.read_text(encoding="utf-8")

text = replace_once(
    text,
    "type AttendanceRow = {\n",
    "type StaffMasterRow = {\n  id?: string | null;\n  name?: string | null;\n  status?: string | null;\n  active?: boolean | null;\n  is_active?: boolean | null;\n  visible_in_schedule?: boolean | null;\n};\n\ntype AttendanceRow = {\n",
    "add staff master type",
)

text = replace_once(
    text,
    "  if (/صيد|دكتور|pharmacist|doctor/.test(r) || /^د\\s*\\/?/.test(n) || n.startsWith('د '))\n    return 'doctors';\n  if (/توصيل|دليفري|delivery|rider/.test(r)) return 'delivery';\n  if (/مساعد|assistant/.test(r)) return 'assistants';\n",
    "  if (/مساعد|assistant/.test(r)) return 'assistants';\n  if (/توصيل|دليفري|delivery|rider/.test(r)) return 'delivery';\n  if (/صيد|دكتور|pharmacist|doctor/.test(r) || /^د\\s*\\/?/.test(n) || n.startsWith('د '))\n    return 'doctors';\n",
    "assistant classification priority",
)

old = """  const rawSchedules = [...byDate, ...byDay].filter((row) => {\n    if (row.is_off || normalizeText(row.status).includes('اجازه')) return false;\n    if (normalizeText(row.day_name) && normalizeText(row.day_name) !== normalizeText(todayArabic)) {\n      if (String(row.shift_date || row.date || '').slice(0, 10) !== todayStr) return false;\n    }\n    return isShiftActive(row.shift_start || row.start_time, row.shift_end || row.end_time);\n  });\n\n  const scheduleMap = new Map<string, ShiftScheduleRow>();\n  rawSchedules.forEach((row) => {\n"""
new = """  const rawSchedules = [...byDate, ...byDay].filter((row) => {\n    if (row.is_off || normalizeText(row.status).includes('اجازه')) return false;\n    if (normalizeText(row.day_name) && normalizeText(row.day_name) !== normalizeText(todayArabic)) {\n      if (String(row.shift_date || row.date || '').slice(0, 10) !== todayStr) return false;\n    }\n    return isShiftActive(row.shift_start || row.start_time, row.shift_end || row.end_time);\n  });\n\n  // Current truth rules:\n  // 1) If a person has a linked staff_id schedule, ignore old unlinked imported copies.\n  // 2) Never surface schedules for staff explicitly inactive/hidden in the staff master.\n  // This preserves all historical schedule rows while preventing stale copies from appearing now.\n  const staffMasterRows = await safeSelect<StaffMasterRow>(\n    'staff',\n    'id,name,status,active,is_active,visible_in_schedule',\n    (query) => query.limit(1000)\n  );\n  const inactiveIds = new Set(\n    staffMasterRows\n      .filter((row) =>\n        row.active === false ||\n        row.is_active === false ||\n        row.visible_in_schedule === false ||\n        /غير نشط|inactive|disabled|موقوف/.test(normalizeText(row.status))\n      )\n      .map((row) => String(row.id || '').trim())\n      .filter(Boolean)\n  );\n  const inactiveNames = new Set(\n    staffMasterRows\n      .filter((row) =>\n        row.active === false ||\n        row.is_active === false ||\n        row.visible_in_schedule === false ||\n        /غير نشط|inactive|disabled|موقوف/.test(normalizeText(row.status))\n      )\n      .map((row) => normalizeDoctorName(row.name))\n      .filter(Boolean)\n  );\n  const linkedNames = new Set(\n    rawSchedules\n      .filter((row) => String(row.staff_id || '').trim())\n      .map((row) => normalizeDoctorName(row.staff_name))\n      .filter(Boolean)\n  );\n  const currentSchedules = rawSchedules.filter((row) => {\n    const id = String(row.staff_id || '').trim();\n    const nameKey = normalizeDoctorName(row.staff_name);\n    if (id && inactiveIds.has(id)) return false;\n    if (!id && inactiveNames.has(nameKey)) return false;\n    if (!id && linkedNames.has(nameKey)) return false;\n    return true;\n  });\n\n  const scheduleMap = new Map<string, ShiftScheduleRow>();\n  currentSchedules.forEach((row) => {\n"""
text = replace_once(text, old, new, "canonical current schedules")
p.write_text(text, encoding="utf-8")


# -----------------------------------------------------------------------------
# 2) Dashboard sales truth: monthly chart must not use stale daily cache.
#    Aggregate each month through the same raw sales summary RPC used for KPI truth.
# -----------------------------------------------------------------------------
p = ROOT / "src/lib/dashboard/dashboardTruthService.ts"
text = p.read_text(encoding="utf-8")

anchor = """function numberRow(row: RpcRow, key: string) {\n  return dashboardNumber(row[key]);\n}\n\n"""
helper = """function numberRow(row: RpcRow, key: string) {\n  return dashboardNumber(row[key]);\n}\n\nfunction monthKey(date: Date) {\n  const year = date.getFullYear();\n  const month = String(date.getMonth() + 1).padStart(2, '0');\n  return `${year}-${month}`;\n}\n\nasync function fetchMonthlySalesFromTruth(endDate: string, branch: string, months = 5): Promise<RpcRow[]> {\n  const anchor = new Date(`${endDate}T12:00:00`);\n  if (Number.isNaN(anchor.getTime())) return [];\n  const jobs = Array.from({ length: Math.max(1, months) }, (_, index) => {\n    const monthDate = new Date(anchor.getFullYear(), anchor.getMonth() - (months - 1 - index), 1, 12, 0, 0);\n    const key = monthKey(monthDate);\n    const start = `${key}-01`;\n    const lastDay = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0, 12, 0, 0);\n    const naturalEnd = `${monthKey(lastDay)}-${String(lastDay.getDate()).padStart(2, '0')}`;\n    const end = key === endDate.slice(0, 7) && endDate < naturalEnd ? endDate : naturalEnd;\n    return { key, start, end };\n  });\n\n  return Promise.all(\n    jobs.map(async ({ key, start, end }) => {\n      const summaryRows = await rpcRows<RpcRow>('get_dashboard_sales_summary_v171', {\n        p_start: start,\n        p_end: end,\n        p_branch: branch,\n      });\n      const summary = summaryRows[0] || {};\n      const invoices = numberRow(summary, 'invoices_count');\n      const sales = numberRow(summary, 'sales_total');\n      return {\n        month_start: `${key}-01`,\n        month_label: key,\n        branch,\n        sales_total: sales,\n        invoices_count: invoices,\n        avg_invoice: invoices ? sales / invoices : 0,\n      };\n    })\n  );\n}\n\n"""
text = replace_once(text, anchor, helper, "monthly truth helper")

text = replace_once(
    text,
    "    rpcRows<RpcRow>('get_dashboard_monthly_sales_v171', { p_end: params.endDate, p_branch: branch, p_months: 6 }),\n",
    "    fetchMonthlySalesFromTruth(params.endDate, branch, 5),\n",
    "replace stale monthly cache rpc",
)
p.write_text(text, encoding="utf-8")


# -----------------------------------------------------------------------------
# 3) Executive dashboard: make it an executive command center, remove duplicate
#    detailed domains, lazy-load diagnostics, keep one smart current-presence view.
# -----------------------------------------------------------------------------
p = ROOT / "src/pages/ExecutiveDashboard2027.tsx"
text = p.read_text(encoding="utf-8")

text = replace_once(
    text,
    "  const [dataHealthRetryToken, setDataHealthRetryToken] = useState(0);\n",
    "  const [dataHealthRetryToken, setDataHealthRetryToken] = useState(0);\n  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);\n",
    "diagnostics state",
)

text = replace_once(
    text,
    "  useEffect(() => {\n    let mounted = true;\n    setDataHealthLoading(true);\n",
    "  useEffect(() => {\n    if (!diagnosticsOpen) return;\n    let mounted = true;\n    setDataHealthLoading(true);\n",
    "lazy data health",
)
text = replace_once(text, "  }, [dataHealthRetryToken]);\n", "  }, [dataHealthRetryToken, diagnosticsOpen]);\n", "data health deps")

# Do not fetch customer-service dashboard analytics here; dedicated page owns them.
text = regex_once(
    text,
    r"\n\s*// CUSTOMER SERVICE block\n.*?\n\s*// ensure inventory section is marked as loaded for static operations cards\n",
    "\n      // Customer-service analytics live in /customer-service. Avoid duplicate Supabase work here.\n      setCustomerServiceLoading(false);\n      setCustomerServiceLoadedAt(new Date().toISOString());\n      setState((prev) => ({ ...prev, customerService: null, customerServiceOwners: [], staffOps: null }));\n\n      // ensure inventory section is marked as loaded for static operations cards\n",
    "remove duplicate customer-service load",
)

# Do not fetch incentive ledger for dashboard; dedicated incentive pages own it.
text = regex_once(
    text,
    r"\n\s*// INCENTIVES block\n.*?\n\s*// STAFF ATTENDANCE block",
    "\n      // Detailed incentive ledger belongs to the points/incentives workspace.\n      setIncentivesLoading(false);\n      setIncentivesLoadedAt(new Date().toISOString());\n\n      // STAFF ATTENDANCE block",
    "remove duplicate incentive load",
)

# Assistant must not be classified as doctor just because role contains صيدلي.
old_role = """function roleGroup(role: unknown) {\n  const normalized = normalizeText(role);\n  if (\n    normalized.includes('توصيل') ||\n    normalized.includes('دليفري') ||\n    normalized.includes('delivery')\n  )\n    return 'delivery';\n  if (\n    normalized.includes('صيد') ||\n    normalized.includes('دكتور') ||\n    normalized.includes('doctor') ||\n    normalized.includes('pharmacist')\n  )\n    return 'doctor';\n  return 'other';\n}\n"""
new_role = """function roleGroup(role: unknown) {\n  const normalized = normalizeText(role);\n  if (normalized.includes('مساعد') || normalized.includes('assistant')) return 'assistant';\n  if (\n    normalized.includes('توصيل') ||\n    normalized.includes('دليفري') ||\n    normalized.includes('delivery')\n  )\n    return 'delivery';\n  if (\n    normalized.includes('صيد') ||\n    normalized.includes('دكتور') ||\n    normalized.includes('doctor') ||\n    normalized.includes('pharmacist')\n  )\n    return 'doctor';\n  return 'other';\n}\n"""
text = replace_once(text, old_role, new_role, "assistant dashboard role")

text = replace_once(
    text,
    "  const onShiftDelivery = useMemo(\n    () => groupedOnShiftNow.filter((member) => roleGroup(member.role) === 'delivery'),\n    [groupedOnShiftNow]\n  );\n",
    "  const onShiftAssistants = useMemo(\n    () => groupedOnShiftNow.filter((member) => roleGroup(member.role) === 'assistant'),\n    [groupedOnShiftNow]\n  );\n  const onShiftDelivery = useMemo(\n    () => groupedOnShiftNow.filter((member) => roleGroup(member.role) === 'delivery'),\n    [groupedOnShiftNow]\n  );\n",
    "assistant presence list",
)

# Keep navigation cards decision-oriented only.
text = regex_once(
    text,
    r"  const navCards = \[.*?\n  \];\n\n  if \(!canViewExecutive\)",
    """  const navCards = [\n    {\n      id: 'branch-performance',\n      title: 'أداء الفروع',\n      value: getSectionValue({\n        value: `${branchPerformance.length || 0} فرع`,\n        loading: branchPerformanceLoading,\n        error: branchPerformanceError,\n        loadedAt: branchPerformanceLoadedAt,\n      }),\n      tone: 'cyan' as const,\n    },\n    {\n      id: 'doctor-competitions',\n      title: 'مسابقة الدكاترة',\n      value: doctorCompetitionLoading ? 'تحميل' : doctorCompetitionError ? 'مراجعة' : 'Top 5',\n      tone: 'amber' as const,\n    },\n  ];\n\n  if (!canViewExecutive)""",
    "simplify nav cards",
)

# Replace duplicate top presence with one smart section including assistants.
presence = """        <Panel className=\"p-5\">\n          <SectionTitle\n            title=\"الموجودون الآن\"\n            subtitle=\"عرض واحد ذكي للحضور الحالي حسب الدور والفرع — التفاصيل الكاملة في صفحة الحضور\"\n            icon={<Clock3 className=\"h-5 w-5\" />}\n          />\n          <div className=\"mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4\">\n            <MiniBox label=\"إجمالي الموجودين\" value={count(groupedOnShiftNow.length)} tone=\"cyan\" />\n            <MiniBox label=\"صيادلة\" value={count(onShiftDoctors.length)} tone=\"green\" />\n            <MiniBox label=\"مساعدون\" value={count(onShiftAssistants.length)} tone=\"blue\" />\n            <MiniBox label=\"دليفري\" value={count(onShiftDelivery.length)} tone=\"amber\" />\n          </div>\n          <div className=\"grid gap-4 xl:grid-cols-3\">\n            {[\n              { label: 'الدكاترة والصيادلة', rows: onShiftDoctors, tone: 'cyan' },\n              { label: 'مساعدو الصيدلي', rows: onShiftAssistants, tone: 'emerald' },\n              { label: 'الدليفري', rows: onShiftDelivery, tone: 'amber' },\n            ].map((group) => (\n              <div key={group.label} className=\"rounded-2xl border border-cyan-300/10 bg-slate-950/45 p-4\">\n                <div className=\"mb-3 flex items-center justify-between\">\n                  <h3 className=\"font-black text-white\">{group.label}</h3>\n                  <span className=\"rounded-full bg-cyan-400/10 px-3 py-1 text-xs font-black text-cyan-100\">{count(group.rows.length)}</span>\n                </div>\n                <div className=\"space-y-2\">\n                  {group.rows.length ? group.rows.slice(0, 12).map((member) => (\n                    <button\n                      key={`${staffId(member)}-${staffName(member)}-${branchName(member.branch)}`}\n                      onClick={() => void navigateToStaff(staffName(member), member.branch)}\n                      className=\"w-full rounded-xl border border-cyan-300/10 bg-slate-900/75 px-3 py-2 text-right text-xs hover:bg-cyan-400/10\"\n                    >\n                      <div className=\"flex items-start justify-between gap-2\">\n                        <div>\n                          <b className=\"block text-white\">{roleGroup(member.role) === 'doctor' ? normalizeDoctorName(staffName(member)) : staffName(member)}</b>\n                          <span className=\"text-slate-400\">{branchName(member.branch)} · {String(member.role || 'فريق')}</span>\n                        </div>\n                        <span className=\"text-cyan-200\">\n                          {member.shifts.map((shift, index) => (\n                            <span key={index}>{index > 0 ? '، ' : ''}<ShiftTimeRange shift={shift} /></span>\n                          ))}\n                        </span>\n                      </div>\n                    </button>\n                  )) : (\n                    <p className=\"rounded-xl bg-slate-900/60 p-4 text-center text-xs font-bold text-slate-500\">لا يوجد أحد حاليًا.</p>\n                  )}\n                </div>\n              </div>\n            ))}\n          </div>\n        </Panel>\n\n        {!!state.errors.length"""
text = regex_once(
    text,
    r"        <Panel className=\"p-5\">\n          <SectionTitle\n            title=\"الموجودون حاليا في الشيفت\".*?\n        </Panel>\n\n        \{!!state\.errors\.length",
    presence,
    "smart current presence",
)

# Technical sales reconciliation is only visible when diagnostics are expanded.
text = replace_once(
    text,
    "        {canAllBranches && state.salesReconciliation && (\n",
    "        {diagnosticsOpen && canAllBranches && state.salesReconciliation && (\n",
    "collapse reconciliation",
)

# Data health + loader diagnostics are one collapsed technical section.
diag = """        <Panel className=\"p-4\">\n          <button\n            type=\"button\"\n            onClick={() => setDiagnosticsOpen((open) => !open)}\n            className=\"flex w-full items-center justify-between gap-3 rounded-2xl border border-cyan-300/10 bg-slate-950/40 px-4 py-3 text-right hover:bg-cyan-400/10\"\n          >\n            <div>\n              <div className=\"font-black text-white\">التشخيص وصحة البيانات</div>\n              <div className=\"mt-1 text-xs font-bold text-slate-400\">مخفي افتراضيًا — افتحه فقط عند المراجعة الفنية</div>\n            </div>\n            <div className=\"flex items-center gap-2\">\n              {dataHealthError || dataHealthIssues.length ? (\n                <span className=\"rounded-full bg-amber-400/15 px-3 py-1 text-xs font-black text-amber-100\">{dataHealthError ? 'تعذر الفحص' : `${dataHealthIssues.length} مؤشر`}</span>\n              ) : null}\n              <span className=\"text-cyan-200\">{diagnosticsOpen ? 'إخفاء' : 'عرض'}</span>\n            </div>\n          </button>\n          {diagnosticsOpen ? (\n            <div className=\"mt-4 space-y-4\">\n              <DashboardDataHealthPanel\n                issues={dataHealthIssues}\n                loading={dataHealthLoading}\n                error={dataHealthError}\n                onNavigate={(route) => navigate(route)}\n                onRetry={() => setDataHealthRetryToken((token) => token + 1)}\n              />\n              <div className=\"rounded-2xl border border-cyan-300/10 bg-slate-950/35 p-4\">\n                <SectionTitle title=\"تشخيص تحميل الداشبورد\" subtitle=\"حالة الأقسام الأساسية\" icon={<AlertTriangle className=\"h-5 w-5\" />} />\n                <div className=\"grid gap-3 md:grid-cols-2 xl:grid-cols-5\">\n                  {[\n                    { key: 'sales', label: 'sales', state: salesKPILoading ? 'loading' : salesKPIError || salesKPITimedOut ? 'error' : salesKPILoadedAt ? 'loaded' : 'loading' },\n                    { key: 'staff', label: 'staff', state: staffAttendanceLoading ? 'loading' : staffAttendanceError || staffAttendanceTimedOut ? 'error' : staffAttendanceLoadedAt ? 'loaded' : 'loading' },\n                    { key: 'dailyTasks', label: 'dailyTasks', state: dailyTasksLoading ? 'loading' : dailyTasksError || dailyTasksTimedOut ? 'error' : dailyTasksLoadedAt ? 'loaded' : 'loading' },\n                    { key: 'competition', label: 'competition', state: doctorCompetitionLoading ? 'loading' : doctorCompetitionError ? 'error' : doctorCompetitionLoadedAt ? 'loaded' : 'loading' },\n                    { key: 'health', label: 'health', state: dataHealthLoading ? 'loading' : dataHealthError ? 'error' : 'loaded' },\n                  ].map((item) => (\n                    <div key={item.key} className=\"rounded-2xl border border-cyan-300/10 bg-slate-950/45 p-4\">\n                      <div className=\"text-sm font-black text-white\">{item.label}</div>\n                      <div className=\"mt-3 text-xs font-bold uppercase tracking-[0.2em] text-slate-400\">{item.state}</div>\n                    </div>\n                  ))}\n                </div>\n              </div>\n            </div>\n          ) : null}\n        </Panel>\n\n        <Panel className=\"p-5\">\n          <div className=\"mb-4 flex"""
text = regex_once(
    text,
    r"        <DashboardDataHealthPanel.*?\n        </Panel>\n\n        <Panel className=\"p-5\">\n          <div className=\"mb-4 flex",
    diag,
    "collapsed diagnostics",
)

# Remove duplicated operational catalog.
text = regex_once(
    text,
    r"\n        <Panel id=\"operations-quality\".*?\n        </Panel>\n\n        <section className=\"grid gap-4 xl:grid-cols-12\">",
    "\n        <section className=\"grid gap-4 xl:grid-cols-12\">",
    "remove operations catalog",
)

# Remove detailed customer service section from executive dashboard.
text = regex_once(
    text,
    r"\n          <Panel id=\"customer-service-analysis\".*?\n          </Panel>\n\n          <Panel className=\"hidden\">",
    "\n          <Panel className=\"hidden\">",
    "remove customer service dashboard",
)

# Remove detailed incentives table from executive dashboard.
text = regex_once(
    text,
    r"\n          <Panel id=\"incentives-analysis\".*?\n          </Panel>\n        </section>",
    "\n        </section>",
    "remove incentives table",
)

# Remove second duplicated attendance table; keep only the smart presence section above.
text = regex_once(
    text,
    r"\n        <Panel className=\"p-5\">\n          <SectionTitle\n            title=\"جدول الحضور والموجودين في الشيفت\".*?\n        </Panel>\n\n        <Panel className=\"hidden\">",
    "\n        <Panel className=\"hidden\">",
    "remove duplicate attendance table",
)

# Remove decorative non-functional dashboard domain tabs from header.
text = regex_once(
    text,
    r"\n              <div className=\"mt-5 flex flex-wrap justify-start gap-2 xl:justify-end\">\n                \{\['المبيعات'.*?\n              </div>",
    "",
    "remove non-functional header tabs",
)

p.write_text(text, encoding="utf-8")

print('Executive dashboard cleanup transformations applied successfully.')
