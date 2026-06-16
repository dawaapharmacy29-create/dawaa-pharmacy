import { usePWA } from "@/hooks/usePWA";
import { RefreshCw, Download, WifiOff, X } from "lucide-react";
import { useState } from "react";
import { useOfflineQueueStatus } from "@/hooks/useOfflineQueueStatus";

export default function PWABanner() {
  const { isInstallable, isOffline, hasUpdate, installApp, applyUpdate } = usePWA();
  const { pendingCount, syncing, syncNow } = useOfflineQueueStatus();
  const [dismissed, setDismissed] = useState(false);


  if (!isOffline && pendingCount > 0 && !dismissed) {
    return (
      <div className="fixed bottom-4 right-4 left-4 md:left-auto md:w-96 z-50 animate-fade-in" dir="rtl">
        <div className="bg-amber-900/90 backdrop-blur border border-amber-400/40 rounded-2xl p-4 flex items-center gap-3 shadow-2xl">
          <div className="w-9 h-9 rounded-xl bg-amber-500/20 flex items-center justify-center flex-shrink-0">
            <RefreshCw size={18} className={syncing ? "text-amber-200 animate-spin" : "text-amber-200"} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-white font-semibold text-sm">عمليات محفوظة بدون مزامنة</div>
            <div className="text-amber-100/80 text-xs mt-0.5">{pendingCount} عملية في انتظار إرسالها عند توفر النت.</div>
          </div>
          <button onClick={syncNow} disabled={syncing} className="rounded-xl bg-white/15 px-3 py-2 text-xs font-black text-white hover:bg-white/20 disabled:opacity-50">
            مزامنة
          </button>
          <button onClick={() => setDismissed(true)} className="text-amber-100/70 hover:text-white">
            <X size={16} />
          </button>
        </div>
      </div>
    );
  }

  if (isOffline) {
    return (
      <div className="fixed bottom-4 right-4 left-4 md:left-auto md:w-80 z-50 animate-fade-in">
        <div className="bg-red-900/90 backdrop-blur border border-red-500/30 rounded-2xl p-4 flex items-center gap-3 shadow-2xl">
          <div className="w-9 h-9 rounded-xl bg-red-500/20 flex items-center justify-center flex-shrink-0">
            <WifiOff size={18} className="text-red-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-white font-semibold text-sm">أنت غير متصل</div>
            <div className="text-red-200/70 text-xs mt-0.5">بعض الميزات غير متاحة حالياً</div>
          </div>
          <div className="w-2 h-2 rounded-full bg-red-400 animate-pulse flex-shrink-0" />
        </div>
      </div>
    );
  }

  if (hasUpdate && !dismissed) {
    return (
      <div className="fixed bottom-4 right-4 left-4 md:left-auto md:w-80 z-50 animate-fade-in">
        <div className="bg-[#1B2B4B] backdrop-blur border border-teal-500/30 rounded-2xl p-4 shadow-2xl shadow-black/40">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-teal-500/15 flex items-center justify-center flex-shrink-0">
              <RefreshCw size={18} className="text-teal-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-white font-semibold text-sm">تحديث متاح</div>
              <div className="text-slate-400 text-xs mt-0.5 leading-relaxed">نسخة جديدة من النظام جاهزة للتثبيت</div>
            </div>
            <button
              onClick={() => setDismissed(true)}
              className="text-slate-500 hover:text-slate-300 transition-colors p-1 flex-shrink-0"
            >
              <X size={16} />
            </button>
          </div>
          <div className="flex gap-2 mt-3">
            <button
              onClick={applyUpdate}
              className="flex-1 bg-teal-500 hover:bg-teal-400 text-white text-sm font-semibold py-2 px-3 rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              <RefreshCw size={14} /> تحديث الآن
            </button>
            <button
              onClick={() => setDismissed(true)}
              className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 rounded-xl border border-[#2d4063] hover:border-teal-500/20 transition-colors"
            >
              لاحقاً
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (isInstallable && !dismissed) {
    return (
      <div className="fixed bottom-4 right-4 left-4 md:left-auto md:w-80 z-50 animate-fade-in">
        <div className="bg-[#1B2B4B] backdrop-blur border border-[#2d4063] rounded-2xl p-4 shadow-2xl shadow-black/40">
          <div className="flex items-start gap-3">
            <img src="/icon-192.png" alt="دواء" className="w-9 h-9 rounded-xl object-contain flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-white font-semibold text-sm">ثبّت التطبيق</div>
              <div className="text-slate-400 text-xs mt-0.5 leading-relaxed">وصول سريع من الجوال والكمبيوتر</div>
            </div>
            <button
              onClick={() => setDismissed(true)}
              className="text-slate-500 hover:text-slate-300 transition-colors p-1 flex-shrink-0"
            >
              <X size={16} />
            </button>
          </div>
          <div className="flex gap-2 mt-3">
            <button
              onClick={installApp}
              className="flex-1 bg-gradient-to-r from-teal-600 to-teal-500 hover:from-teal-500 hover:to-teal-400 text-white text-sm font-semibold py-2 px-3 rounded-xl transition-all flex items-center justify-center gap-2"
            >
              <Download size={14} /> تثبيت الآن
            </button>
            <button
              onClick={() => setDismissed(true)}
              className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 rounded-xl border border-[#2d4063] hover:border-teal-500/20 transition-colors"
            >
              لاحقاً
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
