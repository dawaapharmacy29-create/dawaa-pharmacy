const fs = require('node:fs');

function patchFile(path, transform) {
  const before = fs.readFileSync(path, 'utf8');
  const after = transform(before);
  if (after === before) {
    console.log(`[audit-fix] no change needed: ${path}`);
    return;
  }
  fs.writeFileSync(path, after);
  console.log(`[audit-fix] patched: ${path}`);
}

patchFile('src/pages/Invoices.tsx', (source) => {
  const earlyReturn = `  if (!canAccessInvoices) {\n    return (\n      <div className="flex min-h-[400px] items-center justify-center p-6" dir="rtl">\n        <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 px-6 py-5 text-center text-amber-100">\n          ليس لديك صلاحية للوصول إلى صفحة استيراد الفواتير.\n        </div>\n      </div>\n    );\n  }\n\n`;
  const returnMarker = `  return (\n    <div className="space-y-5 max-w-5xl">`;

  if (!source.includes(earlyReturn)) {
    if (source.includes('ليس لديك صلاحية للوصول إلى صفحة استيراد الفواتير.') && source.indexOf('ليس لديك صلاحية للوصول إلى صفحة استيراد الفواتير.') > source.indexOf(returnMarker)) {
      return source;
    }
    throw new Error('Invoices permission return marker not found');
  }
  if (!source.includes(returnMarker)) throw new Error('Invoices main return marker not found');

  const permissionReturn = `  if (!canAccessInvoices) {\n    return (\n      <div className="flex min-h-[400px] items-center justify-center p-6" dir="rtl">\n        <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 px-6 py-5 text-center text-amber-100">\n          ليس لديك صلاحية للوصول إلى صفحة استيراد الفواتير.\n        </div>\n      </div>\n    );\n  }\n\n`;

  return source.replace(earlyReturn, '').replace(returnMarker, permissionReturn + returnMarker);
});

patchFile('src/pages/CustomerService.tsx', (source) => {
  if (!source.includes('useQuickReply')) return source;
  return source.replaceAll('useQuickReply', 'handleQuickReply');
});
