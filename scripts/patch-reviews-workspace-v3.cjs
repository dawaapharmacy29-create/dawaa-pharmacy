const fs = require('fs');
const path = require('path');

function patchFile(filePath, patches) {
  const file = path.join(process.cwd(), filePath);
  let src = fs.readFileSync(file, 'utf8');
  for (const patch of patches) {
    if (src.includes(patch.to)) {
      console.log(`[reviews-v3] ${patch.label}: already applied`);
      continue;
    }
    if (!src.includes(patch.from)) throw new Error(`[reviews-v3] ${patch.label}: anchor not found in ${filePath}`);
    src = src.replace(patch.from, patch.to);
    console.log(`[reviews-v3] ${patch.label}: applied`);
  }
  fs.writeFileSync(file, src);
}

patchFile('src/pages/Reviews.tsx', [
  {
    label: 'skip full history load in new and edit modes',
    from: `  useEffect(() => {\n    loadReviewHistory();\n  }, [loadReviewHistory]);`,
    to: `  useEffect(() => {\n    const mode = searchParams.get('mode');\n    if (newOnlyMode || mode === 'edit') return;\n    loadReviewHistory();\n  }, [loadReviewHistory, newOnlyMode, searchParams]);`
  },
  {
    label: 'auto open full editor from mode=edit',
    from: `  const saveEdit = async (): Promise<boolean> => {`,
    to: `  useEffect(() => {\n    if (searchParams.get('mode') !== 'edit' || !selectedReview?.id || editingReview?.id === selectedReview.id) return;\n    void openEdit(selectedReview);\n    // openEdit intentionally omitted: editingReview guard makes this one-shot per selected id.\n    // eslint-disable-next-line react-hooks/exhaustive-deps\n  }, [searchParams, selectedReview?.id, editingReview?.id]);\n\n  const saveEdit = async (): Promise<boolean> => {`
  },
  {
    label: 'return to fast detail after successful edit',
    from: `      await loadReviewHistory();\n      setEditingReview(null);\n      toast.success('تم تعديل التقييم بالكامل وإعادة احتساب الدرجة والنقاط');`,
    to: `      await loadReviewHistory();\n      const editedReviewId = editingReview.id;\n      setEditingReview(null);\n      navigate(\`/reviews?section=history&id=\${encodeURIComponent(editedReviewId)}\`, { replace: true });\n      toast.success('تم تعديل التقييم بالكامل وإعادة احتساب الدرجة والنقاط');`
  },
  {
    label: 'close editor back to fast detail',
    from: `<Modal title="تعديل تقييم المحادثة بالكامل - المدير العام" onClose={() => setEditingReview(null)}>`,
    to: `<Modal title="تعديل تقييم المحادثة بالكامل - المدير العام" onClose={() => { const id = editingReview.id; setEditingReview(null); navigate(\`/reviews?section=history&id=\${encodeURIComponent(id)}\`, { replace: true }); }}>`
  }
]);

patchFile('src/components/reviews/ReviewsInsightsHub.tsx', [
  {
    label: 'defer spreadsheet bundle until export',
    from: `import * as XLSX from 'xlsx';\n`,
    to: ``
  },
  {
    label: 'load spreadsheet library on demand',
    from: `  const exportReport = () => {\n    if (!filtered.length) { toast.error('لا توجد بيانات في الفلاتر الحالية'); return; }\n    const workbook = XLSX.utils.book_new();`,
    to: `  const exportReport = async () => {\n    if (!filtered.length) { toast.error('لا توجد بيانات في الفلاتر الحالية'); return; }\n    const XLSX = await import('xlsx');\n    const workbook = XLSX.utils.book_new();`
  },
  {
    label: 'service staff role in resolver',
    from: `type StaffRow = { id: string; name: string; branch: string | null; active: boolean | null; is_active: boolean | null };`,
    to: `type StaffRow = { id: string; name: string; branch: string | null; role?: string | null; active: boolean | null; is_active: boolean | null };`
  },
  {
    label: 'map service staff role',
    from: `        branch: row.branch,\n        active: row.active,\n        is_active: row.active,`,
    to: `        branch: row.branch,\n        role: row.role || null,\n        active: row.active,\n        is_active: row.active,`
  },
  {
    label: 'active current service team only',
    from: `  const serviceSummary = useMemo(() => {\n    // followups جاية من load() مفلترة بالشهر المختار بالفعل، فمش محتاجين نفلتر تاني هنا.\n    const grouped = new Map<string, FollowupRow[]>();\n    followups.forEach((row) => {\n      const name = String(row.responsible_name || row.assigned_to || row.assigned_doctor || row.completed_by || 'غير محدد');\n      grouped.set(name, [...(grouped.get(name) || []), row]);\n    });`,
    to: `  const serviceSummary = useMemo(() => {\n    // تقارير خدمة العملاء الحالية تُنسب فقط لفريق دواء ألفا النشط حاليًا.\n    // كده الموظف المؤرشف أو صاحب دور قديم (مثل أسماء تاريخية في المتابعات) لا يظهر\n    // كأنه ما زال ضمن فريق خدمة العملاء الحالي.\n    const currentServiceStaff = staffRows.filter((row) =>\n      row.active !== false && row.is_active !== false && String(row.role || '').toLowerCase() === 'team_dawaa_alpha'\n    );\n    const resolveCurrentServiceName = (rawValue) => {\n      const raw = normalizeName(rawValue);\n      if (!raw) return null;\n      const match = currentServiceStaff.find((staff) => {\n        const canonical = normalizeName(staff.name);\n        return canonical === raw || canonical.includes(raw) || raw.includes(canonical);\n      });\n      return match?.name || null;\n    };\n    const grouped = new Map<string, FollowupRow[]>();\n    followups.forEach((row) => {\n      const rawName = String(row.responsible_name || row.assigned_to || row.assigned_doctor || row.completed_by || '');\n      const name = resolveCurrentServiceName(rawName);\n      if (!name) return;\n      grouped.set(name, [...(grouped.get(name) || []), row]);\n    });`
  },
  {
    label: 'service summary dependency on current staff',
    from: `  }, [followups]);`,
    to: `  }, [followups, staffRows]);`
  }
]);

console.log('[reviews-v3] review workspace patch complete');
require('./patch-smart-review-v1.cjs');
require('./patch-smart-review-v2.cjs');
require('./patch-smart-review-v3.cjs');
require('./patch-smart-review-v4.cjs');
require('./patch-smart-review-v5.cjs');
require('./patch-smart-review-v6.cjs');
require('./patch-smart-review-v7.cjs');
require('./patch-smart-review-v8.cjs');
require('./patch-smart-review-v9.cjs');
require('./patch-smart-review-v10.cjs');
require('./patch-smart-review-v11.cjs');
require('./patch-smart-review-v12.cjs');
require('./patch-smart-review-v13.cjs');
require('./patch-whatsapp-analyzer-official-review-v1.cjs');
require('./patch-whatsapp-analyzer-decision-support-v2.cjs');
require('./patch-whatsapp-analyzer-framework-v3.cjs');
require('./patch-whatsapp-local-inbox-v1.cjs');
require('./patch-whatsapp-unified-v4.cjs');