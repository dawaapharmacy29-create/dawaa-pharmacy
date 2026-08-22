const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function replaceAllOrThrow(file, replacements, label) {
  let source = fs.readFileSync(file, 'utf8');
  let changed = false;
  for (const [from, to] of replacements) {
    if (source.includes(to)) continue;
    if (!source.includes(from)) {
      throw new Error(`Expected ${label} pattern not found: ${from.slice(0, 100)}...`);
    }
    source = source.replace(from, to);
    changed = true;
  }
  if (changed) fs.writeFileSync(file, source);
  console.log(changed ? `Applied ${label}.` : `${label} already applied.`);
}

replaceAllOrThrow(
  path.join(root, 'src/lib/doctorCompetitionMetrics.ts'),
  [
    [
      "safeSelect('conversation_sales_reviews', (query) => query.select('*').gte('conversation_date', range.start).lte('conversation_date', `${range.end}T23:59:59`).limit(5000))",
      "safeSelect('conversation_sales_reviews', (query) => query.select('staff_id,doctor_id,staff_name,doctor_name,branch,final_score,conversation_date').gte('conversation_date', range.start).lte('conversation_date', `${range.end}T23:59:59`).limit(2000))",
    ],
    [
      "safeSelect('daily_followups', (query) => query.select('*').gte('created_at', range.start).lte('created_at', `${range.end}T23:59:59`).limit(5000))",
      "safeSelect('daily_followups', (query) => query.select('staff_id,assigned_staff_id,responsible_name,assigned_doctor,assigned_to,created_by_name,branch,status,followup_status,followup_result,contact_result,completed_at,closed_at,cancelled_at,archived_at,hidden_at,is_hidden,purchase_after_followup,purchase_amount,customer_satisfaction,created_at').gte('created_at', range.start).lte('created_at', `${range.end}T23:59:59`).limit(3000))",
    ],
    [
      "safeSelect('stagnant_medicine_dispenses', (query) => query.select('*').limit(5000))",
      "safeSelect('stagnant_medicine_dispenses', (query) => query.select('doctor_id,doctor_name,branch:branch_name,quantity,total_incentive,dispensed_at').gte('dispensed_at', range.start).lte('dispensed_at', `${range.end}T23:59:59`).limit(1000))",
    ],
    [
      "safeSelect('incentive_medicine_sales', (query) => query.select('*').limit(5000))",
      "safeSelect('incentive_medicine_sales', (query) => query.select('doctor_id,doctor_name,branch,quantity,total_incentive:incentive_total,sale_date').gte('sale_date', range.start).lte('sale_date', range.end).limit(1000))",
    ],
  ],
  'doctor competition payload optimization'
);

replaceAllOrThrow(
  path.join(root, 'src/lib/dashboard/dashboardTruthService.ts'),
  [[
    "  if (Number.isNaN(anchor.getTime())) return [];\n  const jobs = Array.from({ length: Math.max(1, months) }, (_, index) => {",
    "  if (Number.isNaN(anchor.getTime())) return [];\n  // Fast path: one server request loops over indexed month ranges. It avoids five\n  // independent network calls while preserving the old implementation below as a fallback.\n  try {\n    const fastRows = await rpcRows<RpcRow>('get_dashboard_monthly_sales_v2', {\n      p_end: endDate,\n      p_branch: branch,\n      p_months: Math.max(1, months),\n    });\n    if (fastRows.length) return fastRows;\n  } catch {\n    // Backward-compatible fallback for deployments where the new RPC is not available yet.\n  }\n  const jobs = Array.from({ length: Math.max(1, months) }, (_, index) => {"
  ]],
  'historical monthly sales fast path'
);

