import {
  pairPurchases,
  pairTransfers,
  type TransferDay,
  type TransferPurchase,
  type TransferSale,
} from '@/lib/customerServiceTasks/morning';
import { compareTransferLines, type LineCheck, type LineCompare } from './invoiceLines';

// تقرير دقة التحويلات على فترة: كل تحويل اتطابق صنف صنف، وبعدين الأخطاء بتتجمع:
// أكواد مكررة لنفس الصنف (تتقفل على بي كونكت)، كميات مختلفة، أصناف في ناحية واحدة،
// الدكاترة اللي بيحصل معاهم أخطاء (وهو بايع أو وهو مستلم)، والأصناف اللي رصيدها مشكوك فيه للجرد.

export type TransferIssue = LineCompare & {
  /** «فرع الشامي → فرع شكري». */
  route: string;
  saleBranch: string;
  purchaseBranch: string;
  day: string;
  saleInvoice: string;
  purchaseSerial: string;
  seller: string;
  receiver: string;
};

export type CodePair = {
  saleCode: string;
  saleName: string;
  purchaseCode: string;
  purchaseName: string;
  times: number;
  lastDay: string;
  people: string[];
};

export type DoctorAccuracy = {
  name: string;
  /** Transfers they sold (in the sending branch) and received (in the receiving one). */
  sold: number;
  received: number;
  soldWithIssues: number;
  receivedWithIssues: number;
  issues: Partial<Record<LineCheck, number>>;
};

export type SuspectItem = {
  branch: string;
  code: string;
  name: string;
  /** Quantity the branch's books are probably off by: + more on the books than on the shelf. */
  offBy: number;
  issues: number;
};

export type TransferAccuracy = {
  transfers: number;
  compared: number;
  withIssues: number;
  noLines: number;
  /** The days whose purchases have no item lines uploaded, and the stores they are in. */
  missingLines: { from: string; to: string; stores: string[] } | null;
  unpairedPurchases: number;
  unpairedSales: number;
  issues: TransferIssue[];
  codePairs: CodePair[];
  doctors: DoctorAccuracy[];
  suspects: SuspectItem[];
};

const who = (s: string | null | undefined) => (s ?? '').trim() || 'مش معروف';

export function transferAccuracy(days: TransferDay[]): TransferAccuracy {
  const issues: TransferIssue[] = [];
  const doctors = new Map<string, DoctorAccuracy>();
  const doc = (name: string) => {
    const e = doctors.get(name) ?? {
      name,
      sold: 0,
      received: 0,
      soldWithIssues: 0,
      receivedWithIssues: 0,
      issues: {},
    };
    doctors.set(name, e);
    return e;
  };
  let transfers = 0;
  let compared = 0;
  let withIssues = 0;
  let noLines = 0;
  const missingDays: string[] = [];
  const missingStores = new Set<string>();
  let unpairedPurchases = 0;
  let unpairedSales = 0;

  for (const d of days) {
    for (const p of d.purchases)
      if (!p.lines.length) {
        missingDays.push(p.invoice_at.slice(0, 10));
        missingStores.add(p.store);
      }
    const pairing = pairTransfers(d.purchases, d.sales);
    unpairedPurchases += pairing.purchasesOnly.length;
    unpairedSales += pairing.salesOnly.length;
    for (const pair of pairing.pairs) {
      const { purchase, sale } = pair;
      const all = pairPurchases(pair);
      transfers += 1;
      if (all.some((p) => !p.lines.length) || !sale.items.length) {
        noLines += 1;
        continue;
      }
      compared += 1;
      const rows = compareTransferLines(
        sale.items.map((i) => ({ code: i.code, name: i.name, qty: i.qty, price: i.price })),
        all.flatMap((p) =>
          p.lines.map((l) => ({ code: l.code, name: l.name, qty: l.qty, price: l.price }))
        )
      ).filter((r) => r.check !== 'ok');
      const seller = who(sale.seller);
      const receivers = [...new Set(all.map((p) => who(p.entered_by)))];
      const receiver = receivers.join(' + ');
      doc(seller).sold += 1;
      for (const name of receivers) doc(name).received += 1;
      if (!rows.length) continue;
      withIssues += 1;
      doc(seller).soldWithIssues += 1;
      for (const name of receivers) doc(name).receivedWithIssues += 1;
      for (const r of rows) {
        for (const name of new Set([seller, ...receivers])) {
          const e = doc(name);
          e.issues[r.check] = (e.issues[r.check] ?? 0) + 1;
        }
        issues.push({
          ...r,
          route: `${d.sale_branch} → ${d.branch}`,
          saleBranch: d.sale_branch,
          purchaseBranch: d.branch,
          day: dayOf(purchase, sale),
          saleInvoice: sale.invoice,
          purchaseSerial: all.map((p) => p.serial).join(' + '),
          seller,
          receiver,
        });
      }
    }
  }

  return {
    transfers,
    compared,
    withIssues,
    noLines,
    missingLines: missingDays.length
      ? {
          from: missingDays.reduce((a, b) => (a < b ? a : b)),
          to: missingDays.reduce((a, b) => (a > b ? a : b)),
          stores: [...missingStores].sort(),
        }
      : null,
    unpairedPurchases,
    unpairedSales,
    issues: issues.sort((a, b) => b.day.localeCompare(a.day)),
    codePairs: codePairs(issues),
    doctors: [...doctors.values()]
      .filter((d) => d.soldWithIssues + d.receivedWithIssues > 0)
      .sort(
        (a, b) =>
          b.soldWithIssues + b.receivedWithIssues - (a.soldWithIssues + a.receivedWithIssues)
      ),
    suspects: suspects(issues),
  };
}

