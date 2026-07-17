const fs = require('node:fs');

const importerPath = 'src/lib/invoiceImporter.ts';
let source = fs.readFileSync(importerPath, 'utf8');

const helperMarker = 'async function fetchExistingInvoicesByFieldPaged(';
if (!source.includes(helperMarker)) {
  const insertionMarker = 'export async function importInvoicesToDB(';
  const insertionIndex = source.indexOf(insertionMarker);
  if (insertionIndex === -1) throw new Error('Could not find importInvoicesToDB insertion point');

  const helper = `async function fetchExistingInvoicesByFieldPaged(\n  field: 'invoice_number' | 'invoice_no',\n  values: string[],\n  selectColumns: string,\n  pageSize = 500\n): Promise<{ data: Array<Record<string, unknown>>; error: { message?: string } | null }> {\n  const rows: Array<Record<string, unknown>> = [];\n\n  for (let from = 0; ; from += pageSize) {\n    const to = from + pageSize - 1;\n    const page = await supabase\n      .from('sales_invoices')\n      .select(selectColumns)\n      .in(field, values)\n      .order('invoice_date', { ascending: true })\n      .order('id', { ascending: true })\n      .range(from, to);\n\n    if (page.error) {\n      return { data: rows, error: page.error };\n    }\n\n    const pageRows = (page.data || []) as Array<Record<string, unknown>>;\n    rows.push(...pageRows);\n    if (pageRows.length < pageSize) break;\n  }\n\n  return { data: rows, error: null };\n}\n\n`;

  source = source.slice(0, insertionIndex) + helper + source.slice(insertionIndex);
}

const oldInvoiceNumberLookup = `    const byInvoiceNumber = await supabase\n      .from('sales_invoices')\n      .select(existingSelect)\n      .in('invoice_number', numberChunk)\n      .limit(50000);`;
const newInvoiceNumberLookup = `    const byInvoiceNumber = await fetchExistingInvoicesByFieldPaged(\n      'invoice_number',\n      numberChunk,\n      existingSelect\n    );`;
if (source.includes(oldInvoiceNumberLookup)) {
  source = source.replace(oldInvoiceNumberLookup, newInvoiceNumberLookup);
} else if (!source.includes(newInvoiceNumberLookup)) {
  throw new Error('Could not find invoice_number existing lookup');
}

const oldInvoiceNoLookup = `    const byInvoiceNo = await supabase\n      .from('sales_invoices')\n      .select(existingSelect)\n      .in('invoice_no', numberChunk)\n      .limit(50000);`;
const newInvoiceNoLookup = `    const byInvoiceNo = await fetchExistingInvoicesByFieldPaged(\n      'invoice_no',\n      numberChunk,\n      existingSelect\n    );`;
if (source.includes(oldInvoiceNoLookup)) {
  source = source.replace(oldInvoiceNoLookup, newInvoiceNoLookup);
} else if (!source.includes(newInvoiceNoLookup)) {
  throw new Error('Could not find invoice_no existing lookup');
}

fs.writeFileSync(importerPath, source);
console.log('Invoice import hardening applied.');
