import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, ChevronDown, Circle, ClipboardCheck, Loader2, TriangleAlert } from 'lucide-react';
import { Panel } from '@/components/dashboard/DashboardPrimitives';
import { StaffViolationsPanel } from '@/components/dashboard/StaffViolationsPanel';
import {
  AGENDA_GROUP_LABELS, AGENDA_ITEM_LABELS, INVENTORY_STATUS_LABELS, REQUEST_STATUS_SHORT,
  agendaErrorMessage, agendaNoteRequired, groupAgendaItems, loadBranchManagerAgenda, markAgendaItem,
  type AgendaItem, type BranchManagerAgenda,
} from '@/lib/branchManagerAgenda';

const BRANCH_LABELS = { shokry: 'فرع شكري', elshamy: 'فرع الشامي' } as const;
const money = (value: unknown) => `${Math.round(Number(value) || 0).toLocaleString('ar-EG')} ج`;
const shortDay = (value?: string | null) =>
  value ? new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'numeric' }) : '—';

const PICK_BRANCHES = ['فرع شكري', 'فرع الشامي'] as const;

/**
 * «قائمة اليوم». `branch` null = the manager's own branch. With `allowBranchPick` (branches manager and
 * top management) both branches load together and the tabs show each branch's progress.
 */
export function BranchManagerDailyAgenda({ branch, allowBranchPick = false }: { branch: string | null; allowBranchPick?: boolean }) {
  const [picked, setPicked] = useState<string | null>(branch ?? (allowBranchPick ? PICK_BRANCHES[0] : null));
  const [agendas, setAgendas] = useState<Record<string, BranchManagerAgenda>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const agenda = agendas[picked ?? ''] ?? null;

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const names = allowBranchPick ? [...PICK_BRANCHES] : [branch];
      const loaded = await Promise.all(names.map((name) => loadBranchManagerAgenda(name)));
      const next: Record<string, BranchManagerAgenda> = {};
      loaded.forEach((item, index) => { next[names[index] ?? ''] = item; });
      setAgendas(next);
      setError(null);
    } catch (err) {
      setError(agendaErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [allowBranchPick, branch]);

  useEffect(() => { void reload(); }, [reload]);

  const percent = agenda ? Math.round((agenda.done / Math.max(agenda.total, 1)) * 100) : 0;

  return (
    <Panel className="p-5" id="branch-manager-agenda">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="dawaa-icon-tile p-3"><ClipboardCheck className="h-5 w-5" /></div>
          <div>
            <h2 className="dawaa-title text-xl">قائمة اليوم</h2>
            <p className="dawaa-caption mt-1 text-xs font-bold">
              {agenda ? `${BRANCH_LABELS[agenda.branch]} · ${shortDay(agenda.day)} · المبيعات من ${shortDay(agenda.sales_day)}` : 'مهام مدير الفرع من بيانات الفرع'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {allowBranchPick ? (
            <div className="flex gap-2">
              {PICK_BRANCHES.map((name) => {
                const item = agendas[name];
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => setPicked(name)}
                    className={`dawaa-badge ${picked === name ? 'dawaa-badge--info' : ''} rounded-xl px-3 py-2 text-xs font-black`}
                  >
                    {name}{item ? ` · ${item.done}/${item.total}` : ''}
                  </button>
                );
              })}
            </div>
          ) : null}
          {agenda ? (
            <div className="min-w-[140px]">
              <div className="flex items-baseline justify-between gap-2 text-sm font-black">
                <span>{agenda.done} من {agenda.total}</span>
                <span className="dawaa-caption text-xs">{percent}%</span>
              </div>
              <div className="dawaa-theme-border mt-1 h-2 overflow-hidden rounded-full border">
                <div className="h-full rounded-full bg-[var(--dawaa-status-success-text)] transition-all" style={{ width: `${percent}%` }} />
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {loading && !agenda ? (
        <div className="dawaa-caption flex items-center gap-2 py-6 text-sm font-bold"><Loader2 className="h-4 w-4 animate-spin" /> بنجهز القائمة…</div>
      ) : error ? (
        <div className="dawaa-badge dawaa-badge--warning rounded-2xl p-4 text-sm font-bold">{error}</div>
      ) : agenda ? (
        <div className="grid gap-5 xl:grid-cols-3">
          {groupAgendaItems(agenda.items).map(({ group, items }) => (
            <div key={group}>
              <div className="mb-2">
                <h3 className="dawaa-theme-heading text-sm font-black">{AGENDA_GROUP_LABELS[group].title}</h3>
                <p className="dawaa-caption text-[11px] font-bold">{AGENDA_GROUP_LABELS[group].hint}</p>
              </div>
              <div className="grid gap-2">
                {items.map((item) => (
                  <AgendaRow key={item.key} item={item} branch={picked} onChanged={reload} />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {agenda ? <StaffViolationsPanel branch={picked} /> : null}
    </Panel>
  );
}

function AgendaRow({ item, branch, onChanged }: { item: AgendaItem; branch: string | null; onChanged: () => Promise<void> }) {
  const navigate = useNavigate();
  const label = AGENDA_ITEM_LABELS[item.key];
  const [open, setOpen] = useState(false);
  const [noteFor, setNoteFor] = useState<'done' | 'issue' | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (state: 'done' | 'issue' | 'clear', text?: string) => {
    setBusy(true);
    try {
      await markAgendaItem(branch, item.key, state, text);
      setNoteFor(null);
      setNote('');
      setError(null);
      await onChanged();
    } catch (err) {
      setError(agendaErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const press = (state: 'done' | 'issue') => (agendaNoteRequired(item, state) ? setNoteFor(state) : void save(state));

  const action = item.key === 'weekly_inventory' && item.inventory_status
    ? INVENTORY_STATUS_LABELS[item.inventory_status]
    : label.action;
  const showCount = item.group !== 'check' && item.key !== 'weekly_inventory';
  const tone = item.state === 'issue' ? 'dawaa-badge--warning' : item.done ? 'dawaa-badge--success' : 'dawaa-badge--danger';

  return (
    <div className={`dawaa-theme-border rounded-2xl border p-3 ${item.done ? 'opacity-80' : ''}`}>
      <div className="flex items-start gap-3">
        {item.state === 'issue'
          ? <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-[var(--dawaa-status-warning-text)]" />
          : item.done
            ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[var(--dawaa-status-success-text)]" />
            : <Circle className="dawaa-caption mt-0.5 h-5 w-5 shrink-0" />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-black">{label.title}</span>
            {showCount ? <span className={`dawaa-badge ${tone} rounded-full px-2 py-0.5 text-xs font-black`}>{item.count}</span> : null}
          </div>
          {action ? <p className="dawaa-caption mt-0.5 text-xs font-bold">{action}</p> : null}
          {item.before_cycle ? (
            <p className="dawaa-caption mt-0.5 text-xs font-bold">+ {item.before_cycle} طلب مفتوح من قبل الدورة (مش محسوب هنا)</p>
          ) : null}
          {item.note ? <p className="mt-1 text-xs font-bold">📝 {item.note}{item.marked_by ? ` — ${item.marked_by}` : ''}</p> : null}

          {item.rows.length > 0 && !item.done ? (
            <button type="button" onClick={() => setOpen((value) => !value)} className="dawaa-caption mt-1 flex items-center gap-1 text-xs font-black">
              <ChevronDown className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} />
              {open ? 'إخفاء' : item.count > item.rows.length ? `أهم ${item.rows.length}` : 'التفاصيل'}
            </button>
          ) : null}
          {open && !item.done ? <AgendaRows item={item} /> : null}

          {noteFor ? (
            <div className="mt-2 flex gap-2">
              <input
                autoFocus
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder={noteFor === 'issue' ? 'إيه المشكلة؟' : 'عملت إيه؟'}
                className="dawaa-theme-surface dawaa-theme-border min-w-0 flex-1 rounded-xl border px-3 py-1.5 text-xs font-bold"
              />
              <button type="button" disabled={busy || !note.trim()} onClick={() => void save(noteFor, note)}
                className="dawaa-badge dawaa-badge--info rounded-xl px-3 text-xs font-black disabled:opacity-50">حفظ</button>
              <button type="button" onClick={() => setNoteFor(null)} className="dawaa-caption text-xs font-black">إلغاء</button>
            </div>
          ) : (
            <div className="mt-2 flex flex-wrap gap-2">
              {item.state ? (
                <button type="button" disabled={busy} onClick={() => void save('clear')} className="dawaa-caption text-xs font-black underline">تراجع</button>
              ) : item.group === 'check' ? (
                <>
                  <button type="button" disabled={busy} onClick={() => press('done')} className="dawaa-badge dawaa-badge--success rounded-xl px-3 py-1 text-xs font-black">تمام</button>
                  <button type="button" disabled={busy} onClick={() => press('issue')} className="dawaa-badge dawaa-badge--warning rounded-xl px-3 py-1 text-xs font-black">فيه مشكلة</button>
                </>
              ) : !item.done ? (
                <>
                  {label.link ? (
                    <button type="button" onClick={() => navigate(label.link!)} className="dawaa-badge dawaa-badge--info rounded-xl px-3 py-1 text-xs font-black">افتح</button>
                  ) : null}
                  <button type="button" disabled={busy} onClick={() => press('done')} className="dawaa-badge dawaa-badge--success rounded-xl px-3 py-1 text-xs font-black">خلصتها</button>
                </>
              ) : null}
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            </div>
          )}
          {error ? <p className="mt-1 text-xs font-bold text-[var(--dawaa-status-danger-text)]">{error}</p> : null}
        </div>
      </div>
    </div>
  );
}

function AgendaRows({ item }: { item: AgendaItem }) {
  const line = (row: Record<string, unknown>) => {
    switch (item.key) {
      case 'open_requests':
        return `${row.customer_name ?? ''} — ${row.medicine_name ?? ''} · ${REQUEST_STATUS_SHORT[String(row.status)] ?? row.status} · من ${row.age_days} يوم`;
      case 'uncoded_invoices':
        return `${row.seller}: ${row.n} فاتورة`;
      case 'purchases_review':
        return `فاتورة ${row.invoice_number ?? '—'} · ${money(row.total_value)}`;
      case 'big_customers':
        return `${row.customer_name} · ${money(row.amount)}${row.seller ? ` · ${row.seller}` : ''}`;
      case 'high_discount':
        return `${row.customer_name} · خصم ${money(row.discount)} من ${money(row.gross)}${row.seller ? ` · ${row.seller}` : ''}`;
      default:
        return '';
    }
  };
  return (
    <ul className="dawaa-theme-surface mt-1 grid gap-1 rounded-xl p-2 text-xs font-bold">
      {item.rows.map((row, index) => <li key={index}>{line(row)}</li>)}
      {item.data_day ? <li className="dawaa-caption text-[11px]">بيانات {shortDay(item.data_day)}</li> : null}
    </ul>
  );
}
