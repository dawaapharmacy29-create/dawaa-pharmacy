import { useEffect, useMemo, useState } from 'react';
import { ClipboardList, Upload } from 'lucide-react';
import { parseGroupChat, type GroupChatMessage } from '@/lib/followupRequests/groupChatRequests';
import { matchSenderToDoctor } from '@/lib/followupRequests/matchSenderToDoctor';
import { findNamedDoctor } from '@/lib/followupRequests/namedDoctor';
import {
  DEFAULT_BRANCH_REQUEST_TARGET,
  branchFromFileName,
  importFollowupRequests,
  linkSender,
  loadFollowupRequestTargets,
  readChatFile,
  resolveSenders,
  saveFollowupRequestTarget,
  type FollowupRequestCount,
  type SenderMatch,
} from '@/lib/followupRequests/followupRequestService';

const surface = { background: 'var(--dawaa-theme-surface)', borderColor: 'var(--dawaa-theme-border)' };
const mutedText = { color: 'var(--dawaa-theme-muted)' };

interface Doctor { staffId: string; name: string }

/** Uploads the follow-up group's export and shows each branch against its cycle target. */
export default function FollowupRequestsPanel(props: {
  branches: readonly string[];
  doctors: Doctor[];
  /** Null when the cycle's counts could not be read. */
  counts: FollowupRequestCount[] | null;
  onImported: () => void;
}) {
  const { branches, doctors, counts, onImported } = props;
  const [fileName, setFileName] = useState('');
  const [messages, setMessages] = useState<GroupChatMessage[]>([]);
  const [approved, setApproved] = useState<Set<number>>(new Set());
  const [senders, setSenders] = useState<SenderMatch[]>([]);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [groupBranch, setGroupBranch] = useState('');
  /** Doctor picked by hand for a shared account's request that names nobody, by its index in `messages`. */
  const [picks, setPicks] = useState<Record<number, string>>({});
  const [targets, setTargets] = useState<Map<string, number> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');

  useEffect(() => {
    loadFollowupRequestTargets().then(setTargets).catch(() => setTargets(null));
  }, []);

  const requests = useMemo(() => messages.filter((message) => message.verdict === 'request'), [messages]);
  const review = useMemo(() => messages.filter((message) => message.verdict === 'review'), [messages]);
  const ignored = messages.filter((message) => message.verdict === 'ignored').length;
  const repeats = messages.filter((message) => message.verdict === 'repeat').length;
  const unmatched = senders.filter((sender) => !sender.staffId);
  // A shared account nobody is chosen for, such as the branch phone, still credits the doctor its message names.
  const sharedSenders = useMemo(() => new Set(unmatched.filter((sender) => !choices[sender.sender]).map((sender) => sender.sender)), [unmatched, choices]);
  const namedFor = (message: GroupChatMessage) => (sharedSenders.has(message.sender) ? findNamedDoctor(message.body, doctors) : null);
  const namedCounts = useMemo(() => {
    const counts = new Map<string, number>();
    requests.forEach((message) => {
      const doctor = sharedSenders.has(message.sender) ? findNamedDoctor(message.body, doctors) : null;
      if (doctor) counts.set(doctor.name.trim(), (counts.get(doctor.name.trim()) || 0) + 1);
    });
    return [...counts.entries()];
  }, [requests, sharedSenders, doctors]);
  const unnamed = useMemo(
    () => messages
      .map((message, index) => ({ message, index }))
      .filter(({ message }) => message.verdict === 'request' && sharedSenders.has(message.sender) && !findNamedDoctor(message.body, doctors)),
    [messages, sharedSenders, doctors],
  );
  const doctorFor = (message: GroupChatMessage) => namedFor(message)?.staffId || picks[messages.indexOf(message)] || null;

  const onFile = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    setError('');
    setResult('');
    setApproved(new Set());
    setPicks({});
    try {
      const parsed = parseGroupChat(await readChatFile(file));
      if (!parsed.length) throw new Error('chat_empty');
      setFileName(file.name);
      setGroupBranch(branchFromFileName(file.name, branches));
      setMessages(parsed);
      const names = [...new Set(parsed.filter((m) => m.verdict === 'request' || m.verdict === 'review').map((m) => m.sender))];
      const matches = names.length ? await resolveSenders(names) : [];
      setSenders(matches);
      const suggested: Record<string, string> = {};
      matches.filter((match) => !match.staffId).forEach((match) => {
        const doctor = matchSenderToDoctor(match.sender, doctors);
        if (doctor) suggested[match.sender] = doctor.staffId;
      });
      setChoices(suggested);
    } catch (fileError) {
      console.error('[FollowupRequests] file failed', fileError);
      setMessages([]);
      setSenders([]);
      setError('تعذر قراءة الملف. ارفع ملف تصدير واتساب بصيغة zip أو txt.');
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      for (const sender of unmatched) {
        if (choices[sender.sender]) await linkSender(sender.sender, choices[sender.sender]);
      }
      const chosen = [...requests, ...review.filter((_, index) => approved.has(index))]
        .map((message) => ({ ...message, staffId: doctorFor(message) }));
      const saved = await importFollowupRequests(fileName, chosen, groupBranch);
      const repeated = saved.total - saved.inserted - chosen.filter((m) => !m.staffId && saved.unmatchedSenders.includes(m.sender)).length;
      setResult(`اتسجل ${saved.inserted.toLocaleString('ar-EG')} طلب جديد، واتجاهل ${Math.max(0, repeated).toLocaleString('ar-EG')} طلب متكرر.${saved.unmatchedSenders.length ? ` مش محسوب: ${saved.unmatchedSenders.join('، ')}.` : ''}`);
      setMessages([]);
      setSenders([]);
      setChoices({});
      setPicks({});
      onImported();
    } catch (saveError) {
      console.error('[FollowupRequests] save failed', saveError);
      setError('تعذر حفظ الطلبات، ومفيش طلبات جديدة اتحسبت. جرب تاني.');
    } finally {
      setBusy(false);
    }
  };

  const targetFor = (branch: string) => targets?.get(branch) ?? DEFAULT_BRANCH_REQUEST_TARGET;
  const changeTarget = async (branch: string) => {
    const typed = window.prompt(`هدف طلبات المتابعة في ${branch} للدورة`, String(targetFor(branch)));
    if (typed === null) return;
    const value = Number(typed);
    if (!Number.isInteger(value) || value <= 0) {
      setError('اكتب رقم صحيح أكبر من صفر.');
      return;
    }
    try {
      await saveFollowupRequestTarget(branch, value);
      setTargets(new Map(targets || []).set(branch, value));
    } catch {
      setError('تعذر حفظ الهدف.');
    }
  };

  return (
    <section className="space-y-3 rounded-3xl border p-4" style={surface}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-black text-white">
          <ClipboardList size={18} className="text-amber-300" /> طلبات المتابعة في الدورة
        </h2>
        <label className="btn-secondary cursor-pointer">
          <Upload className="ml-1 inline h-4 w-4" /> {busy ? 'جارٍ…' : 'رفع ملف الجروب'}
          <input type="file" accept=".zip,.txt" className="hidden" disabled={busy} onChange={(event) => { void onFile(event.target.files?.[0]); event.target.value = ''; }} />
        </label>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {branches.map((branch) => {
          const total = counts ? counts.filter((row) => row.branch === branch).reduce((sum, row) => sum + row.requests, 0) : null;
          const target = targetFor(branch);
          return (
            <div key={branch} className="rounded-2xl border p-3" style={surface}>
              <div className="flex items-center justify-between text-sm font-black text-white">
                <span>{branch}</span>
                <button type="button" onClick={() => void changeTarget(branch)} className="text-xs underline" style={mutedText}>تعديل الهدف</button>
              </div>
              <div className="mt-1 text-lg font-black text-amber-200">
                {total === null ? 'غير متاح' : `${total.toLocaleString('ar-EG')} من ${target.toLocaleString('ar-EG')}`}
              </div>
              {total !== null ? (
                <div className="mt-2 h-2 overflow-hidden rounded-full" style={{ background: 'rgba(148,211,226,0.15)' }}>
                  <div className="h-full bg-amber-300" style={{ width: `${Math.min(100, (total / target) * 100)}%` }} />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {error ? <div role="alert" className="rounded-2xl border border-red-300/25 bg-red-500/10 p-3 text-sm font-bold text-red-100">{error}</div> : null}
      {result ? <div className="rounded-2xl border border-teal-300/25 bg-teal-400/10 p-3 text-sm font-bold text-teal-100">{result}</div> : null}

      {messages.length ? (
        <div className="space-y-3">
          <p className="text-sm font-bold text-white">
            {requests.length.toLocaleString('ar-EG')} طلب مؤكد، {review.length.toLocaleString('ar-EG')} محتاجين مراجعتك، {ignored.toLocaleString('ar-EG')} كلام جانبي مش محسوب، {repeats.toLocaleString('ar-EG')} رسالة متكررة اتشالت.
          </p>
          <label className="flex flex-wrap items-center gap-2 text-sm font-bold text-white">
            الملف ده جروب فرع:
            <select aria-label="فرع الجروب" className="input-dark" value={groupBranch} onChange={(event) => setGroupBranch(event.target.value)}>
              <option value="">اختار الفرع</option>
              {branches.map((branch) => <option key={branch} value={branch}>{branch}</option>)}
            </select>
            <span className="text-xs" style={mutedText}>كل طلبات الملف هتتحسب للفرع ده، حتى لو الدكتور شغال في فرع تاني.</span>
          </label>
          {namedCounts.length ? (
            <p className="text-xs font-bold text-teal-200">
              من حسابات مش دكاترة، رسايل فيها اسم الدكتور هتتحسبله: {namedCounts.map(([name, count]) => `${name} ${count.toLocaleString('ar-EG')}`).join('، ')}. لو اخترت دكتور للحساب نفسه، كل رسايله هتروحله هو.
            </p>
          ) : null}
          {unmatched.map((sender) => (
            <label key={sender.sender} className="flex flex-wrap items-center gap-2 text-sm font-bold text-white">
              <span dir="ltr">{sender.sender}</span> هو:
              <select aria-label={`دكتور ${sender.sender}`} className="input-dark" value={choices[sender.sender] || ''} onChange={(event) => setChoices({ ...choices, [sender.sender]: event.target.value })}>
                <option value="">اختار الدكتور</option>
                {doctors.map((doctor) => <option key={doctor.staffId} value={doctor.staffId}>{doctor.name}</option>)}
              </select>
              {choices[sender.sender] ? (
                matchSenderToDoctor(sender.sender, doctors)?.staffId === choices[sender.sender]
                  ? <span className="text-xs text-teal-300">اختيار تلقائي، غيّره لو غلط</span>
                  : null
              ) : <span className="text-xs text-amber-200">الاسم مش واضح، اختار الدكتور</span>}
            </label>
          ))}
          {unnamed.length ? (
            <div className="space-y-1">
              <p className="text-xs font-bold text-amber-200">طلبات من حساب مش دكتور ومفيهاش اسم دكتور. اختار مين كتبها، واللي تسيبه فاضي مش هيتحسب:</p>
              <div className="max-h-64 space-y-1 overflow-y-auto">
                {unnamed.map(({ message, index }) => (
                  <label key={index} className="flex flex-wrap items-start gap-2 text-xs" style={mutedText}>
                    <select aria-label={`دكتور طلب ${message.sentAtLocal}`} className="input-dark py-1 text-xs" value={picks[index] || ''} onChange={(event) => setPicks({ ...picks, [index]: event.target.value })}>
                      <option value="">مش محسوب</option>
                      {doctors.map((doctor) => <option key={doctor.staffId} value={doctor.staffId}>{doctor.name}</option>)}
                    </select>
                    <span className="min-w-0 flex-1"><b>{message.sender} {message.sentAtLocal.slice(5, 16).replace('T', ' ')}:</b> {message.body || 'صورة من غير كلام'}</span>
                  </label>
                ))}
              </div>
            </div>
          ) : null}
          {review.length ? (
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {review.map((message, index) => (
                <label key={`${message.sentAtLocal}-${index}`} className="flex items-start gap-2 text-xs" style={mutedText}>
                  <input
                    type="checkbox"
                    checked={approved.has(index)}
                    onChange={(event) => {
                      const next = new Set(approved);
                      if (event.target.checked) next.add(index); else next.delete(index);
                      setApproved(next);
                    }}
                  />
                  <span><b>{message.sender}{namedFor(message) ? ` ← ${namedFor(message)!.name.trim()}` : ''}:</b> {message.body || 'صورة من غير كلام'}</span>
                </label>
              ))}
            </div>
          ) : null}
          {!groupBranch ? <p className="text-xs font-bold text-amber-200">اختار فرع الجروب الأول عشان تقدر تحفظ.</p> : null}
          <button type="button" onClick={() => void save()} disabled={busy || !groupBranch} className="btn-secondary disabled:opacity-50">
            احفظ {(requests.length + approved.size).toLocaleString('ar-EG')} طلب
          </button>
        </div>
      ) : null}
    </section>
  );
}
