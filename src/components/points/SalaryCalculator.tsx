import html2canvas from "html2canvas";
import { Calculator, FileText, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { jsPDF } from "jspdf";
import { formatCurrency } from "@/lib/utils";
import { calculateIncentive, POINT_VALUE_EGP, STARTING_POINTS } from "@/lib/points";
import { cleanTechnicalText, formatTransactionExecutor, formatTransactionSource, getTransactionShortReason } from "@/lib/pointsLedger";

export interface IncentiveTransaction {
  id: string;
  type: string;
  reason?: string | null;
  manager_note?: string | null;
  description?: string | null;
  source?: string | null;
  source_type?: string | null;
  created_by?: string | null;
  created_at?: string | null;
  points?: number | null;
  points_delta?: number | null;
  status?: string | null;
}

interface SalaryCalculatorProps {
  staffName: string;
  role?: string | null;
  branch?: string | null;
  cycleLabel: string;
  currentPoints: number;
  maxPoints?: number;
  rewardPoints: number;
  penaltyPoints: number;
  records: IncentiveTransaction[];
}

function transactionPoints(row: IncentiveTransaction) {
  return Math.abs(Number(row.points ?? row.points_delta ?? 0) || 0);
}

function transactionKind(row: IncentiveTransaction) {
  return row.type === "reward" || row.type === "bonus" || row.type === "مكافأة" ? "reward" : "penalty";
}

function transactionKey(row: IncentiveTransaction) {
  return String(row.id || `${row.source_type || row.source || "unknown"}:${row.created_at || ""}:${row.points_delta ?? row.points ?? ""}:${row.reason || row.description || ""}`);
}

function uniqueTransactions(rows: IncentiveTransaction[]) {
  const map = new Map<string, IncentiveTransaction>();
  for (const row of rows) {
    const key = transactionKey(row);
    if (!map.has(key)) map.set(key, row);
  }
  return [...map.values()];
}

function cleanFileName(value: string) {
  return value
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(value: unknown) {
  return String(value ?? "-")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function rowDate(row: IncentiveTransaction) {
  return row.created_at ? new Date(row.created_at).toLocaleDateString("ar-EG") : "-";
}

function rowDetails(row: IncentiveTransaction) {
  const details = cleanTechnicalText(row.manager_note || row.description || "");
  return details || getTransactionShortReason(row as unknown as Record<string, unknown>) || "-";
}

function buildTransactionRows(rows: IncentiveTransaction[]) {
  if (!rows.length) {
    return `
      <tr>
        <td colspan="7" class="empty-cell">لا توجد سجلات في هذه الدورة</td>
      </tr>
    `;
  }

  return rows
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(rowDate(row))}</td>
          <td>${escapeHtml(getTransactionShortReason(row as unknown as Record<string, unknown>))}</td>
          <td>${escapeHtml(transactionPoints(row))}</td>
          <td>${escapeHtml(rowDetails(row))}</td>
          <td>${escapeHtml(formatTransactionSource(row as unknown as Record<string, unknown>))}</td>
          <td>${escapeHtml(formatTransactionExecutor(row as unknown as Record<string, unknown>))}</td>
          <td>${escapeHtml(row.status === "pending" ? "قيد المراجعة" : row.status === "rejected" ? "مرفوض" : "معتمد")}</td>
        </tr>
      `,
    )
    .join("");
}

function buildReportHtml(props: SalaryCalculatorProps) {
  const targetPoints = props.maxPoints || STARTING_POINTS;
  const finalIncentive = calculateIncentive(props.currentPoints);
  const rewardMoney = props.rewardPoints * POINT_VALUE_EGP;
  const penaltyMoney = props.penaltyPoints * POINT_VALUE_EGP;
  const uniqueRecords = uniqueTransactions(props.records);
  const rewardRows = uniqueRecords.filter((row) => transactionKind(row) === "reward");
  const penaltyRows = uniqueRecords.filter((row) => transactionKind(row) === "penalty");

  return `
    <div class="report">
      <header class="report-header">
        <img src="/dawaa-logo-full.jpeg" alt="صيدليات دواء" />
        <div>
          <h1>صيدليات دواء</h1>
          <h2>تقرير حساب الحوافز</h2>
          <p>تاريخ الإصدار: ${escapeHtml(new Date().toLocaleString("ar-EG"))}</p>
        </div>
      </header>

      <section class="section">
        <h3>بيانات الموظف</h3>
        <div class="info-grid">
          <div><span>الموظف</span><strong>${escapeHtml(props.staffName)}</strong></div>
          <div><span>الدور</span><strong>${escapeHtml(props.role || "-")}</strong></div>
          <div><span>الفرع</span><strong>${escapeHtml(props.branch || "-")}</strong></div>
          <div><span>الدورة</span><strong>${escapeHtml(props.cycleLabel)}</strong></div>
        </div>
      </section>

      <section class="section">
        <h3>ملخص الحافز</h3>
        <div class="summary-grid">
          <div><span>النقاط</span><strong>${escapeHtml(props.currentPoints)} / ${escapeHtml(targetPoints)}</strong></div>
          <div><span>المكافآت</span><strong>${escapeHtml(props.rewardPoints)}</strong></div>
          <div><span>الخصومات</span><strong>${escapeHtml(props.penaltyPoints)}</strong></div>
          <div><span>الحافز النهائي</span><strong>${escapeHtml(formatCurrency(finalIncentive))}</strong></div>
        </div>
      </section>

      <section class="section">
        <h3>المكافآت</h3>
        <table>
          <thead>
            <tr>
              <th>التاريخ</th>
              <th>السبب</th>
              <th>النقاط</th>
              <th>التفاصيل</th>
              <th>المصدر</th>
              <th>بواسطة</th>
              <th>الحالة</th>
            </tr>
          </thead>
          <tbody>${buildTransactionRows(rewardRows)}</tbody>
        </table>
      </section>

      <section class="section">
        <h3>الخصومات</h3>
        <table>
          <thead>
            <tr>
              <th>التاريخ</th>
              <th>السبب</th>
              <th>النقاط</th>
              <th>التفاصيل</th>
              <th>المصدر</th>
              <th>بواسطة</th>
              <th>الحالة</th>
            </tr>
          </thead>
          <tbody>${buildTransactionRows(penaltyRows)}</tbody>
        </table>
      </section>

      <section class="section">
        <h3>طريقة الحساب</h3>
        <table class="calc-table">
          <tbody>
            <tr><th>قيمة النقطة</th><td>${escapeHtml(POINT_VALUE_EGP)} جنيه</td></tr>
            <tr><th>الحافز حسب النقاط النهائية</th><td>${escapeHtml(formatCurrency(finalIncentive))}</td></tr>
            <tr><th>قيمة المكافآت داخل النقاط</th><td>${escapeHtml(formatCurrency(rewardMoney))}</td></tr>
            <tr><th>قيمة الخصومات داخل النقاط</th><td>${escapeHtml(formatCurrency(penaltyMoney))}</td></tr>
            <tr><th>الحافز النهائي</th><td>${escapeHtml(formatCurrency(finalIncentive))}</td></tr>
          </tbody>
        </table>
      </section>

      <footer>صيدليات دواء - ${escapeHtml(props.staffName)}</footer>
    </div>
  `;
}

function buildReportStyles() {
  return `
    .report {
      box-sizing: border-box;
      width: 794px;
      padding: 38px;
      direction: rtl;
      background: #ffffff;
      color: #0f172a;
      font-family: Tahoma, Arial, sans-serif;
      line-height: 1.7;
    }
    .report * {
      box-sizing: border-box;
      letter-spacing: 0;
    }
    .report-header {
      display: flex;
      align-items: center;
      justify-content: flex-start;
      gap: 18px;
      padding-bottom: 18px;
      border-bottom: 3px solid #0f766e;
      margin-bottom: 22px;
    }
    .report-header img {
      width: 84px;
      height: 84px;
      object-fit: contain;
      flex: 0 0 auto;
    }
    h1, h2, h3, p {
      margin: 0;
    }
    h1 {
      font-size: 31px;
      font-weight: 800;
      color: #0f172a;
    }
    h2 {
      font-size: 19px;
      font-weight: 700;
      color: #0f766e;
      margin-top: 2px;
    }
    .report-header p {
      color: #64748b;
      font-size: 12px;
      margin-top: 4px;
    }
    .section {
      margin-top: 16px;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .section h3 {
      background: #eef6f6;
      color: #0f172a;
      font-size: 17px;
      font-weight: 800;
      padding: 8px 12px;
      border-radius: 8px;
      border: 1px solid #d7e7e8;
      margin-bottom: 10px;
    }
    .info-grid,
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }
    .summary-grid {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
    .info-grid div,
    .summary-grid div {
      min-height: 58px;
      border: 1px solid #d8e1ea;
      border-radius: 8px;
      padding: 8px 10px;
      background: #ffffff;
    }
    span {
      display: block;
      color: #64748b;
      font-size: 12px;
      margin-bottom: 3px;
    }
    strong {
      display: block;
      color: #0f172a;
      font-size: 15px;
      font-weight: 800;
      word-break: break-word;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      border: 1px solid #d8e1ea;
      background: #ffffff;
      font-size: 11px;
    }
    th,
    td {
      border: 1px solid #d8e1ea;
      padding: 7px 6px;
      vertical-align: top;
      word-break: break-word;
      text-align: right;
    }
    tr {
      page-break-inside: avoid;
      break-inside: avoid;
    }
    thead th {
      background: #0f172a;
      color: #ffffff;
      font-size: 11px;
      font-weight: 800;
    }
    tbody td {
      color: #1f2937;
    }
    .empty-cell {
      text-align: center;
      color: #64748b;
      padding: 16px;
    }
    .calc-table th {
      width: 60%;
      background: #f8fafc;
      color: #0f172a;
    }
    .calc-table td {
      font-weight: 800;
      color: #0f172a;
    }
    footer {
      margin-top: 22px;
      padding-top: 10px;
      border-top: 1px solid #d8e1ea;
      color: #64748b;
      font-size: 11px;
      text-align: center;
    }
  `;
}

async function exportIncentiveReport(props: SalaryCalculatorProps) {
  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.left = "-10000px";
  container.style.top = "0";
  container.style.background = "#ffffff";
  container.innerHTML = `<style>${buildReportStyles()}</style>${buildReportHtml(props)}`;
  document.body.appendChild(container);

  try {
    const report = container.querySelector(".report") as HTMLElement;
    const canvas = await html2canvas(report, {
      scale: 2.5,
      backgroundColor: "#ffffff",
      useCORS: true,
      logging: false,
      windowWidth: report.scrollWidth,
      windowHeight: report.scrollHeight,
    });

    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const imageWidth = pageWidth;
    const imageHeight = (canvas.height * imageWidth) / canvas.width;
    const imageData = canvas.toDataURL("image/png");

    let heightLeft = imageHeight;
    let y = 0;
    doc.setFillColor(255, 255, 255);
    doc.rect(0, 0, pageWidth, pageHeight, "F");
    doc.addImage(imageData, "PNG", 0, y, imageWidth, imageHeight);
    heightLeft -= pageHeight;

    while (heightLeft > 0) {
      doc.addPage();
      doc.setFillColor(255, 255, 255);
      doc.rect(0, 0, pageWidth, pageHeight, "F");
      y = heightLeft - imageHeight;
      doc.addImage(imageData, "PNG", 0, y, imageWidth, imageHeight);
      heightLeft -= pageHeight;
    }

    doc.save(cleanFileName(`صيدليات دواء - حوافز ${props.staffName}`) + ".pdf");
  } finally {
    document.body.removeChild(container);
  }
}

export default function SalaryCalculator(props: SalaryCalculatorProps) {
  const targetPoints = props.maxPoints || STARTING_POINTS;
  const finalIncentive = calculateIncentive(props.currentPoints);
  const rewardMoney = props.rewardPoints * POINT_VALUE_EGP;
  const penaltyMoney = props.penaltyPoints * POINT_VALUE_EGP;
  const uniqueRecords = uniqueTransactions(props.records);
  const rewardRows = uniqueRecords.filter((row) => transactionKind(row) === "reward");
  const penaltyRows = uniqueRecords.filter((row) => transactionKind(row) === "penalty");

  return (
    <div className="stat-card space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Calculator className="text-teal-400" size={20} />
          <h3 className="text-white font-bold">حساب الحوافز</h3>
        </div>
        <button type="button" className="btn-secondary flex items-center gap-2 py-2" onClick={() => void exportIncentiveReport(props)}>
          <FileText size={16} /> تصدير PDF وحفظه
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Metric label="الموظف" value={props.staffName} />
        <Metric label="الدورة" value={props.cycleLabel} />
        <Metric label="النقاط" value={`${props.currentPoints} / ${targetPoints}`} />
        <Metric label="الحافز النهائي" value={formatCurrency(finalIncentive)} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-lg p-3 bg-teal-500/10 border border-teal-500/20">
          <TrendingUp className="text-teal-400 mb-2" size={16} />
          <div className="text-slate-300 text-sm">إجمالي المكافآت</div>
          <div className="text-2xl font-bold num text-teal-400">+{props.rewardPoints}</div>
          <div className="text-xs text-slate-400 mt-1">{formatCurrency(rewardMoney)}</div>
        </div>
        <div className="rounded-lg p-3 bg-red-500/10 border border-red-500/20">
          <TrendingDown className="text-red-400 mb-2" size={16} />
          <div className="text-slate-300 text-sm">إجمالي الخصومات</div>
          <div className="text-2xl font-bold num text-red-400">-{props.penaltyPoints}</div>
          <div className="text-xs text-slate-400 mt-1">{formatCurrency(penaltyMoney)}</div>
        </div>
        <div className="rounded-lg p-3 bg-teal-500/10 border border-teal-500/20">
          <Wallet className="text-teal-400 mb-2" size={16} />
          <div className="text-slate-300 text-sm">الحافز النهائي</div>
          <div className="text-2xl font-bold num text-white">{formatCurrency(finalIncentive)}</div>
          <div className="text-xs text-slate-400 mt-1">النقاط النهائية × قيمة النقطة، بدون حساب مزدوج</div>
        </div>
      </div>

      <TransactionsList title="تفاصيل المكافآت" rows={rewardRows} tone="teal" />
      <TransactionsList title="تفاصيل الخصومات" rows={penaltyRows} tone="red" />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white/5 rounded-lg p-3">
      <div className="text-slate-400 text-xs mb-1">{label}</div>
      <div className="text-white font-bold text-sm num">{value}</div>
    </div>
  );
}

function TransactionsList({ title, rows, tone }: { title: string; rows: IncentiveTransaction[]; tone: "teal" | "red" }) {
  return (
    <div className="rounded-xl border border-[#2d4063] overflow-hidden">
      <div className="bg-[#16253f] px-3 py-2 text-white font-bold text-sm">{title}</div>
      {rows.length === 0 ? (
        <div className="p-3 text-slate-500 text-sm">لا توجد سجلات في هذه الدورة.</div>
      ) : (
        <div className="divide-y divide-[#2d4063]/70">
          {rows.map((row) => (
            <div key={row.id} className="grid grid-cols-4 gap-2 p-3 text-xs">
              <div className="text-slate-300">{row.created_at ? new Date(row.created_at).toLocaleDateString("ar-EG") : "-"}</div>
              <div className="col-span-2 text-white">{row.reason || row.description || "-"}</div>
              <div className={`font-bold num ${tone === "teal" ? "text-teal-400" : "text-red-400"}`}>{transactionPoints(row)} نقطة</div>
              <div className="col-span-4 text-slate-500">
                المصدر: {row.source || row.source_type || "-"} - بواسطة: {row.created_by || "-"} - الحالة: {row.status || "approved"}
              </div>
              {(row.manager_note || row.description) && (
                <div className="col-span-4 text-slate-400 leading-5">
                  التفاصيل: {row.manager_note || row.description}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
