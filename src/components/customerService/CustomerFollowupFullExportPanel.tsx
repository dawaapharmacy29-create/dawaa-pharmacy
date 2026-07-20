import { useMemo, useState } from 'react';
import { Download, FileSpreadsheet, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { normalizeBranchName } from '@/lib/branch';
import { canViewAllBranches } from '@/lib/security/userDataScope';
import { fetchAllCustomerServiceFollowups } from '@/lib/api/customerServiceFollowupPagination';
import { buildFollowupExportRows } from '@/lib/customerFollowupExport';

const ALL_BRANCHES = 'كل الفروع';

type FollowupRecord = Record<string, unknown>;
type ExportMode = 'open' | 'completed' | 'all';

function safeFilePart(value: string) {
  return value.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-');
}

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate()
  ).padStart(2, '0')}`;
}

export default function CustomerFollowupFullExportPanel() {
  const { user } = useAuth();
  const managerView = canViewAllBranches(user);
  const userBranch = normalizeBranchName(user?.branch || '') || 'فرع الشامي';
  const [branch, setBranch] = useState(managerView ? ALL_BRANCHES : userBranch);
  const [mode, setMode] = useState<ExportMode>('open');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState('');

  const completed = useMemo(() => {
    if (mode === 'completed') return true;
    if (mode === 'open') return false;
    return null;
  }, [mode]);

  async function exportAll() {
    setLoading(true);
    setProgress('جارٍ بدء التحميل...');
    try {
      let loaded = 0;
      const rows = await fetchAllCustomerServiceFollowups<FollowupRecord>(
        {
          branch: branch === ALL_BRANCHES ? null : branch,
          search,
          completed,
          includeHidden: mode === 'all',
          pageSize: 500,
        },
        {
          maxRows: 50_000,
          onPage: (page) => {
            loaded += page.rows.length;
            setProgress(
              `تم تحميل ${loaded.toLocaleString('ar-EG')} من ${page.total.toLocaleString('ar-EG')}`
            );
          },
        }
      );

      const exportRows = buildFollowupExportRows(rows, { openOnly: mode === 'open' });
      if (!exportRows.length) {
        toast.error('لا توجد نتائج مطابقة للتصدير');
        return;
      }

      const XLSX = await import('xlsx');
      const sheet = XLSX.utils.json_to_sheet(exportRows);
      sheet['!cols'] = Object.keys(exportRows[0]).map((key) => ({
        wch: Math.min(45, Math.max(14, key.length + 4)),
      }));
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, sheet, 'متابعات العملاء');

      const modeLabel =
        mode === 'open' ? 'المطلوب-الآن' : mode === 'completed' ? 'تم-الانتهاء' : 'كل-السجل';
      const branchLabel = branch === ALL_BRANCHES ? 'كل-الفروع' : safeFilePart(branch);
      XLSX.writeFile(book, `متابعات-العملاء-${modeLabel}-${branchLabel}-${todayKey()}.xlsx`);
      toast.success(`تم تصدير ${exportRows.length.toLocaleString('ar-EG')} متابعة إلى Excel`);
    } catch (error) {
      toast.error(`تعذر تصدير كل النتائج: ${(error as Error).message}`);
    } finally {
      setLoading(false);
      setProgress('');
    }
  }

  return (
    <section
      className="mx-4 mt-4 rounded-3xl border border-teal-400/20 bg-[#10243d] p-4 shadow-xl"
      dir="rtl"
    >
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="flex items-center gap-2 text-lg font-black text-white">
            <FileSpreadsheet size={20} className="text-teal-300" />
            تصدير سجل متابعات العملاء الكامل
          </div>
          <p className="mt-1 text-sm font-bold text-slate-400">
            يجلب كل الصفحات من قاعدة البيانات، وليس أول 1000 صف فقط، ويضيف حالة جودة البيانات
            والمعرفات.
          </p>
        </div>

        <div className="grid flex-1 gap-2 sm:grid-cols-2 xl:max-w-4xl xl:grid-cols-4">
          {managerView ? (
            <select
              className="input-dark"
              value={branch}
              onChange={(event) => setBranch(event.target.value)}
            >
              <option>{ALL_BRANCHES}</option>
              <option>فرع الشامي</option>
              <option>فرع شكري</option>
            </select>
          ) : (
            <div className="input-dark flex items-center font-black text-teal-100">{userBranch}</div>
          )}

          <select
            className="input-dark"
            value={mode}
            onChange={(event) => setMode(event.target.value as ExportMode)}
          >
            <option value="open">المطلوب الآن فقط</option>
            <option value="completed">تم الانتهاء فقط</option>
            <option value="all">كل السجل بما فيه الأرشيف</option>
          </select>

          <input
            className="input-dark"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="اسم / كود / هاتف"
          />

          <button
            type="button"
            className="btn-primary flex items-center justify-center gap-2"
            disabled={loading}
            onClick={() => void exportAll()}
          >
            {loading ? <Loader2 size={17} className="animate-spin" /> : <Download size={17} />}
            {loading ? 'جارٍ تجهيز Excel' : 'تصدير كل النتائج'}
          </button>
        </div>
      </div>
      {progress ? <div className="mt-3 text-xs font-black text-teal-200">{progress}</div> : null}
    </section>
  );
}
