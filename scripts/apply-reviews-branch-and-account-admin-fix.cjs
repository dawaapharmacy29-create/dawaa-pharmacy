const fs = require('node:fs');
const path = require('node:path');

function patchFile(file, transform) {
  const full = path.join(process.cwd(), file);
  const before = fs.readFileSync(full, 'utf8');
  const after = transform(before);
  if (after !== before) fs.writeFileSync(full, after, 'utf8');
  return after !== before;
}

const reviewsChanged = patchFile('src/pages/Reviews.tsx', (input) => {
  let s = input;

  if (!s.includes('const [allowCrossBranchReview, setAllowCrossBranchReview]')) {
    s = s.replace(
      "  const [saving, setSaving] = useState(false);",
      "  const [saving, setSaving] = useState(false);\n  const [allowCrossBranchReview, setAllowCrossBranchReview] = useState(false);"
    );
  }

  const oldStaffOptions = `  const staffOptions = useMemo(() => {
    const choices = mergeStaffChoices(staff);
    if (canViewAllBranches(user)) return choices;
    if (isDoctorRole(user)) {
      return choices.filter(
        (row) =>
          row.id === (user?.staffId || user?.id) ||
          row.name === user?.name ||
          rowMatchesCurrentUserScope(user, row as unknown as Record<string, unknown>)
      );
    }
    return choices.filter((row) => rowMatchesCurrentUserScope(user, row as unknown as Record<string, unknown>));
  }, [staff, user]);`;

  const newStaffOptions = `  const reviewerHomeBranch = useMemo(() => {
    const explicit = normalizeBranchName(user?.branch || '');
    if (explicit) return explicit;
    const identity = normalizeArabicName(user?.name || user?.username || '');
    if (identity.includes('ضحى') || identity.includes('ضحى')) return 'فرع الشامي';
    if (identity.includes('دنيا')) return 'فرع شكري';
    return '';
  }, [user?.branch, user?.name, user?.username]);
  const isCustomerServiceReviewer = useMemo(() => {
    const identity = normalizeArabicName(user?.name || user?.username || '');
    return identity.includes('ضحى') || identity.includes('ضحى') || identity.includes('دنيا') || normalizeRole(user?.role) === 'customer_service_manager';
  }, [user?.name, user?.role, user?.username]);
  const staffOptions = useMemo(() => {
    const choices = mergeStaffChoices(staff).map((row) => ({
      ...row,
      branch: normalizeBranchName(row.branch || '') || reviewerHomeBranch || 'غير محدد',
    }));
    if (isGeneralManager(user)) return choices;
    if (isCustomerServiceReviewer) {
      if (allowCrossBranchReview) return choices.filter((row) => ['فرع الشامي', 'فرع شكري'].includes(normalizeBranchName(row.branch || '')));
      return choices.filter((row) => normalizeBranchName(row.branch || '') === reviewerHomeBranch);
    }
    if (isDoctorRole(user)) {
      return choices.filter(
        (row) =>
          row.id === (user?.staffId || user?.id) ||
          row.name === user?.name ||
          rowMatchesCurrentUserScope(user, row as unknown as Record<string, unknown>)
      );
    }
    return choices.filter((row) => rowMatchesCurrentUserScope(user, row as unknown as Record<string, unknown>));
  }, [allowCrossBranchReview, isCustomerServiceReviewer, reviewerHomeBranch, staff, user]);`;

  if (s.includes(oldStaffOptions)) s = s.replace(oldStaffOptions, newStaffOptions);

  if (!s.includes('const effectiveReviewBranch =')) {
    s = s.replace(
      "  const selectedStaff = staffOptions.find((s) => s.id === form.staffId) || null;",
      "  const selectedStaff = staffOptions.find((s) => s.id === form.staffId) || null;\n  const effectiveReviewBranch = normalizeBranchName(selectedStaff?.branch || reviewerHomeBranch || user?.branch || '') || 'غير محدد';"
    );
  }

  s = s.replace(/branch: selectedStaff\.branch,/g, 'branch: effectiveReviewBranch,');
  s = s.replace(/branch: selectedStaff\.branch \|\| null,/g, 'branch: effectiveReviewBranch || null,');
  s = s.replace(/selectedStaff\.branch\n/g, 'effectiveReviewBranch\n');

  if (!s.includes('data-review-branch-override')) {
    const anchor = `          <Field label="نوع المحادثة">`;
    const block = `          {isCustomerServiceReviewer && (\n            <div data-review-branch-override className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-sm text-amber-100">\n              <label className="flex items-center gap-2 font-black">\n                <input\n                  type="checkbox"\n                  checked={allowCrossBranchReview}\n                  onChange={(e) => {\n                    setAllowCrossBranchReview(e.target.checked);\n                    setForm((current) => ({ ...current, staffId: '' }));\n                  }}\n                />\n                استثناء: تقييم دكتور من الفرع الآخر\n              </label>\n              <p className="mt-1 text-xs text-amber-200/80">الفرع الأساسي: {reviewerHomeBranch || 'غير محدد'}. فعّل الاستثناء فقط عند تغطية دكتور من فرع آخر.</p>\n            </div>\n          )}\n`;
    if (s.includes(anchor)) s = s.replace(anchor, block + anchor);
  }

  s = s.replace("const branch = row.branch || 'غير محدد';", "const branch = normalizeBranchName(row.branch || '') || 'غير محدد';");
  return s;
});

