import { Link } from 'react-router-dom';

type CanonicalLink = { to: string; label: string };

const DEFAULT_LINKS: CanonicalLink[] = [
  { to: '/whatsapp-smart-folder-watcher', label: 'التقاط وتحليل محادثات واتساب' },
  { to: '/sales-intelligence/qa', label: 'مراجعة حالات ذكاء المبيعات' },
  { to: '/customer-service', label: 'مركز خدمة العملاء' },
  { to: '/whatsapp-analytics', label: 'تحليلات واتساب' },
];

// Shown on retired surfaces that stay URL-reachable for compatibility but are no longer in the
// menu and are not the source of truth for the numbers they display.
export default function LegacySurfaceNotice({
  links = DEFAULT_LINKS,
  className = '',
}: {
  links?: CanonicalLink[];
  className?: string;
}) {
  return (
    <div className={`dawaa-alert dawaa-alert--warning text-sm font-bold leading-7 ${className}`} dir="rtl" role="note">
      <p>
        هذه صفحة قديمة (تجريبية) لم تعد ضمن القائمة، وأرقامها ليست المصدر المعتمد. استخدم المسار المعتمد:
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {links.map((link) => (
          <Link key={link.to} to={link.to} className="dawaa-button dawaa-button--secondary px-3 py-1 text-xs font-black">
            {link.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
