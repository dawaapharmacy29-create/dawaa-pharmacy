const fs = require('fs');

const file = 'src/pages/Reviews.tsx';
let source = fs.readFileSync(file, 'utf8');
let changed = false;

const helperAnchor = `function formatDateTime(value?: string | null) {`;
if (!source.includes('function reviewRoleLabel(') && source.includes(helperAnchor)) {
  const helper = `function reviewRoleLabel(role?: string | null) {\n  const value = String(role || '').trim();\n  const labels: Record<string, string> = {\n    general_manager: 'مدير عام',\n    executive_manager: 'مدير تنفيذي',\n    branches_manager: 'مدير الفروع',\n    branch_manager: 'مدير فرع',\n    customer_service_manager: 'مدير خدمة العملاء',\n    purchasing_manager: 'مدير المشتريات',\n    pharmacist: 'صيدلي',\n    doctor: 'صيدلي',\n    assistant_pharmacist: 'مساعد صيدلي',\n  };\n  return labels[value.toLowerCase()] || value.replace(/_/g, ' ') || 'غير محدد';\n}\n\n`;
  source = source.replace(helperAnchor, helper + helperAnchor);
  changed = true;
}

const formAnchor = `  const { data: staff } = useSupabaseQuery<StaffOpt>({`;
if (!source.includes('conversation reviewer identity is always the signed-in account') && source.includes(formAnchor)) {
  const syncEffect = `  // conversation reviewer identity is always the signed-in account\n  useEffect(() => {\n    if (!user?.id) return;\n    setForm((current) =>\n      current.reviewerId === user.id ? current : { ...current, reviewerId: user.id }\n    );\n  }, [user?.id]);\n\n`;
  source = source.replace(formAnchor, syncEffect + formAnchor);
  changed = true;
}

const reviewerBlock = `          <Field label="من يقيم؟">\n            <select\n              className="input-dark"\n              value={form.reviewerId}\n              onChange={(e) => setForm((f) => ({ ...f, reviewerId: e.target.value }))}\n            >\n              <option value="">اختر المراجع</option>\n              {reviewers.map((row) => (\n                <option key={row.id} value={row.id}>\n                  {row.name} - {row.role}\n                </option>\n              ))}\n            </select>\n          </Field>`;
const reviewerReplacement = `          <Field label="من يقيّم؟">\n            <div className="input-dark flex min-h-[46px] items-center justify-between gap-3">\n              <span className="font-black text-white">{user?.name || selectedReviewer?.name || 'مستخدم النظام'}</span>\n              <span className="rounded-lg border border-teal-400/20 bg-teal-500/10 px-2 py-1 text-xs font-bold text-teal-100">\n                {reviewRoleLabel(user?.role || selectedReviewer?.role)}\n              </span>\n            </div>\n            <p className="mt-1 text-xs text-slate-400">يُسجل التقييم تلقائيًا باسم الحساب الحالي ولا يمكن تغييره.</p>\n          </Field>`;
if (source.includes(reviewerBlock)) {
  source = source.replace(reviewerBlock, reviewerReplacement);
  changed = true;
}

source = source.replace(
  `{row.name} - {row.role} - {row.branch}`,
  `{row.name} · {reviewRoleLabel(row.role)} · {row.branch || 'فرع غير محدد'}`
);

if (!changed && source.includes('يُسجل التقييم تلقائيًا باسم الحساب الحالي')) {
  console.log('Conversation reviewer identity fix already applied.');
  process.exit(0);
}

if (!changed) {
  console.warn('Reviews reviewer anchors not found; skipping safely.');
  process.exit(0);
}

fs.writeFileSync(file, source);
console.log('Conversation reviewer identity fixed: signed-in reviewer locked and Arabic role labels applied.');
