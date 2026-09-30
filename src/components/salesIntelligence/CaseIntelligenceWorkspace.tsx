// Unified Case Intelligence Workspace — DISPLAY ONLY.
//
// Renders the persisted `caseIntelligence` read model of one commercial interaction. It never
// re-decides sale / lost / follow-up / availability / identity / product matching, never runs an
// engine, never reads legacy V6/V7/V22 truth and never writes anything. Unknown values render as
// "غير محسوم". Technical identifiers live under "تفاصيل متقدمة" only.
import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, CircleHelp, X } from 'lucide-react';
import type { CaseIntelligenceView, ConfidenceAssessment } from '@/lib/salesIntelligence/types';
import {
  UNKNOWN_LABEL,
  alternativeResponseLabel,
  assignedRoleLabel,
  availabilityLabel,
  basketStatusLabel,
  confidenceBand,
  confirmationStateLabel,
  duePolicyLabel,
  followUpDecisionLabel,
  followUpReasonLabel,
  followUpStatusLabel,
  identityStatusLabel,
  journeyStateLabel,
  lostReasonLabel,
  lostStageLabel,
  lostStateLabel,
  nextBestActionLabel,
  objectionLabel,
  productLossLabel,
  productStatus,
  recoverabilityLabel,
  responsibilityLabel,
  reviewReasonLabel,
  saleOutcomeLabel,
  saleProofLabel,
  staffFactLabel,
  suppressionLabel,
  waitingOnLabel,
} from '@/lib/salesIntelligence/qa/caseIntelligencePresentation';

export type CaseIntelligenceTab = 'conversation' | 'need' | 'products' | 'sale' | 'lost' | 'followup' | 'review';

export interface CaseInvoiceEvidence {
  status: 'trusted' | 'candidate' | 'none';
  invoiceNumber: string | null;
  items: Array<{
    id: string;
    productName: string;
    productCode: string | null;
    quantity: number | null;
    unitName: string | null;
    netLineAmount: number | null;
  }>;
}

const TABS: Array<{ key: CaseIntelligenceTab; label: string }> = [
  { key: 'conversation', label: 'المحادثة' },
  { key: 'need', label: 'طلب العميل' },
  { key: 'products', label: 'الأصناف' },
  { key: 'sale', label: 'الطلب والبيع' },
  { key: 'lost', label: 'الفرصة' },
  { key: 'followup', label: 'المتابعة' },
  { key: 'review', label: 'الأدلة والمراجعة' },
];

interface EvidenceRequest {
  title: string;
  reason: string;
  confidence?: ConfidenceAssessment | { level: ConfidenceAssessment['level'] } | null;
  messageIds: string[];
}

function formatTime(iso: string | null | undefined) {
  if (!iso) return UNKNOWN_LABEL;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return UNKNOWN_LABEL;
  return date.toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' });
}

function toneClass(tone: string) {
  switch (tone) {
    case 'good':
    case 'high':
      return 'dawaa-badge dawaa-badge--success';
    case 'warn':
    case 'medium':
      return 'dawaa-badge dawaa-badge--warning';
    case 'bad':
    case 'low':
      return 'dawaa-badge dawaa-badge--danger';
    default:
      return 'dawaa-badge dawaa-badge--info';
  }
}

function Badge({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={toneClass(tone)}>{children}</span>;
}

function Confidence({ level }: { level: ConfidenceAssessment['level'] | null | undefined }) {
  const band = confidenceBand(level ?? null);
  return <Badge tone={band.tone}>الثقة: {band.label}</Badge>;
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-[var(--dawaa-theme-soft)] p-3">
      <div className="dawaa-muted text-xs">{label}</div>
      <div className="dawaa-heading mt-1 text-sm font-bold">{children}</div>
    </div>
  );
}

function WhyButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="dawaa-button dawaa-button--ghost text-xs">
      <CircleHelp size={14} /> لماذا؟
    </button>
  );
}