const dayOf = (p: TransferPurchase, s: TransferSale) =>
  (p.invoice_at || s.at || '').replace(' ', 'T').slice(0, 10);

function codePairs(issues: TransferIssue[]): CodePair[] {
  const m = new Map<string, CodePair>();
  for (const i of issues) {
    if (i.check !== 'code' || !i.sale || !i.purchase) continue;
    // نفس الكودين بأي ترتيب = نفس المشكلة.
    const key = [i.sale.code, i.purchase.code].sort().join('|');
    const e = m.get(key) ?? {
      saleCode: i.sale.code,
      saleName: i.sale.name,
      purchaseCode: i.purchase.code,
      purchaseName: i.purchase.name,
      times: 0,
      lastDay: i.day,
      people: [],
    };
    e.times += 1;
    if (i.day > e.lastDay) e.lastDay = i.day;
    for (const p of [i.seller, i.receiver]) if (!e.people.includes(p)) e.people.push(p);
    m.set(key, e);
  }
  return [...m.values()].sort((a, b) => b.times - a.times);
}

/**
 * Where a transfer error leaves a branch's stock off. The sending branch took out what it sold, the receiving one
 * added what it bought: a code on one side only, a different quantity, or the item under another code all leave
 * one branch's books off from its shelf until someone fixes them, so those items go to the next count.
 */
function suspects(issues: TransferIssue[]): SuspectItem[] {
  const m = new Map<string, SuspectItem>();
  const add = (branch: string, code: string, name: string, offBy: number) => {
    const key = `${branch}|${code}`;
    const e = m.get(key) ?? { branch, code, name, offBy: 0, issues: 0 };
    e.offBy += offBy;
    e.issues += 1;
    m.set(key, e);
  };
  for (const i of issues) {
    const sent = i.sale?.qty ?? 0;
    const got = i.purchase?.qty ?? 0;
    if (i.check === 'qty' && i.sale && i.purchase) {
      // الكمية اللي اتسجلت شراء غير اللي اتسجلت بيع: واحد من الفرعين رصيده غلط بالفرق.
      add(i.purchaseBranch, i.purchase.code, i.purchase.name, got - sent);
      add(i.saleBranch, i.sale.code, i.sale.name, got - sent);
    } else if (i.check === 'code' && i.sale && i.purchase) {
      add(i.purchaseBranch, i.purchase.code, i.purchase.name, got);
      add(i.saleBranch, i.sale.code, i.sale.name, -sent);
    } else if (i.check === 'only_sale' && i.sale) {
      // اتباع ومااتشراش: لو وصل، الفرع المستلم ماضافهوش فرصيده أقل من الرف.
      add(i.purchaseBranch, i.sale.code, i.sale.name, -sent);
    } else if (i.check === 'only_purchase' && i.purchase) {
      // اتشرى ومااتباعش: الفرع اللي بعت ماخصمهوش فرصيده أكتر من الرف.
      add(i.saleBranch, i.purchase.code, i.purchase.name, got);
    }
  }
  return [...m.values()].sort(
    (a, b) => b.issues - a.issues || Math.abs(b.offBy) - Math.abs(a.offBy)
  );
}