replaceAllOrThrow(
  path.join(root, 'src/App.tsx'),
  [
    [
      "import { diagnosticsUrl, logRuntimeError, loginRecoveryUrl } from '@/lib/appRecovery';",
      "import { diagnosticsUrl, logRuntimeError } from '@/lib/appRecovery';",
    ],
    [
      "    const timerId = window.setTimeout(() => setIsSlow(true), 8000);",
      "    const timerId = window.setTimeout(() => setIsSlow(true), 12000);",
    ],
    [
      "      <p className=\"mt-2 text-sm leading-7 text-slate-300\">استغرق تحميل هذه الصفحة أكثر من المعتاد. التطبيق ما زال يعمل، ويمكنك فتح التشخيص أو تسجيل الدخول من جديد.</p>",
      "      <p className=\"mt-2 text-sm leading-7 text-slate-300\">استغرق تحميل هذه الصفحة أكثر من المعتاد. جلستك ما زالت محفوظة؛ أعد المحاولة أو افتح التشخيص إذا استمر البطء.</p>",
    ],
    [
      "        <a href={loginRecoveryUrl('route_slow_loading')} className=\"rounded-2xl border border-teal-400/40 px-5 py-3 text-sm font-black text-teal-100 hover:bg-teal-400/10\">تسجيل الدخول</a>\n",
      "",
    ],
  ],
  'slow-route recovery messaging'
);

replaceAllOrThrow(
  path.join(root, 'src/hooks/useAuth.ts'),
  [
    ["const ACCOUNT_REFRESH_TTL_MS = 5 * 60 * 1000;", "const ACCOUNT_REFRESH_TTL_MS = 15 * 60 * 1000;"],
    ["const ACCOUNT_REFRESH_TIMEOUT_MS = 3500;", "const ACCOUNT_REFRESH_TIMEOUT_MS = 2000;"],
    ["        15000,\n        'staff_account_login'", "        8000,\n        'staff_account_login'"],
    ["    await new Promise((resolve) => window.setTimeout(resolve, 500));", "    await new Promise((resolve) => window.setTimeout(resolve, 250));"],
    ["      2500,\n      'get_user_permissions'", "      1000,\n      'get_user_permissions'"],
    [
      "  if (outcome.networkFailure && !outcome.data) {\n    logRuntimeError('auth login rpc failed', new Error('staff_account_login timed out after retry'));\n  }",
      "  if (outcome.networkFailure && !outcome.data) {\n    logRuntimeError('auth login rpc failed', new Error('staff_account_login timed out after retry'));\n    throw new Error('تعذر الاتصال بخدمة تسجيل الدخول. تحقق من الإنترنت وحاول مرة أخرى.');\n  }",
    ],
    [
      "    const shouldBlockForRefresh = Date.now() - lastAccountRefreshAt >= ACCOUNT_REFRESH_TTL_MS;\n    setLoading(shouldBlockForRefresh);",
      "    // A valid cached user opens the app immediately. Account validation still runs\n    // in the background and can revoke the session if the account was disabled, but a\n    // slow network no longer traps the whole app behind the login-loading screen.\n    setLoading(false);",
    ],
  ],
  'non-blocking auth refresh'
);

replaceAllOrThrow(
  path.join(root, 'src/lib/api/dailyFollowups.ts'),
  [
    [
      "  const requestedLimit = Math.max(1, Math.min(options.limit || 5000, 10000));",
      "  const requestedLimit = Math.max(1, Math.min(options.limit || 2000, 4000));",
    ],
  ],
  'followup history load cap'
);

