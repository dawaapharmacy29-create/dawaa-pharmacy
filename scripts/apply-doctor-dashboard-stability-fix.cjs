const fs = require('fs');
const path = require('path');

function read(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function write(relativePath, source) {
  fs.writeFileSync(path.join(process.cwd(), relativePath), source);
}

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) throw new Error(`doctor-dashboard-stability: ${label}`);
  return source.replace(before, after);
}

let app = read('src/App.tsx');
app = replaceOnce(
  app,
  `  if (location.pathname === '/' && isDoctorRole(user)) {\n    return <Navigate to="/doctor-dashboard" replace />;\n  }`,
  `  if (location.pathname === '/' && isDoctorRole(user)) {\n    return <Navigate to="/doctor-dashboard" replace />;\n  }\n\n  // مركز خدمة العملاء الكامل مخصص لفريق خدمة العملاء والإدارة.\n  // الطبيب ومشرف الشيفت يستخدمان المتابعة السريعة وسجل طلباتهما من لوحة الدكتور.\n  if (isDoctorRole(user) && location.pathname.startsWith('/customer-service')) {\n    return <Navigate to="/doctor-dashboard?section=followups" replace />;\n  }`,
  'block full customer service for doctor roles'
);
write('src/App.tsx', app);

let dashboard = read('src/pages/DoctorDashboard.tsx');

const oldShiftLoader = `      const { data, error } = await supabase
        .from('shift_schedules')
        .select('*')
        .eq('staff_id', effectiveId)
        .eq('shift_date', todayIso)
        .limit(1);
      if (cancelled) return;
      setShiftLoading(false);
      if (error) {
        setShiftError('تعذر تحميل بيانات الشيفت');
        setTodayShift(null);
        return;
      }
      setTodayShift((data || [])[0] || null);`;

const newShiftLoader = `      const selectedDayName = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'][new Date(selectedDate + 'T12:00:00').getDay()];
      let result = await supabase
        .from('shift_schedules')
        .select('*')
        .eq('staff_id', effectiveId)
        .limit(50);

      // بعض الجداول القديمة كانت مرتبطة بالاسم فقط، فنستخدمها كحل احتياطي مضبوط بالفرع.
      if (!result.error && !(result.data || []).length && effectiveName) {
        result = await supabase
          .from('shift_schedules')
          .select('*')
          .eq('staff_name', effectiveName)
          .limit(50);
      }

      if (cancelled) return;
      setShiftLoading(false);
      if (result.error) {
        setShiftError('تعذر تحميل بيانات الشيفت');
        setTodayShift(null);
        return;
      }

      const rows = result.data || [];
      const exactDate = rows.find((row) => String(row.shift_date || row.date || '') === selectedDate);
      const weekly = rows.find(
        (row) =>
          String(row.day_name || row.day || '').trim() === selectedDayName &&
          row.is_off !== true &&
          row.is_day_off !== true
      );
      const dayOff = rows.find(
        (row) => String(row.day_name || row.day || '').trim() === selectedDayName
      );
      setTodayShift((exactDate || weekly || dayOff || null) as Record<string, unknown> | null);`;

dashboard = replaceOnce(dashboard, oldShiftLoader, newShiftLoader, 'weekly shift fallback');
dashboard = dashboard.replace(
  `  }, [effectiveId, todayIso]);`,
  `  }, [effectiveBranch, effectiveId, effectiveName, selectedDate]);`
);

// خفض حجم التحميل الأولي وإلغاء اشتراكات realtime غير الضرورية في لوحة الدكتور.
dashboard = dashboard.replace(
  `    orderBy: { column: 'name', ascending: true },\n    realtimeEnabled: true,`,
  `    orderBy: { column: 'name', ascending: true },\n    limit: 100,\n    realtimeEnabled: false,`
);
dashboard = dashboard.replace(
  `    orderBy: { column: 'metric_date', ascending: false },\n    realtimeEnabled: true,`,
  `    orderBy: { column: 'metric_date', ascending: false },\n    limit: 40,\n    realtimeEnabled: false,`
);
dashboard = dashboard.replace(
  `    orderBy: { column: 'retention_status', ascending: false },\n    realtimeEnabled: true,`,
  `    orderBy: { column: 'retention_status', ascending: false },\n    limit: 60,\n    realtimeEnabled: false,`
);
dashboard = dashboard.replace(
  `    orderBy: { column: 'priority', ascending: false },\n    realtimeEnabled: true,`,
  `    orderBy: { column: 'priority', ascending: false },\n    limit: 60,\n    realtimeEnabled: false,`
);
dashboard = dashboard.replace(
  `    limit: 2000,\n    realtimeEnabled: true,`,
  `    limit: 600,\n    realtimeEnabled: false,`
);
// قائمة اللستة لا تحتاج قناة realtime كاملة داخل لوحة الدكتور.
dashboard = dashboard.replace(
  `      { column: 'active', operator: 'eq', value: true },\n    ],\n    realtimeEnabled: true,`,
  `      { column: 'active', operator: 'eq', value: true },\n    ],\n    limit: 60,\n    realtimeEnabled: false,`
);

// لا توجه أي كارت للطبيب إلى مركز خدمة العملاء الكامل.
dashboard = dashboard.replaceAll(`href: '/customer-service'`, `href: '/doctor-dashboard?section=followups'`);
dashboard = dashboard.replaceAll(`return '/customer-service';`, `return '/doctor-dashboard?section=followups';`);

write('src/pages/DoctorDashboard.tsx', dashboard);
console.log('[doctor-dashboard-stability-fix] applied');