/** The report as an Excel file for the team and the stock count. */
export async function exportTransferAccuracy(r: TransferAccuracy, title: string): Promise<Blob> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const sheet = (name: string, columns: Array<{ header: string; key: string; width: number }>) => {
    const ws = wb.addWorksheet(name, {
      views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }],
    });
    ws.columns = columns;
    const head = ws.getRow(1);
    head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
    return ws;
  };
  const LABEL: Record<LineCheck, string> = {
    ok: 'مطابق',
    qty: 'الكمية مختلفة',
    code: 'نفس الصنف بكود تاني',
    only_sale: 'اتباع ومااتشراش',
    only_purchase: 'اتشرى ومااتباعش',
  };

  const codes = sheet('أكواد مكررة', [
    { header: 'كود البيع', key: 'sc', width: 11 },
    { header: 'اسمه', key: 'sn', width: 32 },
    { header: 'كود الشراء', key: 'pc', width: 11 },
    { header: 'اسمه', key: 'pn', width: 32 },
    { header: 'كام مرة', key: 'n', width: 9 },
    { header: 'آخر مرة', key: 'last', width: 11 },
    { header: 'مين', key: 'who', width: 30 },
  ]);
  for (const c of r.codePairs)
    codes.addRow({
      sc: c.saleCode,
      sn: c.saleName,
      pc: c.purchaseCode,
      pn: c.purchaseName,
      n: c.times,
      last: c.lastDay,
      who: c.people.join('، '),
    });

  const all = sheet('كل الأخطاء', [
    { header: 'اليوم', key: 'day', width: 11 },
    { header: 'التحويل', key: 'route', width: 22 },
    { header: 'المشكلة', key: 'kind', width: 20 },
    { header: 'فاتورة البيع', key: 'si', width: 11 },
    { header: 'البايع', key: 'seller', width: 16 },
    { header: 'كود البيع', key: 'sc', width: 10 },
    { header: 'صنف البيع', key: 'sn', width: 30 },
    { header: 'كمية البيع', key: 'sq', width: 9 },
    { header: 'مسلسل الشراء', key: 'ps', width: 11 },
    { header: 'المستلم', key: 'receiver', width: 16 },
    { header: 'كود الشراء', key: 'pc', width: 10 },
    { header: 'صنف الشراء', key: 'pn', width: 30 },
    { header: 'كمية الشراء', key: 'pq', width: 9 },
  ]);
  for (const i of r.issues)
    all.addRow({
      day: i.day,
      route: i.route,
      kind: LABEL[i.check] + (i.check === 'code' && i.qtyDiffers ? ' وكمية مختلفة' : ''),
      si: i.saleInvoice,
      seller: i.seller,
      sc: i.sale?.code ?? '',
      sn: i.sale?.name ?? '',
      sq: i.sale?.qty ?? '',
      ps: i.purchaseSerial,
      receiver: i.receiver,
      pc: i.purchase?.code ?? '',
      pn: i.purchase?.name ?? '',
      pq: i.purchase?.qty ?? '',
    });

  const docs = sheet('الدكاترة', [
    { header: 'الاسم', key: 'name', width: 20 },
    { header: 'تحويلات باعها', key: 'sold', width: 13 },
    { header: 'فيها أخطاء', key: 'sw', width: 11 },
    { header: 'تحويلات استلمها', key: 'rec', width: 14 },
    { header: 'فيها أخطاء', key: 'rw', width: 11 },
    { header: 'أكواد غلط', key: 'code', width: 10 },
    { header: 'كميات مختلفة', key: 'qty', width: 12 },
    { header: 'صنف ناقص في ناحية', key: 'one', width: 16 },
  ]);
  for (const d of r.doctors)
    docs.addRow({
      name: d.name,
      sold: d.sold,
      sw: d.soldWithIssues,
      rec: d.received,
      rw: d.receivedWithIssues,
      code: d.issues.code ?? 0,
      qty: d.issues.qty ?? 0,
      one: (d.issues.only_sale ?? 0) + (d.issues.only_purchase ?? 0),
    });

  const stock = sheet('للجرد', [
    { header: 'الفرع', key: 'branch', width: 12 },
    { header: 'الكود', key: 'code', width: 10 },
    { header: 'الصنف', key: 'name', width: 34 },
    { header: 'الرصيد غالباً زايد/ناقص بـ', key: 'off', width: 22 },
    { header: 'عدد الأخطاء', key: 'n', width: 11 },
  ]);
  for (const s of r.suspects)
    stock.addRow({ branch: s.branch, code: s.code, name: s.name, off: s.offBy, n: s.issues });

  const info = wb.addWorksheet('عن الملف', { views: [{ rightToLeft: true }] });
  info.getColumn(1).width = 100;
  info.addRow([title]).font = { bold: true, size: 13 };
  info.addRow([
    `${r.transfers} تحويل اتربط، ${r.compared} اتقارن صنف صنف، ${r.withIssues} فيهم أخطاء. ${r.noLines} من غير أصناف شراء مرفوعة.`,
  ]);
  info.addRow([
    '«للجرد»: الرقم الموجب = الرصيد على السيستم غالباً أكتر من الرف، والسالب = أقل. اتأكدوا بالعد قبل التعديل.',
  ]);
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}
