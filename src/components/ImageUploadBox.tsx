import { useRef, useState } from 'react';
import { ImagePlus, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { uploadImageToStorage, type ImageBucket } from '@/lib/storageUpload';

export default function ImageUploadBox({
  bucket,
  folder,
  valueUrl,
  label,
  onUploaded,
  disabled = false,
}: {
  bucket: ImageBucket;
  folder: string;
  valueUrl?: string | null;
  valuePath?: string | null;
  label: string;
  onUploaded: (image: { publicUrl: string; path: string }) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);

  const upload = async (file?: File | null) => {
    if (!file || disabled || uploading) return;
    setUploading(true);
    try {
      const uploaded = await uploadImageToStorage(bucket, file, folder);
      onUploaded(uploaded);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click();
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        void upload(event.dataTransfer.files?.[0]);
      }}
      className={`min-h-44 cursor-pointer rounded-2xl border-2 border-dashed p-4 transition ${
        dragging
          ? 'border-teal-300 bg-teal-500/15'
          : 'border-teal-400/35 bg-teal-500/5 hover:bg-teal-500/10'
      } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
      dir="rtl"
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/jpg,image/png,image/webp,image/gif"
        className="hidden"
        disabled={disabled || uploading}
        onChange={(event) => void upload(event.target.files?.[0])}
      />

      {valueUrl ? (
        <div className="space-y-3">
          <img
            src={valueUrl}
            alt=""
            className="h-40 w-full rounded-xl object-cover ring-1 ring-white/10"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-secondary flex items-center gap-2 px-3 py-2 text-xs"
              disabled={uploading || disabled}
            >
              {uploading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              استبدال الصورة
            </button>
            <button
              type="button"
              className="rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs font-bold text-red-200"
              onClick={(event) => {
                event.stopPropagation();
                onUploaded({ publicUrl: '', path: '' });
              }}
              disabled={uploading || disabled}
            >
              <Trash2 size={14} className="inline" /> حذف
            </button>
          </div>
        </div>
      ) : (
        <div className="flex min-h-36 flex-col items-center justify-center gap-3 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-teal-400/15 text-teal-200">
            {uploading ? <Loader2 size={30} className="animate-spin" /> : <ImagePlus size={34} />}
          </div>
          <div className="text-lg font-black text-teal-100">+ {label}</div>
          <div className="text-xs text-slate-400">
            اسحب الصورة هنا أو اضغط للاختيار. الحد الأقصى 5 ميجا.
          </div>
        </div>
      )}
    </div>
  );
}
