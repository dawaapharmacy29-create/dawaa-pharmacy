import { BookOpenCheck } from 'lucide-react';
import { STAFF_OPERATING_POLICY_SECTIONS } from '@/lib/performance/ruleDefinitions';

export default function StaffOperatingPolicy() {
  return (
    <details className="stat-card" dir="rtl">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-base font-black text-white">
          <BookOpenCheck className="h-5 w-5 text-teal-300" />
          مطلوب مني إيه؟
        </span>
        <span className="rounded-full border border-teal-400/25 bg-teal-500/10 px-3 py-1 text-xs font-black text-teal-300">
          لائحة التشغيل والحوافز
        </span>
      </summary>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {STAFF_OPERATING_POLICY_SECTIONS.map((section) => (
          <div key={section.title} className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <h3 className="font-black text-white">{section.title}</h3>
            <ul className="mt-3 space-y-2 text-sm leading-7 text-slate-300">
              {section.items.map((item) => (
                <li key={item} className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-400" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </details>
  );
}
