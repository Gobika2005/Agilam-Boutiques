import { supabase } from '@/lib/supabase';
import { randomId } from '@/lib/uploadImage';

/**
 * Uploads to a PRIVATE Supabase Storage bucket.
 *
 * The public-bucket helper in `@/lib/uploadImage` returns a permanent public
 * URL, which is right for a product photo and wrong for a receipt: an invoice
 * names a vendor, an amount and often a bank reference. Here the caller stores
 * the object PATH and asks for a short-lived signed URL only when someone
 * actually opens the file.
 */

/** Receipts are photographed as often as they are exported, so accept both. */
const ALLOWED = ['image/', 'application/pdf'];
const MAX_BYTES = 10 * 1024 * 1024;

export async function uploadPrivateFile(
  bucket: string,
  folder: string,
  file: File,
  migrationHint: string,
): Promise<string> {
  if (!ALLOWED.some((t) => file.type.startsWith(t))) {
    throw new Error('Please choose an image or a PDF');
  }
  if (file.size > MAX_BYTES) throw new Error('File is too large — please use one under 10 MB');

  // Same reasoning as the public helper: an RLS denial here is almost always an
  // expired session, and "sign in again" beats an opaque policy error.
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) throw new Error('Your session expired — please sign in again to upload');

  const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
  const path = `${folder}/${randomId()}.${ext}`;
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, file, { upsert: false, contentType: file.type || undefined });
  if (error) {
    if (/bucket.*not found/i.test(error.message)) {
      throw new Error(`File storage is not set up yet (apply migration ${migrationHint} in Supabase)`);
    }
    if (/row-level security|violates|unauthorized/i.test(error.message)) {
      throw new Error(`Upload blocked by RLS — apply migration ${migrationHint} in Supabase`);
    }
    throw new Error(error.message || 'Upload failed');
  }
  return path;
}

/**
 * A temporary, authenticated link to a private object. Ten minutes is long
 * enough to open or download the receipt and short enough that a link pasted
 * into a chat is dead by the time anyone else clicks it.
 */
export async function signedFileUrl(bucket: string, path: string, expiresIn = 600): Promise<string | null> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn);
  if (error) return null;
  return data?.signedUrl ?? null;
}

/** Best-effort — a stranded object is untidy, never a reason to fail the edit. */
export async function removePrivateFile(bucket: string, path: string): Promise<void> {
  try {
    await supabase.storage.from(bucket).remove([path]);
  } catch {
    /* ignore */
  }
}

/** `expenses/ab12….jpg` → `ab12….jpg`, for a readable chip label. */
export function fileNameFromPath(path: string): string {
  return path.split('/').pop() ?? path;
}

export function isPdfPath(path: string): boolean {
  return /\.pdf$/i.test(path);
}
