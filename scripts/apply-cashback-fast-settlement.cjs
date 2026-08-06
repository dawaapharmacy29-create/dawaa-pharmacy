const fs = require('fs');
const path = require('path');

const target = path.join(process.cwd(), 'src/pages/CustomerCashback.tsx');
let source = fs.readFileSync(target, 'utf8');

const oldBlock = `  const updateRow = async (
    row: CashbackRow,
    patch: Partial<CashbackRow>,
    eventType: string,
    amount?: number,
    notes?: string
  ): Promise<void> => {
    const nextPatch = { ...patch, notes: patch.notes ?? row.notes };
    const { error } = await supabase
      .from('customer_cashback_cycles')
      .update({ ...nextPatch, updated_at: new Date().toISOString() })
      .eq('id', row.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    patchLocalRow(row.id, nextPatch);
    await logCashbackEvent(row, eventType, amount, notes);
    toast.success('تم تحديث حالة الكاش باك');
  };
`;

const newBlock = `  const updateRow = async (
    row: CashbackRow,
    patch: Partial<CashbackRow>,
    eventType: string,
    amount?: number,
    notes?: string
  ): Promise<void> => {
    const nextPatch = { ...patch, notes: patch.notes ?? row.notes };

    // Optimistic update: reflect the action immediately in the UI. This is
    // especially important for the pending filter, where a settled customer
    // should disappear without waiting for thousands of rows to reload.
    patchLocalRow(row.id, nextPatch);

    const { error } = await supabase
      .from('customer_cashback_cycles')
      .update({ ...nextPatch, updated_at: new Date().toISOString() })
      .eq('id', row.id);

    if (error) {
      // Restore the original row if Supabase rejects the update.
      patchLocalRow(row.id, row);
      toast.error(error.message);
      return;
    }

    // Event history must not delay the visible settlement response.
    void logCashbackEvent(row, eventType, amount, notes).catch((eventError) => {
      console.error('Failed to log cashback event', eventError);
    });
    toast.success('تم تحديث حالة الكاش باك');
  };
`;

if (source.includes(newBlock)) {
  console.log('[cashback-fast-settlement] already applied');
  process.exit(0);
}

if (!source.includes(oldBlock)) {
  console.error('[cashback-fast-settlement] target block was not found');
  process.exit(1);
}

source = source.replace(oldBlock, newBlock);
fs.writeFileSync(target, source);
console.log('[cashback-fast-settlement] applied');
