import { useQuery } from '@tanstack/react-query';
import { RefreshCw, Truck } from 'lucide-react';
import { readDeliveryInvoiceSyncStatus } from '@/lib/invoices/deliveryInvoiceSync';
export function DeliveryInvoiceSyncStatus() {
  const query = useQuery({
    queryKey: ['delivery-invoice-sync-status'],
    queryFn: readDeliveryInvoiceSyncStatus,
    refetchInterval: 15000,
    staleTime: 10000,
  });
  const status = query.data,
    queued = status && status.revision > status.processed_revision;
  return (
    <section className="dawaa-card space-y-3" aria-label="مطابقة الدليفري التلقائية">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-bold flex items-center gap-2">
          <Truck size={18} />
          مطابقة الدليفري التلقائية
        </h3>
        <button
          type="button"
          className="dawaa-button"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
        >
          <RefreshCw size={16} />
          <span className="sr-only">تحديث حالة المطابقة</span>
        </button>
      </div>
      <p className="text-sm dawaa-caption">
        فواتير الدورة المفتوحة المحفوظة والصحيحة تُرسل تلقائيًا بعد الحفظ خلال دقائق. الأوردرات
        الجديدة تُراجع دوريًا، والاعتمادات اليدوية محفوظة.
      </p>
      {query.isError ? (
        <p role="alert">
          تعذر قراءة حالة المطابقة. حفظ الفواتير مستقل عن اتصال الدليفري.
          <button className="underline mr-2" onClick={() => void query.refetch()}>
            إعادة المحاولة
          </button>
        </p>
      ) : query.isPending ? (
        <p role="status">جارٍ قراءة حالة الربط…</p>
      ) : !status ? (
        <p>لا توجد عملية إرسال مسجلة للدورة المفتوحة بعد.</p>
      ) : (
        <>
          <p role="status" className="font-bold">
            {status.last_error
              ? 'المزامنة تحتاج مراجعة؛ توجد إعادة محاولة تلقائية'
              : queued
                ? 'الفواتير محفوظة، والمطابقة في انتظار التنفيذ'
                : 'المطابقة مكتملة لآخر نسخة من الفواتير'}
          </p>
          {status.last_error && (
            <p className="text-sm">
              {status.last_error.includes('conflict')
                ? 'توجد فاتورة تختلف عن دليل محفوظ سابقًا في الدليفري. يلزم مراجعتها قبل استبدال الدليل.'
                : 'تعذر الاتصال أو إتمام المطابقة. البيانات السابقة والقرارات محفوظة.'}
            </p>
          )}
          {status.last_success_at && (
            <p className="text-xs dawaa-caption">
              آخر نجاح:{' '}
              {new Date(status.last_success_at).toLocaleString('ar-EG', {
                timeZone: 'Africa/Cairo',
              })}{' '}
              · دورة تبدأ {status.period_start}
            </p>
          )}
          {status.result && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              {[
                ['فواتير المصدر', status.result.invoices],
                ['أوردرات التطبيق', status.result.orders],
                ['مطابق تلقائيًا', status.result.matched],
                ['بانتظار / مراجعة', status.result.pending],
                ['فواتير توصيل بدون أوردر', status.result.system_only],
                ['فاشل / مستبعد', status.result.failed],
                ['قرارات مدير محفوظة', status.result.human_decisions_preserved],
              ].map(([label, value]) => (
                <div key={String(label)}>
                  <span className="dawaa-caption">{label}</span>
                  <b className="block text-lg">{value}</b>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
