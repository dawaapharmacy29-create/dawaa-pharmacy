import { useRef, useState } from 'react';
import { Copy, Download, Sparkles } from 'lucide-react';
import {
  buildPackMessage,
  loadDesignPack,
  type DesignPack,
  type DesignPackMode,
} from '@/lib/doctorCompetitionDesignPack';

function cairoYesterday(): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

const surface = { background: 'var(--dawaa-theme-surface)', borderColor: 'var(--dawaa-theme-border)' };
const mutedText = { color: 'var(--dawaa-theme-muted)' };

/** Builds the star-of-the-month file and message, for sending on to be turned into a design. */
export default function CompetitionDesignPackPanel(props: {
  branches: readonly string[];
  branch: string | null;
  userBranch?: string | null;
}) {
  const { branches, branch, userBranch } = props;
  const [mode, setMode] = useState<DesignPackMode>('day');
  const [anchor, setAnchor] = useState(cairoYesterday);
  const [pack, setPack] = useState<DesignPack | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const latestRequest = useRef(0);

  const generate = async () => {
    const request = ++latestRequest.current;
    setLoading(true);
    setError('');
    setCopied(false);
    setPack(null);
    try {
      const result = await loadDesignPack({ mode, anchor, branches: branch ? [branch] : branches, branch, userBranch });
      if (request === latestRequest.current) setPack(result);
    } catch (loadError) {
      console.error('[CompetitionDesignPack] load failed', loadError);
      if (request === latestRequest.current) setError('تعذر تجهيز الملف. جرب تاني بعد شوية.');
    } finally {
      if (request === latestRequest.current) setLoading(false);
    }
  };

  const message = pack ? buildPackMessage(pack) : '';
  const hasInvoices = Boolean(pack?.branches.some((item) => item.totals.invoices > 0));

  const download = () => {
    if (!pack) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json;charset=utf-8' }));
    const anchorElement = document.createElement('a');
    anchorElement.href = url;
    anchorElement.download = `نجم-الشهر-${branch || 'كل-الفروع'}-${mode}-${pack.period.end}.json`;
    anchorElement.click();
    URL.revokeObjectURL(url);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
    } catch {
      setError('المتصفح منع النسخ. حدد النص من المربع وانسخه بإيدك.');
    }
  };

  return (
    <section className="space-y-3 rounded-3xl border p-4" style={surface}>
      <div>
        <h2 className="flex items-center gap-2 text-lg font-black text-white">
          <Sparkles size={18} className="text-amber-300" /> ملف تصميم نجم الشهر
        </h2>
        <p className="mt-1 text-xs font-bold" style={mutedText}>
          بعد رفع الفواتير، جهّز الملف والرسالة وابعتهم لكلود يعملك التصميم. الفرع من الفلتر اللي فوق.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <select aria-label="نوع النشرة" className="input-dark" value={mode} onChange={(event) => setMode(event.target.value as DesignPackMode)}>
          <option value="day">نشرة يوم (مقارنة بأمس)</option>
          <option value="week">نشرة أسبوع (آخر ٧ أيام)</option>
          <option value="cycle">نجم الشهر (من ٢٦ لحد اليوم ده)</option>
        </select>
        <input aria-label="لحد يوم" type="date" className="input-dark" value={anchor} onChange={(event) => setAnchor(event.target.value)} />
        <button type="button" onClick={() => void generate()} disabled={loading || !anchor} className="btn-secondary disabled:opacity-50">
          {loading ? 'جارٍ التجهيز…' : 'جهّز الملف والرسالة'}
        </button>
      </div>
      {error ? <div role="alert" className="rounded-2xl border border-red-300/25 bg-red-500/10 p-3 text-sm font-bold text-red-100">{error}</div> : null}
      {pack ? (
        <div className="space-y-2">
          {!hasInvoices ? (
            <div role="alert" className="rounded-2xl border border-amber-300/25 bg-amber-400/10 p-3 text-sm font-bold text-amber-100">
              مفيش فواتير للفترة دي. آخر فاتورة مرفوعة: {pack.last_invoice_date || 'غير معروف'}. ارفع البيانات الأول.
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={download} disabled={!hasInvoices} className="btn-secondary disabled:opacity-50">
              <Download className="ml-1 inline h-4 w-4" /> نزّل الملف
            </button>
            <button type="button" onClick={() => void copy()} disabled={!hasInvoices} className="btn-secondary disabled:opacity-50">
              <Copy className="ml-1 inline h-4 w-4" /> {copied ? 'اتنسخت' : 'انسخ الرسالة'}
            </button>
          </div>
          <textarea aria-label="الرسالة النصية" readOnly dir="rtl" rows={12} value={message} className="input-dark w-full text-xs leading-6" />
        </div>
      ) : null}
    </section>
  );
}
