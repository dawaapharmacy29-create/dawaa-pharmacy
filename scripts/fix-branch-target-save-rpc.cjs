const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/components/dashboard/BranchTargetEditor.tsx');
if (!fs.existsSync(file)) {
  console.log('[branch-target-rpc] editor not found; skipped');
  process.exit(0);
}

let source = fs.readFileSync(file, 'utf8');
const start = source.indexOf('  const save = async (branch: string, matchingRows: TargetRow[]) => {');
const end = source.indexOf('\n  if (!allowed) return null;', start);

if (start < 0 || end < 0) {
  if (source.includes("supabase.rpc('set_branch_sales_target'")) {
    console.log('[branch-target-rpc] already applied');
    process.exit(0);
  }
  throw new Error('[branch-target-rpc] save block anchors not found');
}

const replacement = `  const save = async (branch: string, _matchingRows: TargetRow[]) => {
    const targetAmount = amount(drafts[branch]);
    if (targetAmount <= 0) {
      toast.error('اكتب تارجت صحيح أكبر من صفر');
      return;
    }
    if (!user?.id) {
      toast.error('تعذر تحديد الحساب الحالي. سجّل الدخول من جديد.');
      return;
    }

    setSaving(branch);
    try {
      const { data, error } = await supabase.rpc('set_branch_sales_target', {
        p_branch_name: branch,
        p_target_amount: targetAmount,
        p_actor_id: user.id,
      });

      if (error) {
        toast.error(\`تعذر حفظ التارجت: \${error.message || 'خطأ غير معروف'}\`);
        return;
      }

      const returnedRows = Array.isArray(data) ? (data as TargetRow[]) : data ? [data as TargetRow] : [];
      const savedRow = returnedRows.find((item) => rowBranch(item) === branch && rowAmount(item) === targetAmount);
      if (!savedRow) {
        toast.error('تم إرسال التعديل لكن لم تعد قاعدة البيانات بالقيمة الجديدة.');
        return;
      }

      clearDashboardCache();
      localStorage.setItem('dawaa_branch_target_refresh', String(Date.now()));
      window.dispatchEvent(new CustomEvent('dawaa:branch-target-updated', { detail: { branch, targetAmount } }));

      setRows((current) => {
        const others = current.filter((item) => rowBranch(item) !== branch);
        return [...others, savedRow];
      });
      setDrafts((current) => ({ ...current, [branch]: String(targetAmount) }));
      toast.success(\`تم حفظ تارجت \${branch}: \${targetAmount.toLocaleString('ar-EG')} جنيه\`);
    } finally {
      setSaving(null);
    }
  };
`;

source = source.slice(0, start) + replacement + source.slice(end);

if (!source.includes("supabase.rpc('set_branch_sales_target'")) {
  throw new Error('[branch-target-rpc] RPC save was not inserted');
}

fs.writeFileSync(file, source);
console.log('[branch-target-rpc] secure RPC save applied');
