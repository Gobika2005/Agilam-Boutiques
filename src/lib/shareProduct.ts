/**
 * Sharing a product the way shopping apps do — with the photo, not just a link.
 *
 * The old implementation passed `{ title, text, url }` to `navigator.share`,
 * which hands the receiving app a bare URL. WhatsApp and Instagram then show
 * whatever `<meta og:image>` the crawler finds, and this is a client-rendered
 * SPA, so they find nothing.
 *
 * Web Share Level 2 solves it properly: attach the product photo as a `File`
 * and the recipient sees the image inline with the caption. We degrade in
 * order — image + text, then text + link, then copy to clipboard — so every
 * browser gets the best it can do.
 */

export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed';

export type ShareProductInput = {
  title: string;
  price: string;
  url: string;
  image?: string;
  boutique?: string;
};

/** WhatsApp-friendly caption: what it is, what it costs, where to get it. */
function caption({ title, price, boutique, url }: ShareProductInput): string {
  const from = boutique ? ` from ${boutique}` : '';
  return `${title}${from}\n${price} on MangaiMart\n${url}`;
}

/**
 * Fetch the product photo as a shareable File.
 *
 * Returns null rather than throwing: a CORS-blocked CDN, an offline device or
 * an unsupported type should quietly fall back to a text share, never break the
 * share button.
 */
async function imageFile(src: string | undefined, title: string): Promise<File | null> {
  if (!src) return null;
  try {
    const res = await fetch(src, { mode: 'cors' });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.type.startsWith('image/')) return null;
    // Some targets reject very large attachments; a product photo well over
    // 8 MB is not worth failing the whole share for.
    if (blob.size > 8 * 1024 * 1024) return null;
    const ext = blob.type.split('/')[1]?.split('+')[0] || 'jpg';
    const safe = title.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 48) || 'product';
    return new File([blob], `${safe}.${ext}`, { type: blob.type });
  } catch {
    return null;
  }
}

export async function shareProduct(input: ShareProductInput): Promise<ShareResult> {
  const text = caption(input);

  if (typeof navigator !== 'undefined' && navigator.share) {
    // Best case: the photo travels with the caption.
    const file = await imageFile(input.image, input.title);
    if (file && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: input.title, text });
        return 'shared';
      } catch (err) {
        if (isAbort(err)) return 'cancelled';
        // Fall through — some targets accept text but refuse files.
      }
    }

    try {
      await navigator.share({ title: input.title, text, url: input.url });
      return 'shared';
    } catch (err) {
      if (isAbort(err)) return 'cancelled';
    }
  }

  // Desktop browsers without the Share API: put the caption on the clipboard so
  // a paste carries the price and the link, not just a naked URL.
  try {
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'failed';
  }
}

/** The user dismissed the share sheet — not an error worth reporting. */
function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}