const accountsChanged = patchFile('src/pages/StaffAccountsSecureAdmin.tsx', (input) => {
  let s = input;
  s = s.replace("  const { canManage, checkPermission } = useAuth();", "  const { user, canManage, checkPermission } = useAuth();");

  if (!s.includes('const isGeneralManagerAccountAdmin')) {
    s = s.replace(
      "  const currentUserId = getSafeCurrentUserId();",
      "  const currentUserId = getSafeCurrentUserId();\n  const normalizedCurrentRole = normalizeRole(user?.role);\n  const isGeneralManagerAccountAdmin = ['general_manager', 'admin', 'owner'].includes(normalizedCurrentRole) || String(user?.name || '').includes('معاذ');"
    );
  }

  s = s.replace(
    "  const canEdit = checkPermission('manage_staff_accounts') || canManage;",
    "  const canEdit = isGeneralManagerAccountAdmin && (checkPermission('manage_staff_accounts') || canManage);"
  );

  s = s.replace("    const username = editor.username.trim().toLowerCase();", "    const username = editor.username.trim();");
  s = s.replace("    if (editor.pin && !/^\\d{4}$/.test(editor.pin)) return toast.error('الرقم السري يجب أن يكون 4 أرقام.');", "    if (editor.pin && !/^\\d{4,8}$/.test(editor.pin)) return toast.error('الرقم السري يجب أن يكون من 4 إلى 8 أرقام.');");

  const oldPinPayload = "      if (editor.pin) Object.assign(payload, { temporary_password: editor.pin, password_hash: editor.pin, password_status: 'مؤقتة' });";
  const newPinPayload = `      if (editor.pin) Object.assign(payload, {\n        temporary_password: editor.pin,\n        password_hash: editor.pin,\n        pin: editor.pin,\n        pin_hash: editor.pin,\n        password_status: 'تم التعيين بواسطة المدير العام',\n        pin_enabled: true,\n        must_change_pin: false,\n        failed_attempts: 0,\n        locked_until: null,\n      });`;
  if (s.includes(oldPinPayload)) s = s.replace(oldPinPayload, newPinPayload);

  const oldCreate = "      temporary_password: pin,\n      password_hash: pin,\n      password_status: 'مؤقتة',";
  const newCreate = "      temporary_password: pin,\n      password_hash: pin,\n      pin,\n      pin_hash: pin,\n      pin_enabled: true,\n      must_change_pin: false,\n      failed_attempts: 0,\n      locked_until: null,\n      password_status: 'تم التعيين بواسطة المدير العام',";
  if (s.includes(oldCreate)) s = s.replace(oldCreate, newCreate);

  if (!s.includes('تم حفظ التعديلات والتحقق من بيانات الحساب')) {
    s = s.replace(
      "      if (accountResult.error) throw accountResult.error;",
      `      if (accountResult.error) throw accountResult.error;\n      const verification = await supabase\n        .from(TABLES.staffAccounts)\n        .select('id,username,active,can_login,branch,role')\n        .eq('id', editor.account.id)\n        .maybeSingle();\n      if (verification.error || !verification.data) throw new Error('تم إرسال التعديل لكن تعذر التحقق من الحساب بعد الحفظ.');\n      if (String(verification.data.username || '') !== username) throw new Error('اسم المستخدم لم يُحفظ بالكامل. أعد المحاولة.');\n      if (Boolean(verification.data.active) !== editor.active) throw new Error('حالة تفعيل الحساب لم تُحفظ بالكامل.');`
    );
    s = s.replace("toast.success(editor.pin ? 'تم الحفظ وإصدار الرقم السري الجديد.' : 'تم حفظ التعديلات.');", "toast.success(editor.pin ? 'تم حفظ التعديلات والتحقق من بيانات الحساب وإصدار الرقم السري الجديد.' : 'تم حفظ التعديلات والتحقق من بيانات الحساب.');");
  }

  s = s.replace(/String\(account\.branch \|\| staff\?\.branch \|\| ''\)/g, "String(account.branch || staff?.branch || 'غير محدد')");
  return s;
});

console.log(`Reviews/account admin fix applied. reviewsChanged=${reviewsChanged} accountsChanged=${accountsChanged}`);
