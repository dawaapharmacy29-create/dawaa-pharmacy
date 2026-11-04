import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ClipboardCheck, Loader2 } from 'lucide-react';
import { Panel } from '@/components/dashboard/DashboardPrimitives';
import { StaffViolationsPanel } from '@/components/dashboard/StaffViolationsPanel';
import {
  DoneRow,
  MiniBar,
  ProgressRing,
  SectionHeader,
  StatusCounters,
  TONE_ACCENT,
  ToneIcon,
} from '@/components/dashboard/DailyListParts';
import {
  AGENDA_GROUP_LABELS,
  AGENDA_ITEM_LABELS,
  INVENTORY_STATUS_LABELS,
  REQUEST_STATUS_SHORT,
  agendaErrorMessage,
  agendaItemTone,
  agendaNoteRequired,
  agendaStats,
  groupAgendaItems,
  loadBranchManagerAgenda,
  markAgendaItem,
  sortAgendaItems,
  type AgendaGroup,
  type AgendaItem,
  type BranchManagerAgenda,
} from '@/lib/branchManagerAgenda';

const BRANCH_LABELS = { shokry: 'فرع شكري', elshamy: 'فرع الشامي' } as const;
const money = (value: unknown) => `${Math.round(Number(value) || 0).toLocaleString('ar-EG')} ج`;
const shortDay = (value?: string | null) =>
  value
    ? new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('ar-EG', {
        weekday: 'long',
        day: 'numeric',
        month: 'numeric',
      })
    : '—';

const PICK_BRANCHES = ['فرع شكري', 'فرع الشامي'] as const;

/**
 * «قائمة اليوم». `branch` null = the manager's own branch. With `allowBranchPick` (branches manager and
 * top management) both branches load together and the tabs show each branch's progress.
 * Layout: progress ring + counters on top, then one collapsible section per group with its own progress;
 * open and problem items first with a colored edge, finished items folded into one line each.
 */
