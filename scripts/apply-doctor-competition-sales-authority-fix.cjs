const fs = require('node:fs');
const path = require('node:path');

const filePath = path.join(process.cwd(), 'src/pages/DoctorCompetition.tsx');
if (!fs.existsSync(filePath)) {
  console.log('[doctor-competition-sales-authority] DoctorCompetition.tsx not found; skipped');
  process.exit(0);
}

let source = fs.readFileSync(filePath, 'utf8');
const before = source;

const oldBlock = `function combineCompetitionWithSales(competition: DoctorCompetitionScore | undefined, sales: DoctorCompetitionScore) {
  if (!competition) return sales;
  const totalSales = Math.max(competition.totalSales, sales.totalSales);
  const invoices = Math.max(competition.invoices, sales.invoices);
  return {
    ...competition,
    name: competition.staffId ? competition.name : sales.name,
    branch: competition.staffId ? competition.branch : sales.branch,
    staffId: competition.staffId || sales.staffId || null,
    totalSales,
    invoices,
    linkedInvoiceCount: Math.max(competition.linkedInvoiceCount, sales.linkedInvoiceCount),
    avgInvoice: invoices > 0 ? totalSales / invoices : Math.max(competition.avgInvoice, sales.avgInvoice),
    avgInvoiceEligible: invoices > 0,
  };
}`;

const newBlock = `function combineCompetitionWithSales(competition: DoctorCompetitionScore | undefined, sales: DoctorCompetitionScore) {
  if (!competition) return sales;

  // بيانات المبيعات الحية هي المصدر الوحيد المعتمد للمبيعات وعدد الفواتير والمتوسط.
  // هذا يمنع مضاعفة أرقام الدكتور عندما يوجد أكثر من حساب أو اسم قديم لنفس الشخص.
  const totalSales = sales.totalSales;
  const invoices = sales.invoices;
  return {
    ...competition,
    name: sales.name || competition.name,
    branch: sales.branch || competition.branch,
    staffId: sales.staffId || competition.staffId || null,
    totalSales,
    invoices,
    linkedInvoiceCount: sales.linkedInvoiceCount,
    avgInvoice: invoices > 0 ? totalSales / invoices : 0,
    avgInvoiceEligible: invoices > 0,
  };
}`;

if (source.includes(newBlock)) {
  console.log('[doctor-competition-sales-authority] already applied');
} else if (!source.includes(oldBlock)) {
  throw new Error('[doctor-competition-sales-authority] expected combineCompetitionWithSales block not found');
} else {
  source = source.replace(oldBlock, newBlock);
}

if (source !== before) {
  fs.writeFileSync(filePath, source);
  console.log('[doctor-competition-sales-authority] applied');
}
