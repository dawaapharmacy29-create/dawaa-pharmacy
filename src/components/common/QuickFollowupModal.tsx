import React, { useState } from "react";
import { supabase } from "@/lib/supabase";

export default function QuickFollowupModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);

  if (!open) return null;

  const submit = async () => {
    setLoading(true);
    try {
      await supabase.from("followups").insert([{ customer_name: name, customer_phone: phone, followup_summary: note, followup_status: "pending" }]);
      setName("");
      setPhone("");
      setNote("");
      // notify listeners that followups changed
      try { window.dispatchEvent(new CustomEvent("dataChanged", { detail: { table: "followups" } })); } catch {}
      try { window.dispatchEvent(new CustomEvent("toast", { detail: { type: "success", message: "تم إنشاء المتابعة" } })); } catch {}
      onClose();
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-lg bg-slate-900 p-4">
        <h3 className="mb-2 text-lg font-bold text-white">إنشاء متابعة سريعة</h3>
        <input className="mb-2 w-full rounded bg-slate-800 p-2 text-sm text-white" placeholder="اسم العميل" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="mb-2 w-full rounded bg-slate-800 p-2 text-sm text-white" placeholder="هاتف" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <textarea className="mb-2 w-full rounded bg-slate-800 p-2 text-sm text-white" placeholder="موجز المتابعة" value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="flex justify-end gap-2">
          <button className="rounded bg-white/5 px-3 py-1 text-sm text-white" onClick={onClose}>إلغاء</button>
          <button className="rounded bg-teal-500 px-3 py-1 text-sm text-black" onClick={submit} disabled={loading}>{loading ? "جارٍ..." : "إنشاء"}</button>
        </div>
      </div>
    </div>
  );
}
