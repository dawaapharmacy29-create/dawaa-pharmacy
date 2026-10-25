import type {
  CaseInvoiceCard as CaseInvoiceCardModel,
  InvoiceLineConversationMatch,
} from '@/lib/salesIntelligence/qa/caseInvoiceCard';

const money = (value: number | null | undefined) =>
  value == null ? '—' : `${value.toFixed(2)} ج.م`;

const MATCH_BADGE: Record<InvoiceLineConversationMatch, string> = {
  explicit: 'dawaa-badge dawaa-badge--success',
  staff_confirmed: 'dawaa-badge dawaa-badge--info',
  partial: 'dawaa-badge dawaa-badge--warning',
  unresolved: 'dawaa-badge dawaa-badge--danger',
  invoice_only: 'dawaa-badge',
};

function Item({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string | null;
}) {
  return (
    <div className="rounded-xl bg-[var(--dawaa-theme-soft)] p-3">
      <div className="dawaa-muted text-xs">{label}</div>
      <div className="dawaa-heading mt-1 text-sm font-bold">{value ?? '—'}</div>
      {hint ? <div className="dawaa-muted mt-1 text-[11px] leading-5">{hint}</div> : null}
    </div>
  );
}

function ConversationItems({ card }: { card: CaseInvoiceCardModel }) {
  return (
    <div className="space-y-2" data-testid="case-conversation-items">
      <h4 className="dawaa-heading text-sm font-black">الأصناف المذكورة أو المطلوبة في المحادثة</h4>
      {!card.conversationItems.length ? (
        <div className="dawaa-muted text-xs">لم يُذكر صنف محدد في رسائل هذه الحالة.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="dawaa-muted border-b border-[var(--dawaa-theme-border)] text-right">
                {['كما ورد في المحادثة', 'الصنف في الكتالوج', 'من ذكره', 'كمية المحادثة', 'مصدر الكمية', 'الرسائل', 'المقابلة بالفاتورة'].map((h) => (
                  <th key={h} className="p-2">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {card.conversationItems.map((item) => (
                <tr key={item.productKey} className="border-b border-[var(--dawaa-theme-border)]/60 align-top">
                  <td className="p-2 font-bold" dir="auto">{item.nameInConversation}</td>
                  <td className="p-2" dir="auto">
                    {item.catalogName
                      ? `${item.catalogName}${item.productCode ? ` (${item.productCode})` : ''}`
                      : item.candidateNames.length
                        ? `غير محسوم: ${item.candidateNames.join(' أو ')}`
                        : 'غير محسوم'}
                  </td>
                  <td className="p-2">{item.mentionLabel}</td>
                  <td className="p-2">{item.conversationQuantity ?? '—'}</td>
                  <td className="p-2">{item.quantitySourceLabel}</td>
                  <td className="max-w-[320px] p-2 leading-5">
                    {item.evidenceMessages.map((m) => (
                      <div key={m.id} dir="auto">
                        <span className="dawaa-muted">{m.role === 'customer' ? 'العميل' : 'الموظف'} • {m.at}:</span> {m.text}
                      </div>
                    ))}
                  </td>
                  <td className="p-2">
                    {item.linkLabel}
                    {item.invoiceQuantity != null ? ` • كمية الفاتورة ${item.invoiceQuantity}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** The invoice inside the selected case, in one card. Read-only; every value comes from the case page bundle. */
export function CaseInvoiceCard({ card }: { card: CaseInvoiceCardModel }) {
  if (!card.available) {
    return (
      <div className="space-y-3">
        <ConversationItems card={card} />
        <div className="dawaa-empty-state py-4 text-center" data-testid="case-invoice-card-empty">
          {card.unavailableReason}
        </div>
      </div>
    );
  }
  const { customer, invoice, verdicts } = card;
  return (
    <div className="space-y-3" data-testid="case-invoice-card">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <Item
          label="رقم الفاتورة"
          value={invoice.number}
          hint={invoice.id ? `معرف السجل: ${invoice.id}` : null}
        />
        <Item label="كود العميل" value={customer.code} hint={customer.analyticStatusLabel} />
        <Item
          label="ربط العميل الرسمي"
          value={customer.sourceLinkLabel}
          hint={customer.invoiceLinkLabel}
        />
        <Item
          label="إجمالي الفاتورة (رأس الفاتورة)"
          value={money(invoice.headerTotal)}
          hint={`مجموع صافي البنود: ${money(invoice.linesNetTotal)}${invoice.bconnectInvoiceNet != null ? ` • صافي B-Connect: ${money(invoice.bconnectInvoiceNet)}` : ''} — ${invoice.totalsLabel}`}
        />
        <Item
          label="فرع المعاملة (من الفاتورة)"
          value={invoice.transactionBranch}
          hint="فرع الفاتورة نفسها؛ لا يغيّر فرع مصدر المحادثة."
        />
        <Item
          label="فرع مصدر المحادثة"
          value={invoice.sourceBranch}
          hint={`فرع هذه الحالة: ${invoice.caseBranchLabel}`}
        />
        <Item
          label="البائع على الفاتورة"
          value={invoice.sellerName}
          hint={invoice.sellerResolutionLabel}
        />
        <Item
          label="الدكتور المنسوب لرسائل هذه الحالة"
          value={
            invoice.caseDoctors.length
              ? invoice.caseDoctors.map((d) => `${d.name} (${d.messageCount} رسالة)`).join('، ')
              : 'لا يوجد'
          }
          hint={invoice.sellerVsCaseLabel}
        />
        <Item label="توقيت الفاتورة" value={invoice.invoiceAtLocal} hint={invoice.timeZoneLabel} />
        <Item label="فترة الحالة" value={invoice.caseWindowLocal} hint={invoice.timeZoneLabel} />
      </div>

      <div className="space-y-2" data-testid="case-invoice-verdicts">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          <Item label="١. هل الفاتورة تخص هذه الحالة؟" value={verdicts.invoiceBelongsToCase} />
          <Item label="٢. تأكيد العميل النهائي للطلب" value={verdicts.customerFinalConfirmation} />
          <Item label="٣. هل طُلبت بنود الفاتورة في المحادثة؟" value={verdicts.lineRequests} />
          <Item label="٤. التسليم" value={verdicts.delivery} />
          <Item label="٥. فرع المعاملة مقابل فرع الحالة" value={verdicts.branch} />
        </div>
        <div className="dawaa-alert dawaa-alert--info text-xs leading-6" data-testid="case-invoice-counting">
          {verdicts.counting}
        </div>
      </div>

      <ConversationItems card={card} />

      <h4 className="dawaa-heading text-sm font-black" data-testid="case-invoice-sold-title">
        الأصناف المباعة حسب الفاتورة {invoice.number ?? ''} — {invoice.transactionBranch ?? 'فرع غير متاح'}
      </h4>
      <div className="dawaa-muted text-[11px] leading-5">
        من صفوف بنود الفاتورة نفسها. بند «بالفاتورة فقط» مباع حسب الفاتورة ولا يُنسب لطلب من العميل.
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs" data-testid="case-invoice-lines">
          <thead>
            <tr className="dawaa-muted border-b border-[var(--dawaa-theme-border)] text-right">
              {[
                '#',
                'الصنف كما في الفاتورة',
                'الكود',
                'الكمية',
                'المرتجع',
                'سعر الوحدة بالفاتورة',
                'الإجمالي قبل الخصم',
                'خصم البند',
                'صافي البند',
                'المقابلة مع المحادثة',
                'الدليل',
              ].map((h) => (
                <th key={h} className="p-2">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {card.lines.map((line) => (
              <tr
                key={line.id}
                className="border-b border-[var(--dawaa-theme-border)]/60 align-top"
              >
                <td className="p-2">{line.lineNo ?? '—'}</td>
                <td className="p-2 font-bold" dir="auto">
                  {line.productName || '—'}
                </td>
                <td className="p-2 font-mono">{line.productCode || '—'}</td>
                <td className="p-2">
                  {line.quantity ?? '—'}
                  {line.unitName ? ` ${line.unitName}` : ''}
                </td>
                <td className="p-2">{line.returnedQuantity ?? 0}</td>
                <td className="p-2">{money(line.unitPrice)}</td>
                <td className="p-2">{money(line.grossLineAmount)}</td>
                <td className="p-2">{money(line.itemDiscountAmount)}</td>
                <td className="p-2">{money(line.netLineAmount)}</td>
                <td className="p-2">
                  <span className={MATCH_BADGE[line.match]}>{line.matchLabel}</span>
                </td>
                <td className="max-w-[360px] p-2 leading-5">{line.evidence}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="dawaa-muted text-[11px] leading-5">
        الأسعار والقيم من سجل بنود الفاتورة نفسها (سعر تاريخي)، وليست أسعار الكتالوج الحالية. صافي
        البند بعد توزيع خصم الفاتورة كما سجله B-Connect.
      </div>
    </div>
  );
}
