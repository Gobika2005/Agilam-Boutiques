import { supabase } from '@/lib/supabase';

/** A UUID that works even outside a secure context. `crypto.randomUUID` is only
 *  available over HTTPS/localhost, so a seller opening the app on a LAN IP
 *  (e.g. their phone at http://192.168.x.x) would otherwise crash the upload. */
export function randomId(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  if (c?.getRandomValues) {
    const b = c.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map((x) => x.toString(16).padStart(2, '0'));
    return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-${h.slice(8, 10).join('')}-${h.slice(10).join('')}`;
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * A descriptive, URL-safe stem for a stored file — `"Kanchipuram Silk Saree"` →
 * `mangaimart-kanchipuram-silk-saree`.
 *
 * Every photo in the catalogue was stored as a bare UUID
 * (`<boutique-id>/9f3c1a2b-….jpg`), so the filename — which Google Images reads
 * as a weak relevance signal, and which is the only text attached to the file
 * once it is hotlinked or saved — said nothing at all. The brand prefix is what
 * makes the file recognisable as MangaiMart's wherever it ends up.
 *
 * Deliberately a WEAK signal handled cheaply: alt text and the copy surrounding
 * an image outrank its filename by a wide margin, and both are already right.
 * This is worth doing because it is free at upload time, not because it moves a
 * ranking on its own.
 *
 * Capped at 60 characters so a seller who types a paragraph into the title
 * field cannot produce a storage key long enough to trip Supabase's limit.
 */
function fileStem(hint: string | undefined): string {
  const slug = (hint || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  // `mangaimart` alone when there is no hint — still better than a bare UUID,
  // and it keeps every object in the bucket brand-attributable.
  return slug ? `mangaimart-${slug}` : 'mangaimart';
}

/**
 * Uploads an image to a public Supabase Storage bucket and returns its public URL.
 * Shared by product photos and boutique branding so both get the same validation,
 * secure-context-safe filenames and diagnosable errors.
 *
 * `nameHint` is free text describing the subject (a product title, a shop name).
 * It only shapes the filename — the random id after it is what actually keeps
 * the path unique, so two pieces with the same title cannot collide.
 */
export async function uploadImage(
  bucket: string,
  folder: string,
  file: File,
  migrationHint: string,
  nameHint?: string,
): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Please choose an image file (JPG or PNG)');
  if (file.size > 10 * 1024 * 1024) throw new Error('Image is too large — please use one under 10 MB');

  // An RLS denial on upload is almost always a missing/expired session, since the
  // storage policy is gated on `to authenticated`. Check first so the seller gets
  // "sign in again" instead of an opaque row-level-security error.
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) throw new Error('Your session expired — please sign in again to upload photos');

  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  // The stem is descriptive; the random id after it is what guarantees
  // uniqueness, which `upsert: false` and the immutable cache header below both
  // depend on. Never reduce this to the stem alone.
  const path = `${folder}/${fileStem(nameHint)}-${randomId()}.${ext}`;
  const { error } = await supabase.storage
    .from(bucket)
    /*
     * A year, immutable.
     *
     * Without `cacheControl` Supabase serves these with a one-hour TTL, so a
     * returning buyer re-downloaded every photo on the page — and the image
     * transformer inherits the origin object's header, meaning the resized
     * WebP the catalogue actually serves expired hourly too.
     *
     * Safe because the path is `${folder}/${randomId()}.${ext}` and the upload
     * is `upsert: false`: a URL is minted once and its bytes never change. A
     * replaced photo is a new random path, so there is nothing to invalidate.
     */
    .upload(path, file, {
      upsert: false,
      contentType: file.type || undefined,
      cacheControl: '31536000',
    });
  if (error) {
    // Surface the underlying cause instead of a generic failure so setup issues
    // (missing bucket / missing storage RLS policy) are diagnosable from the toast.
    if (/bucket.*not found/i.test(error.message)) {
      throw new Error(`Photo storage is not set up yet (apply migration ${migrationHint} in Supabase)`);
    }
    if (/row-level security|violates|unauthorized/i.test(error.message)) {
      throw new Error(`Storage upload blocked by RLS — apply migration ${migrationHint} in Supabase`);
    }
    throw new Error(error.message || 'Photo upload failed');
  }
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}