export function BranchManagerDailyAgenda({
  branch,
  allowBranchPick = false,
}: {
  branch: string | null;
  allowBranchPick?: boolean;
}) {
  const [picked, setPicked] = useState<string | null>(
    branch ?? (allowBranchPick ? PICK_BRANCHES[0] : null)
  );
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
      loaded.forEach((item, index) => {
        next[names[index] ?? ''] = item;
      });
      setAgendas(next);
      setError(null);
    } catch (err) {
      setError(agendaErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [allowBranchPick, branch]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const stats = agenda ? agendaStats(agenda.items) : null;

  return (
    <Panel className="p-4 sm:p-5" id="branch-manager-agenda">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="dawaa-icon-tile shrink-0 p-3">
            <ClipboardCheck className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="dawaa-title text-xl">قائمة اليوم</h2>
            <p className="dawaa-caption mt-1 text-xs font-bold">
              {agenda
                ? `${BRANCH_LABELS[agenda.branch]} · ${shortDay(agenda.day)}`
                : 'مهام مدير الفرع من بيانات الفرع'}
            </p>
            {agenda?.sales_day ? (
              <p className="dawaa-caption text-[11px] font-bold">
                المبيعات من {shortDay(agenda.sales_day)}
              </p>
            ) : null}
          </div>
        </div>
        {agenda ? <ProgressRing done={agenda.done} total={agenda.total} /> : null}
      </div>

      {allowBranchPick ? (
        <div
          role="tablist"
          aria-label="الفرع"
          className="dawaa-theme-border mt-4 grid grid-cols-2 gap-1 rounded-2xl border p-1"
        >
          {PICK_BRANCHES.map((name) => {
            const item = agendas[name];
            const active = picked === name;
            return (
              <button
                key={name}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setPicked(name)}
                className={`rounded-xl px-3 py-2 text-start text-xs font-black transition ${active ? 'dawaa-theme-heading bg-[var(--dawaa-status-info-bg)] shadow-sm' : 'dawaa-caption'}`}
              >
                <span className="flex items-center justify-between gap-2">
                  {name}
                  {item ? (
                    <span className="text-[11px]">
                      {item.done}/{item.total}
                    </span>
                  ) : null}
                </span>
                {item ? (
                  <span className="mt-1.5 block">
                    <MiniBar done={item.done} total={item.total} />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}

      {stats ? (
        <div className="mt-4">
          <StatusCounters open={stats.open} issues={stats.issues} done={stats.finished} />
        </div>
      ) : null}

      <div className="mt-4">
        {loading && !agenda ? (
          <div className="dawaa-caption flex items-center gap-2 py-6 text-sm font-bold">
            <Loader2 className="h-4 w-4 animate-spin" /> بنجهز القائمة…
          </div>
        ) : error ? (
          <div className="dawaa-badge dawaa-badge--warning rounded-2xl p-4 text-sm font-bold">
            {error}
          </div>
        ) : agenda ? (
          <div className="grid gap-3">
            {groupAgendaItems(agenda.items).map(({ group, items }) => (
              <AgendaSection
                key={`${picked}-${group}`}
                group={group}
                items={items}
                branch={picked}
                onChanged={reload}
              />
            ))}
          </div>
        ) : null}
      </div>
      {agenda ? <StaffViolationsPanel branch={picked} /> : null}
    </Panel>
  );
}

function AgendaSection({
  group,
  items,
  branch,
  onChanged,
}: {
  group: AgendaGroup;
  items: AgendaItem[];
  branch: string | null;
  onChanged: () => Promise<void>;
}) {
  const stats = agendaStats(items);
  // A finished section starts folded; one with open items or problems starts open.
  const [open, setOpen] = useState(stats.open > 0 || stats.issues > 0);
  const sorted = sortAgendaItems(items);
  const active = sorted.filter((item) => agendaItemTone(item) !== 'done');
  const finished = sorted.filter((item) => agendaItemTone(item) === 'done');
  return (
    <section className="dawaa-theme-border rounded-2xl border p-3 sm:p-4">
      <SectionHeader
        title={AGENDA_GROUP_LABELS[group].title}
        hint={AGENDA_GROUP_LABELS[group].hint}
        done={stats.done}
        total={stats.total}
        issues={stats.issues}
        open={open}
        onToggle={() => setOpen((value) => !value)}
      />
      {open ? (
        <div className="mt-3">
          {active.length ? (
            <div className="grid gap-2 md:grid-cols-2">
              {active.map((item) => (
                <AgendaRow key={item.key} item={item} branch={branch} onChanged={onChanged} />
              ))}
            </div>
          ) : null}
          {finished.length ? (
            <ul
              className={`dawaa-theme-border divide-y divide-[var(--dawaa-theme-border,rgba(148,163,184,0.25))] ${active.length ? 'mt-3 border-t pt-1' : ''}`}
            >
              {finished.map((item) => (
                <FinishedAgendaRow
                  key={item.key}
                  item={item}
                  branch={branch}
                  onChanged={onChanged}
                />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function FinishedAgendaRow({
  item,
  branch,
  onChanged,
}: {
  item: AgendaItem;
  branch: string | null;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const detail = item.state
    ? [item.note, item.marked_by].filter(Boolean).join(' — ') || 'اتعلّمت'
    : 'خلصت لوحدها من البيانات';
  return (
    <DoneRow
      title={AGENDA_ITEM_LABELS[item.key].title}
      detail={detail}
      busy={busy}
      onUndo={
        item.state
          ? () => {
              setBusy(true);
              void markAgendaItem(branch, item.key, 'clear')
                .then(onChanged)
                .finally(() => setBusy(false));
            }
          : undefined
      }
    />
  );
}

function AgendaRow({
  item,
  branch,
  onChanged,
}: {
  item: AgendaItem;
  branch: string | null;
  onChanged: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const label = AGENDA_ITEM_LABELS[item.key];
  const tone = agendaItemTone(item);
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
  const press = (state: 'done' | 'issue') =>
    agendaNoteRequired(item, state) ? setNoteFor(state) : void save(state);

  const action =
    item.key === 'weekly_inventory' && item.inventory_status
      ? INVENTORY_STATUS_LABELS[item.inventory_status]
      : label.action;
  const showCount = item.group !== 'check' && item.key !== 'weekly_inventory';

  return (
    <div
      className={`dawaa-theme-surface dawaa-theme-border rounded-2xl border p-3 ${TONE_ACCENT[tone]}`}
    >
      <div className="flex items-start gap-3">
        <ToneIcon tone={tone} className="mt-0.5 h-5 w-5" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <span className="text-sm font-black leading-6">{label.title}</span>
            {showCount ? (
              <span
                className={`dawaa-badge ${tone === 'issue' ? 'dawaa-badge--warning' : 'dawaa-badge--danger'} shrink-0 rounded-full px-2.5 py-0.5 text-sm font-black`}
              >
                {item.count}
              </span>
            ) : null}
          </div>
          {action ? <p className="dawaa-caption mt-0.5 text-xs font-bold">{action}</p> : null}
          {item.before_cycle ? (
            <p className="dawaa-caption mt-0.5 text-[11px] font-bold">
              + {item.before_cycle} طلب مفتوح من قبل الدورة (مش محسوب هنا)
            </p>
          ) : null}
          {item.note ? (
            <p className="dawaa-badge dawaa-badge--warning mt-1.5 rounded-xl px-2 py-1 text-xs font-bold">
              📝 {item.note}
              {item.marked_by ? ` — ${item.marked_by}` : ''}
            </p>
          ) : null}

          {item.rows.length > 0 ? (
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              aria-expanded={open}
              className="dawaa-caption mt-1.5 flex items-center gap-1 text-xs font-black"
            >
              <ChevronDown className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} />
              {open
                ? 'إخفاء'
                : item.count > item.rows.length
                  ? `أهم ${item.rows.length}`
                  : 'التفاصيل'}
            </button>
          ) : null}
          {open ? <AgendaRows item={item} /> : null}

          {noteFor ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <input
                autoFocus
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder={noteFor === 'issue' ? 'إيه المشكلة؟' : 'عملت إيه؟'}
                className="dawaa-theme-surface dawaa-theme-border min-w-0 flex-1 rounded-xl border px-3 py-2 text-xs font-bold"
              />
              <button
                type="button"
                disabled={busy || !note.trim()}
                onClick={() => void save(noteFor, note)}
                className="dawaa-badge dawaa-badge--info rounded-xl px-4 py-2 text-xs font-black disabled:opacity-50"
              >
                حفظ
              </button>
              <button
                type="button"
                onClick={() => setNoteFor(null)}
                className="dawaa-caption px-1 text-xs font-black"
              >
                إلغاء
              </button>
            </div>
          ) : (
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              {item.state ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void save('clear')}
                  className="dawaa-caption text-xs font-black underline"
                >
                  تراجع
                </button>
              ) : item.group === 'check' ? (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => press('done')}
                    className="dawaa-badge dawaa-badge--success rounded-xl px-4 py-1.5 text-xs font-black"
                  >
                    تمام ✓
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => press('issue')}
                    className="dawaa-badge dawaa-badge--warning rounded-xl px-3 py-1.5 text-xs font-black"
                  >
                    فيه مشكلة
                  </button>
                </>
              ) : (
                <>
                  {label.link ? (
                    <button
                      type="button"
                      onClick={() => navigate(label.link!)}
                      className="dawaa-badge dawaa-badge--info rounded-xl px-4 py-1.5 text-xs font-black"
                    >
                      افتح
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => press('done')}
                    className="dawaa-badge dawaa-badge--success rounded-xl px-3 py-1.5 text-xs font-black"
                  >
                    خلصتها
                  </button>
                </>
              )}
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            </div>
          )}
          {error ? (
            <p className="mt-1 text-xs font-bold text-[var(--dawaa-status-danger-text)]">{error}</p>
          ) : null}
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
    <ul className="dawaa-theme-border mt-1.5 grid gap-1 rounded-xl border p-2 text-xs font-bold">
      {item.rows.map((row, index) => (
        <li key={index} className="leading-5">
          • {line(row)}
        </li>
      ))}
      {item.data_day ? (
        <li className="dawaa-caption text-[11px]">بيانات {shortDay(item.data_day)}</li>
      ) : null}
    </ul>
  );
}
