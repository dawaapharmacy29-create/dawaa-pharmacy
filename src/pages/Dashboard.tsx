import { Link } from 'react-router-dom';
import {
  BarChart3,
  ClipboardList,
  FileSpreadsheet,
  Headphones,
  ShieldCheck,
  Users,
} from 'lucide-react';

const shortcuts = [
  { to: '/customer-service', label: 'خدمة العملاء', icon: Headphones },
  { to: '/shift-notes', label: 'ملاحظات الشيفت', icon: ClipboardList },
  { to: '/attendance-report', label: 'تسجيل الحضور', icon: ShieldCheck },
  { to: '/invoices', label: 'الفواتير', icon: FileSpreadsheet },
  { to: '/customers', label: 'العملاء', icon: Users },
  { to: '/executive-2027', label: 'لوحة القيادة الكاملة', icon: BarChart3 },
];

export default function Dashboard() {
  return (
    <div className="space-y-6" dir="rtl">
      <section className="rounded-3xl border border-teal-400/15 bg-slate-900/80 p-6 shadow-xl">
        <p className="text-sm font-bold text-teal-300">Dawaa Pharmacy 2027</p>
        <h1 className="mt-2 text-2xl font-black text-white">الوصول السريع</h1>
        <p className="mt-2 text-sm text-slate-400">
          اختر الصفحة المطلوبة، أو افتح لوحة القيادة الكاملة عند الحاجة.
        </p>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {shortcuts.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className="flex items-center gap-3 rounded-2xl border border-slate-700/70 bg-slate-900 p-4 text-white transition hover:border-teal-400/40 hover:bg-slate-800"
          >
            <span className="rounded-xl bg-teal-500/10 p-3 text-teal-300">
              <Icon size={20} />
            </span>
            <span className="font-bold">{label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
