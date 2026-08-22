/* eslint-disable no-empty */
import React, { useState } from 'react';
import { supabase } from '@/lib/supabase';

export default function QuickShiftNotesModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(false);

  if (!open) return null;

  const submit = async () => {
    setLoading(true);
    try {
      await supabase.from('shift_notes').insert([{ title, body, status: 'open' }]);
      setTitle('');
      setBody('');
      try {
        window.dispatchEvent(new CustomEvent('dataChanged', { detail: { table: 'shift_notes' } }));
      } catch {}
      try {
        window.dispatchEvent(
          new CustomEvent('toast', {
            detail: { type: 'success', message: 'تم إنشاء ملاحظة الشيفت' },
          })
        );
      } catch {}
      onClose();
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-backdrop items-center" dir="rtl" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <div className="modal-panel max-w-md p-5">
        <h3 className="dawaa-title text-lg">ملاحظة شيفت سريعة</h3>
        <p className="dawaa-caption mt-1 mb-4 text-xs font-bold">سجل الملاحظة بشكل مختصر وواضح لتظهر في متابعة الشيفت.</p>
        <div className="space-y-2.5">
          <input className="dawaa-input text-sm" placeholder="العنوان" value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea className="dawaa-textarea min-h-28 text-sm" placeholder="المحتوى" value={body} onChange={(e) => setBody(e.target.value)} />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button className="dawaa-button dawaa-button--secondary" onClick={onClose}>إلغاء</button>
          <button className="dawaa-button dawaa-button--primary disabled:opacity-60" onClick={submit} disabled={loading}>
            {loading ? 'جارٍ...' : 'حفظ'}
          </button>
        </div>
      </div>
    </div>
  );
}