replaceAllOrThrow(
  path.join(root, 'src/components/customerService/CustomerFollowupCockpitPanel.tsx'),
  [
    ["import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';", "import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';"],
    ["const MAX_FETCH_BATCHES = 20; // سقف أمان يمنع لوب لا نهائي لو حصل خلل غير متوقع في الترقيم", "const MAX_FETCH_BATCHES = 2; // أول 2000 متابعة مستحقة كحد أقصى؛ التاريخ الأقدم يُحمّل من السجل عند الطلب"],
    [
      ".order('created_at', { ascending: false }).range(start, start + FETCH_BATCH - 1);",
      ".order('next_followup_date', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false }).range(start, start + FETCH_BATCH - 1);",
    ],
    [
      "        const since = new Date(); since.setDate(since.getDate() - 30);\n        let auditQuery = supabase.from('customer_followup_audit_log').select('id,followup_id,action,actor_name,created_at,branch,metadata').gte('created_at', since.toISOString()).order('created_at', { ascending: false }).limit(5000);",
      "        const since = new Date(); since.setHours(0, 0, 0, 0);\n        let auditQuery = supabase.from('customer_followup_audit_log').select('id,followup_id,action,actor_name,created_at,branch,metadata').gte('created_at', since.toISOString()).order('created_at', { ascending: false }).limit(1000);",
    ],
    [
      "  const [purchaseValue, setPurchaseValue] = useState('');",
      "  const [purchaseValue, setPurchaseValue] = useState('');\n  const loadRunRef = useRef(0);",
    ],
    [
      "    setLoading(true);\n    setLoadError('');\n    try {",
      "    const loadRunId = ++loadRunRef.current;\n    setLoading(true);\n    setLoadError('');\n    try {",
    ],
    [
      "      const [rowsResult, auditResult] = await Promise.allSettled([fetchRows(), fetchAudit()]);\n      if (rowsResult.status === 'fulfilled') {",
      "      const [rowsResult, auditResult] = await Promise.allSettled([fetchRows(), fetchAudit()]);\n      if (loadRunId !== loadRunRef.current) return;\n      if (rowsResult.status === 'fulfilled') {",
    ],
    [
      "        setRows(dedupeRows(rowsResult.value));\n      } else {\n        setLoadError(`تعذر تحميل قائمة المتابعات: ${(rowsResult.reason as Error)?.message || 'خطأ غير معروف'}`);\n        toast.error(`تعذر تحميل قائمة المتابعات: ${(rowsResult.reason as Error)?.message || 'خطأ غير معروف'}`);\n      }",
      "        const nextRows = dedupeRows(rowsResult.value);\n        setRows(nextRows);\n        try { localStorage.setItem(`dawaa_followup_cockpit_v1:${branch}`, JSON.stringify({ at: Date.now(), rows: nextRows })); } catch {}\n      } else {\n        const baseMessage = `تعذر تحميل قائمة المتابعات: ${(rowsResult.reason as Error)?.message || 'خطأ غير معروف'}`;\n        let restored = false;\n        try {\n          const raw = localStorage.getItem(`dawaa_followup_cockpit_v1:${branch}`);\n          const cached = raw ? JSON.parse(raw) as { at?: number; rows?: FollowupRow[] } : null;\n          if (cached?.rows && Array.isArray(cached.rows) && Date.now() - Number(cached.at || 0) <= 15 * 60 * 1000) {\n            setRows(cached.rows);\n            restored = true;\n          }\n        } catch {}\n        setLoadError(restored ? `${baseMessage} — يتم عرض آخر نسخة سليمة محفوظة.` : baseMessage);\n        if (restored) toast.warning('تعذر التحديث اللحظي؛ يتم عرض آخر نسخة سليمة محفوظة.');\n        else toast.error(baseMessage);\n      }",
    ],
    [
      "      if (auditResult.status === 'fulfilled') {\n        setEvents(auditResult.value);\n      } else {\n        console.error('[customer-followup-cockpit] audit log fetch failed', auditResult.reason);\n        setEvents([]);\n      }",
      "      if (auditResult.status === 'fulfilled') {\n        setEvents(auditResult.value);\n        try { localStorage.setItem(`dawaa_followup_audit_v1:${branch}`, JSON.stringify({ at: Date.now(), events: auditResult.value })); } catch {}\n      } else {\n        console.error('[customer-followup-cockpit] audit log fetch failed', auditResult.reason);\n        try {\n          const raw = localStorage.getItem(`dawaa_followup_audit_v1:${branch}`);\n          const cached = raw ? JSON.parse(raw) as { at?: number; events?: AuditEvent[] } : null;\n          if (cached?.events && Array.isArray(cached.events) && Date.now() - Number(cached.at || 0) <= 15 * 60 * 1000) setEvents(cached.events);\n        } catch {}\n      }",
    ],
    [
      "      // allSettled بدل all: query السجل (آخر 30 يوم، مستخدم بس لمؤشر \"مكتمل اليوم\") لو فشل",
      "      // allSettled بدل all: سجل اليوم فقط مطلوب لمؤشر \"مكتمل اليوم\"؛ فشله لا يوقف قائمة التنفيذ.",
    ],
  ],
  'customer followup cockpit stability'
);
