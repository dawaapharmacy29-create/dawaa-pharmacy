function decodeUtf8(bytes: Uint8Array) {
  return new TextDecoder('utf-8').decode(bytes);
}

async function inflateRaw(bytes: Uint8Array) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('المتصفح لا يدعم فك ضغط ZIP محليًا.');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function readU16(view: DataView, offset: number) { return view.getUint16(offset, true); }
function readU32(view: DataView, offset: number) { return view.getUint32(offset, true); }

export type WhatsAppExportMediaKind = 'image' | 'voice' | 'video' | 'document' | 'unknown';

export interface WhatsAppExportMediaFile {
  archiveName: string;
  fileName: string;
  mimeType: string;
  kind: WhatsAppExportMediaKind;
  byteSize: number;
  bytes: Uint8Array;
}

interface ZipDirectoryEntry {
  name: string;
  flags: number;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

function findEndOfCentralDirectory(view: DataView) {
  const min = Math.max(0, view.byteLength - 0xffff - 22);
  for (let offset = view.byteLength - 22; offset >= min; offset -= 1) {
    if (readU32(view, offset) === 0x06054b50) return offset;
  }
  return -1;
}

function readCentralDirectory(buffer: ArrayBuffer): ZipDirectoryEntry[] {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const eocd = findEndOfCentralDirectory(view);
  if (eocd < 0) throw new Error('ملف ZIP غير صالح أو غير مكتمل.');

  const entryCount = readU16(view, eocd + 10);
  const centralSize = readU32(view, eocd + 12);
  const centralOffset = readU32(view, eocd + 16);
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new Error('ZIP64 غير مدعوم حاليًا. صدّر المحادثة في ملف أصغر.');
  }

  const entries: ZipDirectoryEntry[] = [];
  let offset = centralOffset;
  for (let index = 0; index < entryCount && offset + 46 <= bytes.length; index += 1) {
    if (readU32(view, offset) !== 0x02014b50) break;
    const flags = readU16(view, offset + 8);
    const method = readU16(view, offset + 10);
    const compressedSize = readU32(view, offset + 20);
    const uncompressedSize = readU32(view, offset + 24);
    const fileNameLength = readU16(view, offset + 28);
    const extraLength = readU16(view, offset + 30);
    const commentLength = readU16(view, offset + 32);
    const localHeaderOffset = readU32(view, offset + 42);
    const name = decodeUtf8(bytes.slice(offset + 46, offset + 46 + fileNameLength));
    entries.push({ name, flags, method, compressedSize, uncompressedSize, localHeaderOffset });
    offset += 46 + fileNameLength + extraLength + commentLength;
  }
  return entries;
}

async function extractEntryBytes(buffer: ArrayBuffer, entry: ZipDirectoryEntry) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const offset = entry.localHeaderOffset;
  if (offset + 30 > bytes.length || readU32(view, offset) !== 0x04034b50) {
    throw new Error(`تعذر قراءة المرفق ${entry.name}: local header غير صالح.`);
  }
  const fileNameLength = readU16(view, offset + 26);
  const extraLength = readU16(view, offset + 28);
  const dataStart = offset + 30 + fileNameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > bytes.length) throw new Error(`تعذر قراءة المرفق ${entry.name}: البيانات غير مكتملة.`);
  const compressed = bytes.slice(dataStart, dataEnd);
  if (entry.method === 0) return compressed;
  if (entry.method === 8) return inflateRaw(compressed);
  throw new Error(`طريقة ضغط ZIP غير مدعومة للمرفق ${entry.name} (${entry.method}).`);
}

function basename(path: string) {
  return path.split('/').filter(Boolean).at(-1) || path;
}

