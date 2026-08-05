const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'package.json');

if (!fs.existsSync(file)) {
  console.error(
    'ERROR: package.json مش موجود هنا. حط الملف ده داخل فولدر المشروع الرئيسي وشغله من هناك.'
  );
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));

pkg.engines = pkg.engines || {};
pkg.engines.node = '22.x';

// تأكيد وجود build script لو كان ناقص
pkg.scripts = pkg.scripts || {};
if (!pkg.scripts.build) {
  pkg.scripts.build = 'vite build';
}

// لا نضيف vite تلقائيًا لو كان المشروع له إعدادات خاصة؛ فقط ننبه لو ناقص
const hasVite =
  (pkg.dependencies && pkg.dependencies.vite) || (pkg.devDependencies && pkg.devDependencies.vite);

fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

console.log('تم تعديل package.json بنجاح ✅');
console.log('تم ضبط engines.node على 22.x');
if (!hasVite) {
  console.log(
    'تنبيه: vite غير موجود في dependencies/devDependencies. لو ظهر vite: command not found بعد npm install، نفذ: npm install -D vite'
  );
}
