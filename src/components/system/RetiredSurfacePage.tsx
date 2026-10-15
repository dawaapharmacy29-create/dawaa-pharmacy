import { Link } from 'react-router-dom';

// Rendered for retired routes whose backend was never provisioned (no table/RPC in production or
// in migrations). Old bookmarks get a clear notice instead of a page that fails on its first fetch.
export default function RetiredSurfacePage({ title, reason }: { title: string; reason: string }) {
  return (
    <div className="dawaa-card dawaa-card--soft p-6 text-center" dir="rtl" role="status">
      <div className="dawaa-icon-tile mx-auto text-2xl">⛔</div>
      <h1 className="dawaa-title mt-3 text-xl">{title} — صفحة متوقفة</h1>
      <p className="dawaa-body mx-auto mt-2 max-w-2xl text-sm leading-7">{reason}</p>
      <p className="dawaa-body mx-auto mt-1 max-w-2xl text-sm leading-7">
        هذه الصفحة لم تعد ضمن التطبيق ولا يتم حفظ أو قراءة أي بيانات منها.
      </p>
      <div className="mt-5 flex justify-center">
        <Link to="/" className="dawaa-button dawaa-button--primary px-5 py-3 text-sm font-black">
          العودة للصفحة الرئيسية
        </Link>
      </div>
    </div>
  );
}
