/**
 * Sharing the way shopping apps do — with the picture, not just a link.
 *
 * Passing `{ title, text, url }` to `navigator.share` hands the receiving app a
 * bare URL. WhatsApp and Instagram then show whatever `<meta og:image>` their
 * crawler finds, and this is a client-rendered SPA, so they find nothing: the
 * recipient gets a naked link with no picture and no context.
 *
 * Web Share Level 2 solves it properly: attach the image as a `File` and it
 * arrives inline with the caption. Everything degrades in the same order —
 * image + text, then text + link, then the caption on the clipboard — so every
 * browser gets the best it can do.
 *
 * Both a product (its photo) and a boutique (its logo) share through here, so
 * the two behave identically wherever they are shared from.
 */

export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed';

/**
 * Fetch an image as a shareable File.
 *
 * Returns null rather than throwing: a CORS-blocked CDN, an offline device or
 * an unsupported type should quietly fall back to a text share, never break the
 * share button.
 */
async function imageFile(src: string | undefined, name: string, fallbackName: string): Promise<File | null> {
  if (!src) return null;
  try {
    const res = await fetch(src, { mode: 'cors' });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.type.startsWith('image/')) return null;
    // Some targets reject very large attachments; an image well over 8 MB is
    // not worth failing the whole share for.
    if (blob.size > 8 * 1024 * 1024) return null;
    const ext = blob.type.split('/')[1]?.split('+')[0] || 'jpg';
    const safe = name.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 48) || fallbackName;
    return new File([blob], `${safe}.${ext}`, { type: blob.type });
  } catch {
    return null;
  }
}

/** The user dismissed the share sheet — not an error worth reporting. */
function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

async function shareWithImage(opts: {
  title: string;
  /** The full caption, link included — this is what a text-only target receives. */
  text: string;
  url: string;
  image?: string;
  /** Used for the attached file's name when the title has no usable characters. */
  fallbackName: string;
}): Promise<ShareResult> {
  const { title, text, url, image, fallbackName } = opts;

  if (typeof navigator !== 'undefined' && navigator.share) {
    // Best case: the picture travels with the caption.
    const file = await imageFile(image, title, fallbackName);
    if (file && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title, text });
        return 'shared';
      } catch (err) {
        if (isAbort(err)) return 'cancelled';
        // Fall through — some targets accept text but refuse files.
      }
    }

    try {
      await navigator.share({ title, text, url });
      return 'shared';
    } catch (err) {
      if (isAbort(err)) return 'cancelled';
    }
  }

  // Desktop browsers without the Share API: put the caption on the clipboard so
  // a paste carries the detail and the link, not just a naked URL.
  try {
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'failed';
  }
}

export type ShareProductInput = {
  title: string;
  price: string;
  url: string;
  image?: string;
  boutique?: string;
};

/** WhatsApp-friendly caption: what it is, what it costs, where to get it. */
function productCaption({ title, price, boutique, url }: ShareProductInput): string {
  const from = boutique ? ` from ${boutique}` : '';
  return `${title}${from}\n${price} on MangaiMart\n${url}`;
}

export function shareProduct(input: ShareProductInput): Promise<ShareResult> {
  return shareWithImage({
    title: input.title,
    text: productCaption(input),
    url: input.url,
    image: input.image,
    fallbackName: 'product',
  });
}

export type ShareBoutiqueInput = {
  name: string;
  url: string;
  /** The shop's logo. Falls back to the cover photo, so a boutique that has not
   *  uploaded a logo yet still shares with a picture rather than a bare link. */
  logo?: string;
  cover?: string;
  city?: string;
  desc?: string;
};

/** The boutique equivalent: who they are, where they are, where to find them. */
function boutiqueCaption({ name, city, desc, url }: ShareBoutiqueInput): string {
  const where = city ? ` · ${city}` : '';
  const line = desc?.trim() ? `${desc.trim()}\n` : '';
  return `${name}${where}\n${line}on MangaiMart\n${url}`;
}

export function shareBoutique(input: ShareBoutiqueInput): Promise<ShareResult> {
  return shareWithImage({
    title: input.name,
    text: boutiqueCaption(input),
    url: input.url,
    image: input.logo || input.cover,
    fallbackName: 'boutique',
  });
}

export type ShareBoardInput = {
  title: string;
  url: string;
  count: number;
  /** The first piece's photo — what the family sees before they tap. */
  image?: string;
};

/**
 * A shortlist asks for something, which is what makes its caption different
 * from the other two: a product share says "look at this", a board share says
 * "help me pick". The number matters — "4 options" tells the reader how long
 * this will take before they open it.
 */
function boardCaption({ title, count, url }: ShareBoardInput): string {
  const options = `${count} ${count === 1 ? 'option' : 'options'}`;
  return `Help me pick 👇\n${title} — ${options}\nTap a piece to say yes or no. No app, no sign-up.\n${url}`;
}

export function shareBoard(input: ShareBoardInput): Promise<ShareResult> {
  return shareWithImage({
    title: input.title,
    text: boardCaption(input),
    url: input.url,
    image: input.image,
    fallbackName: 'shortlist',
  });
}
