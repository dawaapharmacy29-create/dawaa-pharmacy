import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, ChevronDown, ClipboardCheck, Loader2, TriangleAlert } from 'lucide-react';
import { Panel } from '@/components/dashboard/DashboardPrimitives';
import { StaffViolationsPanel } from '@/components/dashboard/StaffViolationsPanel';
import { DoneRow, MiniBar, TONE_ACCENT, ToneIcon } from '@/components/dashboard/DailyListParts';
import {
  AGENDA_GROUP_LABELS,
  AGENDA_ITEM_LABELS,
  INVENTORY_STATUS_LABELS,
  REQUEST_STATUS_SHORT,
  agendaErrorMessage,
  agendaItemTone,
  agendaNoteRequired,
  agendaStats,
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

/** The order the manager works the list in: walk the branch, then the data, then the decisions. */
const STEP_ORDER: AgendaGroup[] = ['check', 'auto', 'decide'];
const STEP_TITLE: Record<AgendaGroup, string> = {
  check: 'لفة الفرع',
  auto: AGENDA_GROUP_LABELS.auto.title,
  decide: AGENDA_GROUP_LABELS.decide.title,
};
const STEP_NUMBER = ['١', '٢', '٣'];
/** Open cards shown per step before «اعرض كمان», so the list stays short on a phone. */
const VISIBLE_CARDS = 2;

/**
 * «قائمة اليوم». `branch` null = the manager's own branch. With `allowBranchPick` (branches manager and
 * top management) both branches load together and the tabs show each branch's progress.
 * Layout: «فاضل N من M» with a bar, then three numbered steps: ① the floor walk as big tap circles,
 * ② items closed by the branch data, ③ items that need the manager's decision. Each step shows its open
 * items as short cards (two, then «اعرض كمان») and its finished items folded into one line.
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
  const steps = agenda
    ? STEP_ORDER.map((group) => ({
        group,
        items: agenda.items.filter((item) => item.group === group),
      })).filter((step) => step.items.length > 0)
    : [];

  return (
    <Panel className="p-4 sm:p-5" id="branch-manager-agenda">
      <div className="flex items-center gap-3">
        <div className="dawaa-icon-tile shrink-0 p-2.5">
          <ClipboardCheck className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <h2 className="dawaa-title text-lg">قائمة اليوم</h2>
            {agenda ? (
              <span className="dawaa-caption text-[11px] font-bold">
                {BRANCH_LABELS[agenda.branch]} · {shortDay(agenda.day)}
              </span>
            ) : null}
          </div>
          {agenda && stats ? (
            <>
              <p className="mt-0.5 text-xs font-black">
                {stats.open + stats.issues
                  ? `فاضل ${stats.open + stats.issues} من ${stats.total}`
                  : 'كل البنود خلصت ✓'}
                {agenda.sales_day ? (
                  <span className="dawaa-caption font-bold">
                    {' '}
                    · المبيعات من {shortDay(agenda.sales_day)}
                  </span>
                ) : null}
              </p>
              <div className="mt-1.5">
                <MiniBar done={agenda.done} total={agenda.total} />
              </div>
            </>
          ) : null}
        </div>
      </div>

      {allowBranchPick ? (
        <div
          role="tablist"
          aria-label="الفرع"
          className="dawaa-theme-border mt-3 grid grid-cols-2 gap-1 rounded-2xl border p-1"
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
                className={`flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-xs font-black transition ${active ? 'dawaa-theme-heading bg-[var(--dawaa-status-info-bg)] shadow-sm' : 'dawaa-caption'}`}
              >
                {name}
                {item ? (
                  <span className="text-[11px]">
                    {item.done}/{item.total}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="mt-3">
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
            {steps.map(({ group, items }, index) => (
              <AgendaStep
                key={`${picked}-${group}`}
                number={STEP_NUMBER[index] ?? String(index + 1)}
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

function AgendaStep({
  number,
  group,
  items,
  branch,
  onChanged,
}: {
  number: string;
  group: AgendaGroup;
  items: AgendaItem[];
  branch: string | null;
  onChanged: () => Promise<void>;
}) {
  const stats = agendaStats(items);
  const [showAll, setShowAll] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const sorted = sortAgendaItems(items);
  const active = sorted.filter((item) => agendaItemTone(item) !== 'done');
  const finished = sorted.filter((item) => agendaItemTone(item) === 'done');
  const complete = stats.total > 0 && stats.done >= stats.total && !stats.issues;
  const visible = showAll ? active : active.slice(0, VISIBLE_CARDS);

  return (
    <section className="dawaa-theme-border rounded-2xl border p-3">
      <div className="flex items-center gap-2">
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-black ${
            complete
              ? 'bg-[var(--dawaa-status-success-bg)] text-[var(--dawaa-status-success-text)]'
              : 'bg-[var(--dawaa-status-info-bg)] text-[var(--dawaa-status-info-text)]'
          }`}
        >
          {complete ? <Check className="h-3.5 w-3.5" /> : number}
        </span>
        <h3 className="dawaa-theme-heading min-w-0 flex-1 truncate text-sm font-black">
          {STEP_TITLE[group]}
        </h3>
        <span className="dawaa-caption shrink-0 text-[11px] font-black">
          {stats.done}/{stats.total}
        </span>
      </div>

      {group === 'check' ? (
        <div className="mt-3 grid grid-cols-4 gap-1.5">
          {items.map((item) => (
            <CheckTile key={item.key} item={item} branch={branch} onChanged={onChanged} />
          ))}
        </div>
      ) : (
        <>
          {active.length ? (
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              {visible.map((item) => (
                <AgendaCard key={item.key} item={item} branch={branch} onChanged={onChanged} />
              ))}
            </div>
          ) : null}
          {active.length > VISIBLE_CARDS ? (
            <button
              type="button"
              onClick={() => setShowAll((value) => !value)}
              className="dawaa-theme-border dawaa-caption mt-2 w-full rounded-xl border py-1.5 text-xs font-black"
            >
              {showAll ? 'اعرض أقل' : `اعرض ${active.length - VISIBLE_CARDS} كمان`}
            </button>
          ) : null}
          {finished.length ? (
            <div className={active.length ? 'mt-2' : 'mt-1.5'}>
              <button
                type="button"
                onClick={() => setShowDone((value) => !value)}
                aria-expanded={showDone}
                className="dawaa-caption flex w-full items-center gap-1.5 text-start text-[11px] font-black"
              >
                <ToneIcon tone="done" className="h-3.5 w-3.5" />
                <span className="min-w-0 flex-1 truncate">
                  خلص {finished.length}:{' '}
                  {finished.map((item) => AGENDA_ITEM_LABELS[item.key].title).join(' · ')}
                </span>
                <ChevronDown
                  className={`h-3.5 w-3.5 shrink-0 transition-transform ${showDone ? 'rotate-180' : ''}`}
                />
              </button>
              {showDone ? (
                <ul className="mt-1 divide-y divide-[var(--dawaa-theme-border,rgba(148,163,184,0.25))]">
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
        </>
      )}
    </section>
  );
}

/** One floor check as a big circle: tap = «تمام», the small triangle reports a problem with a note. */
function CheckTile({
  item,
  branch,
  onChanged,
}: {
  item: AgendaItem;
  branch: string | null;
  onChanged: () => Promise<void>;
}) {
  const label = AGENDA_ITEM_LABELS[item.key];
  const tone = agendaItemTone(item);
  const [busy, setBusy] = useState(false);
  const [noteFor, setNoteFor] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const save = async (state: 'done' | 'issue' | 'clear', text?: string) => {
    setBusy(true);
    try {
      await markAgendaItem(branch, item.key, state, text);
      setNoteFor(false);
      setNote('');
      setError(null);
      await onChanged();
    } catch (err) {
      setError(agendaErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const circle =
    tone === 'done'
      ? 'border-[var(--dawaa-status-success-text)] bg-[var(--dawaa-status-success-bg)] text-[var(--dawaa-status-success-text)]'
      : tone === 'issue'
        ? 'border-[var(--dawaa-status-warning-text)] bg-[var(--dawaa-status-warning-bg)] text-[var(--dawaa-status-warning-text)]'
        : 'dawaa-theme-border dawaa-caption border-dashed';

  return (
    <div className="flex min-w-0 flex-col items-center text-center">
      <button
        type="button"
        disabled={busy}
        aria-label={`${label.title}: ${tone === 'done' ? 'تراجع' : 'تمام'}`}
        title={label.action}
        onClick={() => void save(item.state ? 'clear' : 'done')}
        className={`flex h-14 w-14 items-center justify-center rounded-full border-2 transition active:scale-95 ${circle}`}
      >
        {busy ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : tone === 'done' ? (
          <Check className="h-7 w-7" />
        ) : tone === 'issue' ? (
          <TriangleAlert className="h-6 w-6" />
        ) : null}
      </button>
      <span className="mt-1 line-clamp-2 text-[11px] font-black leading-tight">{label.title}</span>
      {!item.state ? (
        <button
          type="button"
          onClick={() => setNoteFor((value) => !value)}
          className="mt-0.5 text-[10px] font-black text-[var(--dawaa-status-warning-text)]"
        >
          فيه مشكلة؟
        </button>
      ) : item.note ? (
        <span className="dawaa-caption mt-0.5 line-clamp-2 text-[10px] font-bold">{item.note}</span>
      ) : null}
      {noteFor ? (
        <div className="fixed inset-x-4 bottom-4 z-50 flex gap-2 rounded-2xl border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] p-3 shadow-lg sm:static sm:inset-auto sm:mt-1 sm:w-full sm:p-1.5 sm:shadow-none">
          <input
            autoFocus
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={`${label.title}: إيه المشكلة؟`}
            className="dawaa-theme-surface dawaa-theme-border min-w-0 flex-1 rounded-xl border px-3 py-2 text-xs font-bold"
          />
          <button
            type="button"
            disabled={busy || !note.trim()}
            onClick={() => void save('issue', note)}
            className="dawaa-badge dawaa-badge--warning rounded-xl px-3 text-xs font-black disabled:opacity-50"
          >
            حفظ
          </button>
          <button
            type="button"
            onClick={() => setNoteFor(false)}
            className="dawaa-caption px-1 text-xs font-black"
          >
            إلغاء
          </button>
        </div>
      ) : null}
      {error ? (
        <p className="mt-0.5 text-[10px] font-bold text-[var(--dawaa-status-danger-text)]">
          {error}
        </p>
      ) : null}
    </div>
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

/** A short card: the big number, the title, what to do, and one wide button. */
function AgendaCard({
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
  const showCount = item.key !== 'weekly_inventory';

  return (
    <div
      className={`dawaa-theme-surface dawaa-theme-border rounded-2xl border p-3 ${TONE_ACCENT[tone]}`}
    >
      <div className="flex items-center gap-3">
        {showCount ? (
          <span
            className={`shrink-0 text-2xl font-black tabular-nums leading-none ${
              tone === 'issue'
                ? 'text-[var(--dawaa-status-warning-text)]'
                : 'text-[var(--dawaa-status-danger-text)]'
            }`}
          >
            {item.count.toLocaleString('ar-EG')}
          </span>
        ) : (
          <ToneIcon tone={tone} className="h-6 w-6" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-black leading-snug">{label.title}</p>
          {action ? <p className="dawaa-caption text-[11px] font-bold">{action}</p> : null}
        </div>
      </div>
      {item.before_cycle ? (
        <p className="dawaa-caption mt-1 text-[10px] font-bold">
          + {item.before_cycle} طلب مفتوح من قبل الدورة (مش محسوب هنا)
        </p>
      ) : null}
      {item.note ? (
        <p className="dawaa-badge dawaa-badge--warning mt-1.5 rounded-xl px-2 py-1 text-[11px] font-bold">
          📝 {item.note}
          {item.marked_by ? ` — ${item.marked_by}` : ''}
        </p>
      ) : null}

      {item.rows.length > 0 ? (
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="dawaa-caption mt-1.5 flex items-center gap-1 text-[11px] font-black"
        >
          <ChevronDown className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} />
          {open ? 'إخفاء' : item.count > item.rows.length ? `أهم ${item.rows.length}` : 'التفاصيل'}
        </button>
      ) : null}
      {open ? <AgendaRows item={item} /> : null}

      {noteFor ? (
        <div className="mt-2 flex gap-2">
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
        <div className="mt-2 flex items-center gap-1.5">
          {item.state ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void save('clear')}
              className="dawaa-theme-border dawaa-caption min-h-[40px] flex-1 rounded-xl border px-3 text-xs font-black"
            >
              تراجع
            </button>
          ) : (
            <>
              {label.link ? (
                <button
                  type="button"
                  onClick={() => navigate(label.link!)}
                  className="dawaa-badge dawaa-badge--info min-h-[40px] flex-1 rounded-xl px-3 text-xs font-black"
                >
                  افتح
                </button>
              ) : null}
              <button
                type="button"
                disabled={busy}
                onClick={() => press('done')}
                className={`dawaa-badge dawaa-badge--success min-h-[40px] rounded-xl px-3 text-xs font-black ${label.link ? '' : 'flex-1'}`}
              >
                {busy ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : 'خلصتها'}
              </button>
            </>
          )}
        </div>
      )}
      {error ? (
        <p className="mt-1 text-xs font-bold text-[var(--dawaa-status-danger-text)]">{error}</p>
      ) : null}
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
