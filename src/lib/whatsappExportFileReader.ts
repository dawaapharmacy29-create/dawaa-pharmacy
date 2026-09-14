function decodeUtf8(bytes: Uint8Array) {
  return new TextDecoder('utf-8').decode(bytes);
}

async function inflateRaw(bytes: Uint8Array) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('المتصفح لا يدعم فك ضغط ZIP محليًا. فك الملف وارفع chat.txt بدلًا منه.');
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

async function extractFirstChatTextFromZip(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let offset = 0;
  const candidates: Array<{ name: string; method: number; data: Uint8Array }> = [];

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
      throw new Error('صيغة ZIP دي بتستخدم Data Descriptor وغير مدعومة في النسخة التجريبية. فك الملف وارفع chat.txt.');
    }
    if (!compressedSize || dataStart + compressedSize > bytes.length) break;

    if (/\.(txt|md)$/i.test(name) && !name.includes('__MACOSX')) {
      candidates.push({ name, method, data: bytes.slice(dataStart, dataStart + compressedSize) });
    }
    offset = dataStart + compressedSize;
  }

  const target = candidates.find((item) => /(^|\/)chat\.txt$/i.test(item.name)) || candidates[0];
  if (!target) throw new Error('لم يتم العثور على chat.txt أو ملف نصي داخل ZIP.');

  let output: Uint8Array;
  if (target.method === 0) output = target.data;
  else if (target.method === 8) output = await inflateRaw(target.data);
  else throw new Error(`طريقة ضغط ZIP غير مدعومة حاليًا (${target.method}).`);

  return { text: decodeUtf8(output), innerFileName: target.name };
}

export interface WhatsAppExportReadResult {
  text: string;
  sourceFileName: string;
  innerFileName?: string;
  format: 'text' | 'zip';
}

export async function readWhatsAppExportFile(file: File): Promise<WhatsAppExportReadResult> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.txt') || lower.endsWith('.md')) {
    return { text: await file.text(), sourceFileName: file.name, format: 'text' };
  }
  if (lower.endsWith('.zip')) {
    const extracted = await extractFirstChatTextFromZip(await file.arrayBuffer());
    return {
      text: extracted.text,
      sourceFileName: file.name,
      innerFileName: extracted.innerFileName,
      format: 'zip',
    };
  }
  throw new Error('ارفع ملف WhatsApp بصيغة ZIP أو TXT أو MD.');
}