function classifyMedia(name: string): { kind: WhatsAppExportMediaKind; mimeType: string } {
  const lower = name.toLowerCase();
  if (/\.jpe?g$/.test(lower)) return { kind: 'image', mimeType: 'image/jpeg' };
  if (/\.png$/.test(lower)) return { kind: 'image', mimeType: 'image/png' };
  if (/\.webp$/.test(lower)) return { kind: 'image', mimeType: 'image/webp' };
  if (/\.gif$/.test(lower)) return { kind: 'image', mimeType: 'image/gif' };
  if (/\.heic$/.test(lower)) return { kind: 'image', mimeType: 'image/heic' };
  if (/\.(ogg|opus)$/.test(lower)) return { kind: 'voice', mimeType: lower.endsWith('.opus') ? 'audio/opus' : 'audio/ogg' };
  if (/\.mp3$/.test(lower)) return { kind: 'voice', mimeType: 'audio/mpeg' };
  if (/\.m4a$/.test(lower)) return { kind: 'voice', mimeType: 'audio/x-m4a' };
  if (/\.wav$/.test(lower)) return { kind: 'voice', mimeType: 'audio/wav' };
  if (/\.mp4$/.test(lower)) return { kind: 'video', mimeType: 'video/mp4' };
  if (/\.mov$/.test(lower)) return { kind: 'video', mimeType: 'video/quicktime' };
  if (/\.pdf$/.test(lower)) return { kind: 'document', mimeType: 'application/pdf' };
  if (/\.doc$/.test(lower)) return { kind: 'document', mimeType: 'application/msword' };
  if (/\.docx$/.test(lower)) return { kind: 'document', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
  if (/\.xlsx?$/.test(lower)) return { kind: 'document', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
  return { kind: 'unknown', mimeType: 'application/octet-stream' };
}

function isMediaName(name: string) {
  return /\.(jpe?g|png|webp|gif|heic|mp4|mov|m4a|mp3|ogg|opus|wav|pdf|docx?|xlsx?)$/i.test(name);
}

async function extractBestChatTextFromZip(buffer: ArrayBuffer) {
  const entries = readCentralDirectory(buffer).filter((entry) => !entry.name.includes('__MACOSX') && !entry.name.endsWith('/'));
  const archiveEntries = entries.map((entry) => entry.name);
  const textEntries = entries.filter((entry) => /\.(txt|md)$/i.test(entry.name));

  // Prefer the native WhatsApp TXT export when both chat.txt and chat.md exist.
  // The TXT file preserves full date + time on every message and is the canonical parser input.
  // Markdown exports may contain only section-level dates, which can otherwise look valid but parse to zero messages.
  const target =
    textEntries.find((item) => /(^|\/)chat\.txt$/i.test(item.name)) ||
    textEntries.find((item) => /(^|\/)chat\.md$/i.test(item.name)) ||
    textEntries.find((item) => /\.txt$/i.test(item.name)) ||
    textEntries.find((item) => /\.md$/i.test(item.name)) ||
    textEntries[0];
  if (!target) throw new Error('لم يتم العثور على chat.txt أو chat.md أو ملف نصي داخل ZIP.');

  const targetBytes = await extractEntryBytes(buffer, target);
  const mediaFiles: WhatsAppExportMediaFile[] = [];
  for (const entry of entries.filter((item) => isMediaName(item.name))) {
    try {
      const mediaBytes = await extractEntryBytes(buffer, entry);
      const meta = classifyMedia(entry.name);
      mediaFiles.push({
        archiveName: entry.name,
        fileName: basename(entry.name),
        mimeType: meta.mimeType,
        kind: meta.kind,
        byteSize: mediaBytes.byteLength,
        bytes: mediaBytes,
      });
    } catch (error) {
      console.warn('[whatsapp-media-v21] failed to extract archive entry', entry.name, error);
    }
  }

  return {
    text: decodeUtf8(targetBytes),
    innerFileName: target.name,
    archiveEntries,
    mediaEntries: mediaFiles.map((file) => file.archiveName),
    mediaFiles,
  };
}

export interface WhatsAppExportReadResult {
  text: string;
  sourceFileName: string;
  innerFileName?: string;
  format: 'text' | 'zip';
  archiveEntries?: string[];
  mediaEntries?: string[];
  mediaFiles?: WhatsAppExportMediaFile[];
}

export async function readWhatsAppExportFile(file: File): Promise<WhatsAppExportReadResult> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.txt') || lower.endsWith('.md')) {
    return { text: await file.text(), sourceFileName: file.name, innerFileName: file.name, format: 'text', archiveEntries: [file.name], mediaEntries: [], mediaFiles: [] };
  }
  if (lower.endsWith('.zip')) {
    const extracted = await extractBestChatTextFromZip(await file.arrayBuffer());
    return {
      text: extracted.text,
      sourceFileName: file.name,
      innerFileName: extracted.innerFileName,
      format: 'zip',
      archiveEntries: extracted.archiveEntries,
      mediaEntries: extracted.mediaEntries,
      mediaFiles: extracted.mediaFiles,
    };
  }
  throw new Error('ارفع ملف WhatsApp بصيغة ZIP أو TXT أو MD.');
}
