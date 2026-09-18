import { supabase } from '@/lib/supabase';
import type { WhatsAppConversationSession, WhatsAppParsedMessage, WhatsAppMessageKind } from './whatsappConversationParser';
import type { WhatsAppExportMediaFile, WhatsAppExportMediaKind } from './whatsappExportFileReader';

export interface MediaAttachmentSummaryV21 {
  totalFiles: number;
  exactMatches: number;
  orderedMatches: number;
  unmatchedFiles: number;
  unmatchedMessages: number;
}

function normalized(value: unknown) {
  return String(value ?? '')
    .replace(/[\u200e\u200f\u202a-\u202e]/g, '')
    .trim()
    .toLowerCase();
}

function basename(path: string) {
  return path.split('/').filter(Boolean).at(-1) || path;
}

function messageKindFromMedia(kind: WhatsAppExportMediaKind): WhatsAppMessageKind {
  if (kind === 'image') return 'image';
  if (kind === 'voice') return 'voice';
  if (kind === 'video') return 'video';
  if (kind === 'document') return 'document';
  return 'unknown';
}

function makeObjectUrl(file: WhatsAppExportMediaFile) {
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return null;
  return URL.createObjectURL(new Blob([file.bytes], { type: file.mimeType || 'application/octet-stream' }));
}

function attach(message: WhatsAppParsedMessage, file: WhatsAppExportMediaFile, confidence: number) {
  message.mediaArchiveName = file.archiveName;
  message.mediaFileName = file.fileName;
  message.mediaMimeType = file.mimeType;
  message.mediaMatchConfidence = confidence;
  message.mediaAvailable = true;
  message.mediaPlaceholder = true;
  message.kind = messageKindFromMedia(file.kind);
  message.mediaObjectUrl = makeObjectUrl(file);
}

export function revokeWhatsAppMediaObjectUrlsV21(messages: WhatsAppParsedMessage[]) {
  if (typeof URL === 'undefined' || typeof URL.revokeObjectURL !== 'function') return;
  for (const message of messages) {
    if (message.mediaObjectUrl?.startsWith('blob:')) URL.revokeObjectURL(message.mediaObjectUrl);
  }
}

export function attachWhatsAppMediaToMessagesV21(
  inputMessages: WhatsAppParsedMessage[],
  mediaFiles: WhatsAppExportMediaFile[] = [],
): { messages: WhatsAppParsedMessage[]; summary: MediaAttachmentSummaryV21 } {
  const messages = inputMessages.map((message) => ({ ...message }));
  const used = new Set<string>();
  let exactMatches = 0;
  let orderedMatches = 0;

  const byName = new Map<string, WhatsAppExportMediaFile>();
  for (const file of mediaFiles) {
    byName.set(normalized(file.archiveName), file);
    byName.set(normalized(file.fileName), file);
    byName.set(normalized(basename(file.archiveName)), file);
  }

  for (const message of messages) {
    const text = normalized(message.text);
    if (!text) continue;
    const candidates = mediaFiles.filter((file) => {
      if (used.has(file.archiveName)) return false;
      const names = [normalized(file.archiveName), normalized(file.fileName), normalized(basename(file.archiveName))];
      return names.some((name) => name && text.includes(name));
    });
    if (candidates.length === 1) {
      attach(message, candidates[0], 99);
      used.add(candidates[0].archiveName);
      exactMatches += 1;
    }
  }

  const unmatchedFiles = mediaFiles.filter((file) => !used.has(file.archiveName));
  const unmatchedMessages = messages.filter((message) =>
    !message.mediaAvailable && (message.mediaPlaceholder || ['image','voice','video','document','unknown'].includes(message.kind))
  );

  // Conservative fallback: only use archive order when the counts line up exactly.
  // This avoids attaching the wrong prescription/photo to the wrong WhatsApp message.
  if (unmatchedFiles.length > 0 && unmatchedFiles.length === unmatchedMessages.length) {
    unmatchedMessages.forEach((message, index) => {
      const file = unmatchedFiles[index];
      attach(message, file, 60);
      used.add(file.archiveName);
      orderedMatches += 1;
    });
  }

  return {
    messages,
    summary: {
      totalFiles: mediaFiles.length,
      exactMatches,
      orderedMatches,
      unmatchedFiles: mediaFiles.length - used.size,
      unmatchedMessages: messages.filter((message) => message.mediaPlaceholder && !message.mediaAvailable).length,
    },
  };
}

async function sha256Hex(bytes: Uint8Array) {
  if (typeof crypto === 'undefined' || !crypto.subtle) return null;
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function safeName(value: string) {
  return value.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(-120) || 'media.bin';
}

export async function syncWhatsAppMediaForSourceV21(
  sourceId: string,
  session: WhatsAppConversationSession,
  mediaFiles: WhatsAppExportMediaFile[],
  actorName?: string | null,
) {
  const filesByArchiveName = new Map(mediaFiles.map((file) => [file.archiveName, file]));
  const linkedMessages = session.messages.filter((message) => message.mediaArchiveName && message.mediaAvailable);
  let uploaded = 0;
  let failed = 0;

  for (const message of linkedMessages) {
    const file = filesByArchiveName.get(String(message.mediaArchiveName));
    if (!file) continue;
    try {
      const hash = await sha256Hex(file.bytes);
      const storagePath = `${sourceId}/${hash || 'nohash'}-${safeName(file.fileName)}`;
      const blob = new Blob([file.bytes], { type: file.mimeType || 'application/octet-stream' });
      const { error: uploadError } = await supabase.storage
        .from('whatsapp-review-media')
        .upload(storagePath, blob, { contentType: file.mimeType || 'application/octet-stream', upsert: true });
      if (uploadError) throw uploadError;

      const { error: rowError } = await supabase.from('whatsapp_review_media_v21').upsert({
        source_id: sourceId,
        message_id: message.id,
        archive_name: file.archiveName,
        original_name: file.fileName,
        storage_path: storagePath,
        mime_type: file.mimeType,
        media_kind: file.kind,
        byte_size: file.byteSize,
        sha256: hash,
        attachment_match_confidence: Number(message.mediaMatchConfidence || 0),
        analysis_status: 'available',
        analysis_json: {
          match_strategy: Number(message.mediaMatchConfidence || 0) >= 90 ? 'exact_filename' : 'ordered_fallback',
          parser: 'whatsapp-media-v21',
        },
        created_by: actorName || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'source_id,archive_name', ignoreDuplicates: false });
      if (rowError) throw rowError;
      uploaded += 1;
    } catch (error) {
      failed += 1;
      console.warn('[whatsapp-media-v21] media persistence failed', sourceId, message.mediaArchiveName, error);
    }
  }
  return { uploaded, failed, linked: linkedMessages.length };
}

export async function loadWhatsAppMediaForSourceV21(sourceId: string) {
  const { data, error } = await supabase
    .from('whatsapp_review_media_v21')
    .select('*')
    .eq('source_id', sourceId)
    .order('created_at', { ascending: true });
  if (error) throw error;

  const rows = await Promise.all((data || []).map(async (row: any) => {
    let signedUrl: string | null = null;
    if (row.storage_path) {
      const { data: signed, error: signedError } = await supabase.storage
        .from('whatsapp-review-media')
        .createSignedUrl(row.storage_path, 3600);
      if (!signedError) signedUrl = signed?.signedUrl || null;
    }
    return { ...row, signed_url: signedUrl };
  }));
  return rows;
}
