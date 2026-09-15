function decodeUtf8(bytes: Uint8Array) {
  return new TextDecoder('utf-8').decode(bytes);
}

async function inflateRaw(bytes: Uint8Array) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('المتصفح لا يدعم فك ضغط ZIP محليًا. فك الملف وارفع chat.md أو chat.txt بدلًا منه.');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function readU16(view: DataView, offset: number) {
  return view.getUint16(offset, true);
}

function readU32(view: DataView, offset: number) {
  return view.getUint32(offset, true);
}

interface ZipEntryCandidate {
  name: string;
  method: number;
  data: Uint8Array;
  compressedSize: number;
}

async function decodeZipEntry(target: ZipEntryCandidate) {
  let output: Uint8Array;
  if (target.method === 0) output = target.data;
  else if (target.method === 8) output = await inflateRaw(target.data);
  else throw new Error(`طريقة ضغط ZIP غير مدعومة حاليًا (${target.method}).`);
  return decodeUtf8(output);
}

async function extractBestChatTextFromZip(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let offset = 0;
  const textCandidates: ZipEntryCandidate[] = [];
  const archiveEntries: string[] = [];

  while (offset + 30 <= bytes.length && readU32(view, offset) === 0x04034b50) {
    const flags = readU16(view, offset + 6);
    const method = readU16(view, offset + 8);
    const compressedSize = readU32(view, offset + 18);
    const fileNameLength = readU16(view, offset + 26);
    const extraLength = readU16(view, offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + fileNameLength + extraLength;
    const name = decodeUtf8(bytes.slice(nameStart, nameStart + fileNameLength));

    if (flags & 0x08) {
      throw new Error('صيغة ZIP دي بتستخدم Data Descriptor وغير مدعومة في القراءة المحلية الحالية. فك الملف وارفع chat.md أو chat.txt.');
    }
    if (!compressedSize || dataStart + compressedSize > bytes.length) break;

    if (!name.includes('__MACOSX') && !name.endsWith('/')) archiveEntries.push(name);
    if (/\.(txt|md)$/i.test(name) && !name.includes('__MACOSX')) {
      textCandidates.push({ name, method, data: bytes.slice(dataStart, dataStart + compressedSize), compressedSize });
    }
    offset = dataStart + compressedSize;
  }

  // chat.md is preferred because Dawaa's current export keeps reply/quote context there,
  // while chat.txt flattens those relationships. Fall back safely to chat.txt/any text file.
  const target =
    textCandidates.find((item) => /(^|\/)chat\.md$/i.test(item.name)) ||
    textCandidates.find((item) => /(^|\/)chat\.txt$/i.test(item.name)) ||
    textCandidates.find((item) => /\.md$/i.test(item.name)) ||
    textCandidates[0];
  if (!target) throw new Error('لم يتم العثور على chat.md أو chat.txt أو ملف نصي داخل ZIP.');

  const mediaEntries = archiveEntries.filter((name) => /\.(jpe?g|png|webp|gif|heic|mp4|mov|m4a|mp3|ogg|opus|wav|pdf|docx?|xlsx?)$/i.test(name));
  return {
    text: await decodeZipEntry(target),
    innerFileName: target.name,
    archiveEntries,
    mediaEntries,
  };
}

export interface WhatsAppExportReadResult {
  text: string;
  sourceFileName: string;
  innerFileName?: string;
  format: 'text' | 'zip';
  archiveEntries?: string[];
  mediaEntries?: string[];
}

export async function readWhatsAppExportFile(file: File): Promise<WhatsAppExportReadResult> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.txt') || lower.endsWith('.md')) {
    return { text: await file.text(), sourceFileName: file.name, innerFileName: file.name, format: 'text', archiveEntries: [file.name], mediaEntries: [] };
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
    };
  }
  throw new Error('ارفع ملف WhatsApp بصيغة ZIP أو TXT أو MD.');
}