function Block({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="dawaa-card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="dawaa-heading text-sm font-black">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

export function CaseIntelligenceWorkspace({
  view,
  initialTab = 'conversation',
  conversationPanel = null,
  invoiceEvidence = null,
}: {
  view: CaseIntelligenceView | null;
  initialTab?: CaseIntelligenceTab;
  conversationPanel?: React.ReactNode;
  invoiceEvidence?: CaseInvoiceEvidence | null;
}) {
  const [tab, setTab] = useState<CaseIntelligenceTab>(initialTab);
  const [evidence, setEvidence] = useState<EvidenceRequest | null>(null);
  const [showReview, setShowReview] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const messageById = useMemo(
    () => new Map((view?.interaction.messages ?? []).map((m) => [m.id, m])),
    [view]
  );

  if (!view) {
    return (
      <div className="dawaa-alert dawaa-alert--info text-sm font-bold" data-testid="case-intelligence-unavailable">
        التحليل الموحد غير متاح لهذه الحالة القديمة. سيظهر بعد إعادة تحليلها بالمسار الحالي.
      </div>
    );
  }

  const staffNames = view.staff.participants.map((p) => p.sender);
  const mainStaff = view.staff.participants.slice().sort((a, b) => b.messageCount - a.messageCount)[0]?.sender ?? null;
  const highlighted = new Set(evidence?.messageIds ?? view.evidenceSummary.evidenceMessageIds);
  const open = (request: EvidenceRequest) => {
    setEvidence(request);
  };
  const followUpActive = view.followUp.opportunities.filter((o) => o.status !== 'suppressed');

  return (
    <section className="space-y-4" data-testid="case-intelligence-workspace">
      {/* Header: the 10-second answer */}
      <div className="dawaa-card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="dawaa-heading text-base font-black">ملخص الحالة</h2>
          {view.review.required ? (
            <button type="button" className="dawaa-badge dawaa-badge--warning" onClick={() => setShowReview((v) => !v)} data-testid="review-badge">
              <AlertTriangle size={14} /> يحتاج مراجعة
            </button>
          ) : (
            <Badge tone="good"><CheckCircle2 size={14} /> لا يحتاج مراجعة</Badge>
          )}
        </div>
        {showReview && view.review.required ? (
          <ul className="dawaa-alert dawaa-alert--warning list-disc space-y-1 ps-6 text-xs" data-testid="review-reasons">
            {view.review.reasons.map((r) => (
              <li key={r.code}>{reviewReasonLabel(r.code)}</li>
            ))}
          </ul>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Fact label="العميل">
            {view.customer.customerId ? identityStatusLabel(view.customer.identityStatus) : <Badge tone="warn">{identityStatusLabel(view.customer.identityStatus)}</Badge>}
          </Fact>
          <Fact label="وقت التفاعل">{formatTime(view.interaction.startedAt)}</Fact>
          <Fact label="الفرع">{view.branch.branchNameRaw || UNKNOWN_LABEL}</Fact>
          <Fact label="الموظف">{mainStaff ?? 'لم يرد أحد'}{staffNames.length > 1 ? ` (+${staffNames.length - 1})` : ''}</Fact>
          <Fact label="مرحلة البيع">{journeyStateLabel(view.journey.currentState)}</Fact>
          <Fact label="نتيجة البيع">{saleOutcomeLabel(view.sale.outcome)}</Fact>
          <Fact label="حالة الفرصة">
            {lostStateLabel(view.lostOpportunity.state)}
            {view.lostOpportunity.reason ? ` — ${lostReasonLabel(view.lostOpportunity.reason)}` : ''}
          </Fact>
          <Fact label="المتابعة">{followUpDecisionLabel(view.followUp.decision)}</Fact>
        </div>
      </div>

      <div className="dawaa-tabs flex flex-wrap gap-1" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={`dawaa-tab ${tab === t.key ? 'is-active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'conversation' ? (
        conversationPanel ? (
          <div data-testid="conversation-whatsapp-panel">{conversationPanel}</div>
        ) : (
          <Block title="رسائل هذا التفاعل فقط" action={<span className="dawaa-muted text-xs">{view.interaction.messages.length} رسالة</span>}>
            <ol className="space-y-2" data-testid="conversation-messages">
              {view.interaction.messages.map((m) => (
                <li
                  key={m.id}
                  className={`rounded-xl border p-3 text-sm ${m.role === 'staff' ? 'border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-soft)]' : 'border-[var(--dawaa-theme-divider)]'} ${highlighted.has(m.id) ? 'ring-2 ring-[var(--dawaa-theme-primary)]' : ''}`}
                  data-evidence={highlighted.has(m.id) ? 'true' : undefined}
                >
                  <div className="dawaa-muted flex justify-between text-xs">
                    <span className="font-bold">{m.role === 'staff' ? `الصيدلية — ${m.sender}` : m.role === 'customer' ? 'العميل' : 'النظام'}</span>
                    <span>{formatTime(m.at)}</span>
                  </div>
                  <div className="mt-1 whitespace-pre-wrap leading-7">{m.text}</div>
                </li>
              ))}
            </ol>
          </Block>
        )
      ) : null}

      {tab === 'need' ? (
        <Block title="طلب العميل" action={<Confidence level={view.need.confidence.level} />}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Fact label="الطلب الأساسي">{view.need.primaryNeed || UNKNOWN_LABEL}</Fact>
            <Fact label="هوية العميل">{identityStatusLabel(view.customer.identityStatus)}</Fact>
            <Fact label="الطلب مكتمل؟">{view.need.unresolvedNeed ? 'لا — الطلب لم يكتمل بعد' : 'نعم أو لم يعد مطلوبًا'}</Fact>
            <Fact label="رفض العميل للطلب نفسه؟">{view.need.needDeclined ? 'نعم' : 'لا'}</Fact>
          </div>
          <ul className="space-y-1 text-sm">
            {view.products.filter((p) => p.roles.includes('requested')).map((p) => (
              <li key={p.productKey}>• {p.productNameRaw} — الكمية: {p.requestedQuantity ?? UNKNOWN_LABEL}</li>
            ))}
          </ul>

          {view.need.unresolvedNeed && invoiceEvidence?.status === 'trusted' ? (
            <div className="dawaa-card dawaa-card--soft space-y-2" data-testid="need-trusted-invoice-fallback">
              <div className="dawaa-heading text-sm font-black">مرجع التنفيذ من الفاتورة الموثوقة</div>
              <div className="dawaa-muted text-xs leading-6">
                اسم الصنف غير محسوم من نص المحادثة نفسه. الأصناف التالية مصدرها الفاتورة المرتبطة الموثوقة
                {invoiceEvidence.invoiceNumber ? ` رقم ${invoiceEvidence.invoiceNumber}` : ''}، وتوضح ما تم صرفه فعليًا — وليست ادعاءً بأن الصورة/الفويس تم قراءته.
              </div>
              {invoiceEvidence.items.length ? (
                <ul className="space-y-1 text-sm">
                  {invoiceEvidence.items.map((item) => (
                    <li key={item.id}>
                      • {item.productName || 'صنف بدون اسم'} — الكمية: {item.quantity ?? UNKNOWN_LABEL}{item.unitName ? ` ${item.unitName}` : ''}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="dawaa-muted text-xs">تفاصيل أصناف الفاتورة غير متاحة حاليًا.</div>
              )}
            </div>
          ) : view.need.unresolvedNeed && invoiceEvidence?.status === 'candidate' ? (
            <div className="dawaa-alert dawaa-alert--warning text-xs leading-6" data-testid="need-candidate-invoice-not-used">
              الطلب غير واضح من المحادثة، وتوجد فاتورة مرشحة
              {invoiceEvidence.invoiceNumber ? ` رقم ${invoiceEvidence.invoiceNumber}` : ''}،
              لكن الربط غير موثوق بعد؛ لذلك لا نستخدم أصنافها لتفسير الصورة أو الفويس تلقائيًا.
            </div>
          ) : null}

          {view.need.objections.length ? (
            <div className="space-y-1 text-sm">
              <div className="dawaa-muted text-xs">اعتراضات العميل</div>
              {view.need.objections.map((o) => (
                <div key={o.messageId} className="flex items-center justify-between gap-2">
                  <span>{objectionLabel(o.category)}: «{o.text}»</span>
                  <WhyButton onClick={() => open({ title: 'اعتراض العميل', reason: objectionLabel(o.category), confidence: o.confidence, messageIds: [o.messageId] })} />
                </div>
              ))}
            </div>
          ) : null}
        </Block>
      ) : null}

      {tab === 'products' ? (
        <div className="space-y-3">
          {invoiceEvidence?.status === 'trusted' ? (
            <div className="dawaa-card space-y-3" data-testid="trusted-invoice-products">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="dawaa-heading text-sm font-black">أصناف مثبتة من الفاتورة المرتبطة</h3>
                  <div className="dawaa-muted mt-1 text-xs">
                    مصدر تنفيذي مستقل عن نص المحادثة{invoiceEvidence.invoiceNumber ? ` • فاتورة ${invoiceEvidence.invoiceNumber}` : ''}
                  </div>
                </div>
                <Badge tone="good">فاتورة موثوقة</Badge>
              </div>
              <div className="dawaa-alert dawaa-alert--info text-xs leading-6">
                لو اسم الصنف غير ظاهر لأن الطلب كان صورة أو فويس، نستخدم أصناف الفاتورة الموثوقة لمعرفة ما تم صرفه فعليًا.
                هذه الأصناف لا تعني أن نص المحادثة نفسه كشف اسم الصنف، ولا تستبدل دليل الطلب الأصلي.
              </div>
              {invoiceEvidence.items.length ? (
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {invoiceEvidence.items.map((item) => (
                    <div key={item.id} className="rounded-xl bg-[var(--dawaa-theme-soft)] p-3" data-invoice-product={item.productName}>
                      <div className="dawaa-heading text-sm font-black">{item.productName || 'صنف بدون اسم'}</div>
                      <div className="dawaa-muted mt-1 text-xs">
                        {item.productCode ? `كود: ${item.productCode} • ` : ''}
                        الكمية: {item.quantity ?? UNKNOWN_LABEL}{item.unitName ? ` ${item.unitName}` : ''}
                      </div>
                      {item.netLineAmount != null ? <div className="dawaa-muted mt-1 text-xs">صافي السطر: {item.netLineAmount.toFixed(2)} ج.م</div> : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="dawaa-muted text-sm">الفاتورة موثوقة، لكن تفاصيل أصنافها غير متاحة حاليًا.</div>
              )}
            </div>
          ) : invoiceEvidence?.status === 'candidate' ? (
            <div className="dawaa-alert dawaa-alert--warning text-xs leading-6" data-testid="candidate-invoice-products-blocked">
              توجد فاتورة مرشحة{invoiceEvidence.invoiceNumber ? ` رقم ${invoiceEvidence.invoiceNumber}` : ''}، لكن الربط غير موثوق بما يكفي لاستخدام أصنافها بدل محتوى الصورة/الفويس.
            </div>
          ) : null}

          <div className="grid gap-3 md:grid-cols-2" data-testid="product-cards">
          {view.products.map((p) => {
            const status = productStatus(p, view.sale.outcome);
            const demand = view.unavailableDemand.find((d) => d.demandKey === p.demandKey);
            const need = view.need.products.find((n) => n.key === p.productKey);
            const followUps = view.followUp.opportunities.filter((o) => p.followUpKeys.includes(o.followUpKey));
            return (
              <div key={p.productKey} className="dawaa-card space-y-2" data-product={p.productNameRaw}>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="dawaa-heading text-sm font-black">{p.productNameRaw}</h3>
                  <Badge tone={status.tone}>{status.label}</Badge>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <Fact label="الكمية المطلوبة">{p.requestedQuantity ?? UNKNOWN_LABEL}</Fact>
                  <Fact label="التوفر">{availabilityLabel(p.availability === 'unknown' ? null : p.availability)}</Fact>
                  <Fact label="البديل">{need?.alternatives.map((a) => a.productNameRaw || 'بديل غير مسمى').join('، ') || 'لا يوجد'}</Fact>
                  <Fact label="رد العميل">{p.alternativeResponses.length ? p.alternativeResponses.map((r) => alternativeResponseLabel(r)).join('، ') : '—'}</Fact>
                  <Fact label="في الطلب النهائي">{p.inFinalBasket ? 'نعم' : 'لا'}</Fact>
                  <Fact label="المتابعة">{followUps.length ? followUps.map((o) => `${followUpReasonLabel(o.reason)} (${followUpStatusLabel(o.status)})`).join('، ') : 'لا يوجد'}</Fact>
                </div>
                {demand ? (
                  <WhyButton
                    onClick={() =>
                      open({
                        title: `${p.productNameRaw}: ${availabilityLabel(demand.availabilityState)}`,
                        reason: `${demand.statedByStaffName} قال ذلك${demand.alternativeOffered ? ` — ${alternativeResponseLabel(demand.alternativeResponse)}` : ''}`,
                        confidence: demand.confidence,
                        messageIds: demand.evidenceMessageIds,
                      })
                    }
                  />
                ) : null}
              </div>
            );
          })}
          {view.products.length === 0 ? <div className="dawaa-muted text-sm">لا توجد أصناف واضحة من نص هذا التفاعل.</div> : null}
          </div>
        </div>
      ) : null}

      {tab === 'sale' ? (
        <div className="space-y-3">
          <Block title="الطلب (السلة)">
            <div className="grid gap-3 sm:grid-cols-3">
              <Fact label="حالة التأكيد">{confirmationStateLabel(view.sale.confirmationState)}</Fact>
              <Fact label="الإجمالي المعلن">{view.basket.announcedTotal != null ? `${view.basket.announcedTotal} جنيه` : 'لم يُعلن'}</Fact>
              <Fact label="نسخ السلة">{view.basket.versions.length}</Fact>
            </div>
            <ul className="space-y-1 text-sm">
              {view.basket.activeItems.map((item) => (
                <li key={item.itemId}>• {item.productNameRaw} — {item.quantity ?? UNKNOWN_LABEL}</li>
              ))}
            </ul>
            <div className="dawaa-muted text-xs">{view.basket.versions.map((b) => `نسخة ${b.version}: ${basketStatusLabel(b.status)}`).join(' · ')}</div>
          </Block>
          <Block title="البيع">
            <div className="grid gap-3 sm:grid-cols-2">
              <Fact label="نتيجة البيع">{saleOutcomeLabel(view.sale.outcome)}</Fact>
              <Fact label="إثبات البيع">{saleProofLabel(view.sale.proofState === 'unknown' ? null : view.sale.proofState)}</Fact>
              <Fact label="الفاتورة المختارة">{view.sale.selectedInvoiceNumber || 'لا توجد'}</Fact>
              <Fact label="فواتير مرشحة">{view.sale.invoiceCandidateIds.length} (مرشحة فقط — ليست بيعًا)</Fact>
            </div>
            {view.sale.contradictions.length ? (
              <div className="dawaa-alert dawaa-alert--warning text-xs">يوجد تعارض في الإسناد يحتاج مراجعة.</div>
            ) : null}
          </Block>
        </div>
      ) : null}

      {tab === 'lost' ? (
        <Block
          title="حالة الفرصة"
          action={
            <WhyButton
              onClick={() =>
                open({
                  title: lostStateLabel(view.lostOpportunity.state),
                  reason: view.lostOpportunity.reason ? lostReasonLabel(view.lostOpportunity.reason) : lostStateLabel(view.lostOpportunity.state),
                  confidence: view.lostOpportunity.confidence,
                  messageIds: view.lostOpportunity.evidenceMessageIds,
                })
              }
            />
          }
        >
          {view.lostOpportunity.state === 'won' && view.lostOpportunity.productLosses.length ? (
            <div className="dawaa-alert dawaa-alert--info text-xs">التفاعل نفسه انتهى ببيع، لكن فيه صنف لم يُبع ويظهر بالأسفل.</div>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <Fact label="الحالة">{lostStateLabel(view.lostOpportunity.state)}</Fact>
            <Fact label="السبب">{view.lostOpportunity.reason ? lostReasonLabel(view.lostOpportunity.reason) : '—'}</Fact>
            <Fact label="المرحلة">{lostStageLabel(view.lostOpportunity.stage === 'unknown' ? null : view.lostOpportunity.stage)}</Fact>
            <Fact label="المسؤولية">{responsibilityLabel(view.lostOpportunity.responsibility === 'unknown' ? null : view.lostOpportunity.responsibility)}</Fact>
            <Fact label="إمكانية الاسترداد">{recoverabilityLabel(view.lostOpportunity.recoverability === 'unknown' ? null : view.lostOpportunity.recoverability)}</Fact>
            <Fact label="في انتظار">{view.lostOpportunity.waitingOn ? waitingOnLabel(view.lostOpportunity.waitingOn) : '—'}</Fact>
          </div>
          {view.lostOpportunity.productLosses.length ? (
            <ul className="space-y-1 text-sm" data-testid="product-losses">
              {view.lostOpportunity.productLosses.map((l) => (
                <li key={l.productKey}>• {l.requestedProductRaw}: {productLossLabel(l.outcome === 'unknown' ? null : l.outcome)}{l.reason ? ` — ${lostReasonLabel(l.reason)}` : ''}</li>
              ))}
            </ul>
          ) : null}
        </Block>
      ) : null}

      {tab === 'followup' ? (
        <div className="space-y-3">
          <div className="dawaa-muted text-sm">{followUpDecisionLabel(view.followUp.decision)}{view.followUp.notNeededReason ? ` — ${suppressionLabel(view.followUp.notNeededReason)}` : ''}</div>
          {view.followUp.opportunities.map((o) => (
            <div key={o.followUpKey} className="dawaa-card space-y-2" data-followup={o.status}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="dawaa-heading text-sm font-black">{nextBestActionLabel(o.nextBestAction)}</h3>
                <Badge tone={o.status === 'actionable' ? 'warn' : o.status === 'blocked' ? 'bad' : 'neutral'}>{followUpStatusLabel(o.status)}</Badge>
              </div>
              <div className="grid gap-2 text-xs sm:grid-cols-2 xl:grid-cols-3">
                <Fact label="السبب">{followUpReasonLabel(o.reason)}</Fact>
                <Fact label="الصنف">{o.productRaw || '—'}</Fact>
                <Fact label="الأولوية">{o.priority === 'high' ? 'عالية' : o.priority === 'medium' ? 'متوسطة' : 'منخفضة'}</Fact>
                <Fact label="الموعد">{duePolicyLabel(o.duePolicy)}{o.dueAt ? ` — ${formatTime(o.dueAt)}` : ''}</Fact>
                <Fact label="المسؤول">{o.assignedStaffName ? `${o.assignedStaffName} (${assignedRoleLabel(o.assignedRole)})` : assignedRoleLabel(o.assignedRole)}</Fact>
                <Fact label="لماذا متوقفة/معطلة">{o.blocker ? 'هوية العميل غير محسومة' : o.suppressedBy ? suppressionLabel(o.suppressedBy) : '—'}</Fact>
              </div>
              <WhyButton onClick={() => open({ title: nextBestActionLabel(o.nextBestAction), reason: followUpReasonLabel(o.reason), confidence: o.confidence, messageIds: o.evidenceMessageIds })} />
            </div>
          ))}
          {followUpActive.length === 0 && view.followUp.opportunities.length === 0 ? <div className="dawaa-muted text-sm">لا توجد متابعة لهذا التفاعل.</div> : null}
        </div>
      ) : null}

      {tab === 'review' ? (
        <div className="space-y-3">
          <Block title={`يحتاج مراجعة؟ ${view.review.required ? 'نعم' : 'لا'}`}>
            {view.review.reasons.length ? (
              <ul className="list-disc space-y-1 ps-6 text-sm">
                {view.review.reasons.map((r) => (
                  <li key={r.code}>{reviewReasonLabel(r.code)}</li>
                ))}
              </ul>
            ) : (
              <div className="dawaa-muted text-sm">لا توجد أسباب مراجعة.</div>
            )}
          </Block>
          <Block title="من قال ماذا">
            <ul className="space-y-1 text-sm" data-testid="staff-facts">
              {view.staff.facts.map((f) => (
                <li key={`${f.fact}-${f.messageId}-${f.productKey ?? ''}`} className="flex items-center justify-between gap-2">
                  <span>{f.staffSender}: {staffFactLabel(f.fact)}{f.productKey ? ` (${view.products.find((p) => p.productKey === f.productKey)?.productNameRaw ?? ''})` : ''}</span>
                  <WhyButton onClick={() => open({ title: staffFactLabel(f.fact), reason: f.staffSender, confidence: null, messageIds: [f.messageId] })} />
                </li>
              ))}
              {view.staff.facts.length === 0 ? <li className="dawaa-muted">لا توجد أقوال موظفين مسجلة.</li> : null}
            </ul>
          </Block>
          <button type="button" className="dawaa-button dawaa-button--ghost text-xs" onClick={() => setShowAdvanced((v) => !v)}>
            {showAdvanced ? 'إخفاء التفاصيل المتقدمة' : 'تفاصيل متقدمة'}
          </button>
          {showAdvanced ? (
            <div className="dawaa-card space-y-1 text-xs" data-testid="advanced-details">
              <div>المعرف: <span className="font-mono">{view.caseId}</span></div>
              <div>المحادثة: <span className="font-mono">{view.conversationId}</span></div>
              <div>نسخة العرض: <span className="font-mono">{view.version}</span></div>
              <div>سبب تقسيم التفاعل: <span className="font-mono">{view.interaction.segmentationReason ?? '—'}</span></div>
              <div>قواعد الفرصة: <span className="font-mono">{view.lostOpportunity.explanation}</span></div>
            </div>
          ) : null}
        </div>
      ) : null}

      {evidence ? (
        <div className="dawaa-card space-y-2 border border-[var(--dawaa-theme-border)]" data-testid="evidence-drawer">
          <div className="flex items-center justify-between gap-2">
            <h3 className="dawaa-heading text-sm font-black">لماذا: {evidence.title}</h3>
            <button type="button" className="dawaa-button dawaa-button--ghost text-xs" onClick={() => setEvidence(null)}>
              <X size={14} /> إغلاق
            </button>
          </div>
          <div className="text-sm">{evidence.reason}</div>
          {evidence.confidence ? <Confidence level={evidence.confidence.level} /> : null}
          <ul className="space-y-1 text-sm">
            {evidence.messageIds.map((id) => messageById.get(id)).filter(Boolean).map((m) => (
              <li key={m!.id} className="rounded-lg bg-[var(--dawaa-theme-soft)] p-2">
                <div className="dawaa-muted text-xs">{m!.role === 'staff' ? m!.sender : 'العميل'} — {formatTime(m!.at)}</div>
                <div>{m!.text}</div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

export default CaseIntelligenceWorkspace;
