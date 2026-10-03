import { useState } from 'react';
import { buildPurchaseDemandEvidenceExport, downloadPurchaseDemandEvidenceExport } from '@/lib/purchaseDemandEvidenceExportV1';

export default function PurchaseDemandEvidenceExport() {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  const run = async () => {
    setBusy(true);
    setStatus('');
    try {
      const payload = await buildPurchaseDemandEvidenceExport({ windowDays: 30 });
      downloadPurchaseDemandEvidenceExport(payload);
      setStatus('تم تجهيز ملف Evidence المجمع بنجاح.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'تعذر تجهيز ملف Evidence.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto max-w-2xl p-6" dir="rtl">
      <h1 className="text-2xl font-black">Demand Evidence للمشتريات</h1>
      <p className="mt-3 text-sm leading-7">
        تصدير مجمع فقط؛ لا يغيّر الفواتير أو الرصيد أو الطلبات، ولا يصدّر هوية العملاء أو أرقام الفواتير.
      </p>
      <button type="button" disabled={busy} onClick={run} className="dawaa-button dawaa-button--primary mt-5 px-5 py-3">
        {busy ? 'جاري التجهيز...' : 'تجهيز ملف Evidence'}
      </button>
      {status ? <p className="mt-4 text-sm font-bold">{status}</p> : null}
    </main>
  );
}
