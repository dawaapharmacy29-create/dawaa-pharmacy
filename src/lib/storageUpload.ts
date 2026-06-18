import { supabase } from '@/lib/supabase';

export type ImageBucket = 'offer-assets' | 'story-assets' | 'customer-request-images';

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']);
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

function extensionFromFile(file: File) {
  const explicit = file.name.split('.').pop()?.toLowerCase();
  if (explicit && ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(explicit)) return explicit;
  return file.type.split('/')[1] || 'jpg';
}

function safeFolder(folder: string) {
  return folder.replace(/[^a-zA-Z0-9/_-]+/g, '-').replace(/^-+|-+$/g, '') || 'uploads';
}

export async function uploadImageToStorage(
  bucket: ImageBucket,
  file: File,
  folder: string
): Promise<{ path: string; publicUrl: string }> {
  if (!file) throw new Error('اختار صورة أولًا.');
  if (!ALLOWED_TYPES.has(file.type))
    throw new Error('نوع الصورة غير مدعوم. استخدم JPG أو PNG أو WEBP أو GIF.');
  if (file.size > MAX_IMAGE_SIZE) throw new Error('حجم الصورة أكبر من 5 ميجا. اختار صورة أصغر.');

  const now = new Date();
  const dateFolder = now.toISOString().slice(0, 10);
  const unique =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${now.getTime()}-${Math.random().toString(16).slice(2)}`;
  const path = `${safeFolder(folder)}/${dateFolder}/${unique}.${extensionFromFile(file)}`;

  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    cacheControl: '3600',
    contentType: file.type,
    upsert: false,
  });
  if (error) throw new Error(`تعذر رفع الصورة: ${error.message}`);

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  if (!data.publicUrl) throw new Error('تم رفع الصورة لكن تعذر إنشاء رابط العرض.');
  return { path, publicUrl: data.publicUrl };
}
