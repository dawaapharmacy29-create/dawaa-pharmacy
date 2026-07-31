const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/components/dashboard/BranchTargetEditor.tsx');
if (!fs.existsSync(file)) {
  console.log('[branch-target-rpc] editor not found; skipped');
  process.exit(0);
}

let source = fs.readFileSync(file, 'utf8');
const start = source.indexOf('  const save = async (branch: string, matchingRows: TargetRow[]) => {');
const altStart = source.indexOf('  const save = async (branch: string, _matchingRows: TargetRow[]) => {');
const actualStart = start >= 0 ? start : altStart;
const end = source.indexOf('\n  if (!allowed) return null;', actualStart);

if (actualStart < 0 || end < 0) {
  if (source.includes("supabase.rpc('save_branch_sales_target_v2'")) {
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
    if (!user?.id || !allowed) {
      toast.error('تعديل التارجت متاح فقط لمدير الفروع والمدير العام');
      return;
    }

    setSaving(branch);
    try {
      const { data, error } = await supabase.rpc('save_branch_sales_target_v2', {
        p_actor_id: user.id,
        p_branch: branch,
        p_target: targetAmount,
      });
      if (error) throw error;

      const savedRow = Array.isArray(data) ? data[0] : data;
      if (!savedRow || rowBranch(savedRow as TargetRow) !== branch || rowAmount(savedRow as TargetRow) !== targetAmount) {
        throw new Error('تعذر التحقق من القيمة المحفوظة');
      }

      clearDashboardCache();
      localStorage.setItem('dawaa_branch_target_refresh', String(Date.now()));
      window.dispatchEvent(new CustomEvent('dawaa:branch-target-updated', { detail: { branch, targetAmount } }));
      setRows((current) => [...current.filter((item) => rowBranch(item) !== branch), savedRow as TargetRow]);
      setDrafts((current) => ({ ...current, [branch]: String(targetAmount) }));
      toast.success(\`تم حفظ تارجت \${branch}: \${targetAmount.toLocaleString('ar-EG')} جنيه\`);
    } catch (error) {
      toast.error(\`تعذر حفظ التارجت: \${error instanceof Error ? error.message : 'خطأ غير معروف'}\`);
    } finally {
      setSaving(null);
    }
  };
`;

source = source.slice(0, actualStart) + replacement + source.slice(end);

if (!source.includes("supabase.rpc('save_branch_sales_target_v2'")) {
  throw new Error('[branch-target-rpc] v2 RPC save was not inserted');
}
if (source.includes("supabase.rpc('set_branch_sales_target'")) {
  throw new Error('[branch-target-rpc] legacy RPC call remains');
}

fs.writeFileSync(file, source);
console.log('[branch-target-rpc] branch target v2 RPC applied');
