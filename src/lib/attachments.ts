/**
 * Frontend wrappers around the `attachment_*` Tauri commands plus the
 * helpers that turn an editor event (paste / drop / slash) into a
 * markdown image link insertion.
 */
import { invoke } from '@tauri-apps/api/core';
import type { EditorView } from '@codemirror/view';

export interface AttachmentMeta {
  path: string;
  name: string;
  size: number;
  ext: string;
}

export interface DeleteResult {
  deleted: boolean;
  referenced_in: string[];
}

export const SUPPORTED_IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'];

export async function saveAttachmentFile(sourcePath: string): Promise<string> {
  return invoke<string>('attachment_save_file', { sourcePath });
}

export async function saveAttachmentBytes(
  data: Uint8Array,
  ext: string,
): Promise<string> {
  return invoke<string>('attachment_save_bytes', {
    data: Array.from(data),
    ext,
  });
}

export async function listAttachments(): Promise<AttachmentMeta[]> {
  return invoke<AttachmentMeta[]>('attachment_list');
}

export async function deleteAttachment(filename: string): Promise<DeleteResult> {
  return invoke<DeleteResult>('attachment_delete', { filename });
}

export function isImageFilename(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return SUPPORTED_IMAGE_EXTS.includes(ext);
}

export function extFromMime(mime: string): string {
  const base = mime.split(';')[0]?.trim().toLowerCase() ?? '';
  switch (base) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
      return 'jpg';
    case 'image/gif':
      return 'gif';
    case 'image/webp':
      return 'webp';
    case 'image/svg+xml':
      return 'svg';
    default:
      return 'bin';
  }
}

export function altFromPath(path: string): string {
  const base = path.split('/').pop() ?? path;
  return base.replace(/\.[^.]+$/, '');
}

/** Replace `[from, to)` with a markdown image link to `attachmentPath`. */
export function insertImageLink(
  view: EditorView,
  attachmentPath: string,
  options?: { from?: number; to?: number; alt?: string },
): void {
  const alt = options?.alt ?? altFromPath(attachmentPath);
  const text = `![${alt}](${attachmentPath})`;
  const from = options?.from ?? view.state.selection.main.from;
  const to = options?.to ?? view.state.selection.main.to;
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
  });
}

