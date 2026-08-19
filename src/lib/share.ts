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
  /**
   * An already-built attachment, used in preference to fetching `image`.
   *
   * It exists for the shortlist collage, which is composed from several photos
   * and cannot be produced quickly enough inside a tap: Safari drops the
   * transient user activation that `navigator.share` requires while we await,
   * and the share sheet then refuses to open. The caller builds it in advance
   * and hands it over ready.
   */
  file?: File | null;
  /** Used for the attached file's name when the title has no usable characters. */
  fallbackName: string;
}): Promise<ShareResult> {
  const { title, text, url, image, fallbackName } = opts;

  if (typeof navigator !== 'undefined' && navigator.share) {
    // Best case: the picture travels with the caption.
    const file = opts.file ?? (await imageFile(image, title, fallbackName));
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
  /**
   * What she's deciding — "Divya's wedding". Left undefined when she skipped
   * the occasion field, which matters: the board still needs a stored title, so
   * it falls back to "Which one should I get?", and printing that under "Help
   * me pick?" stacks two questions on top of each other.
   */
  occasion?: string;
  url: string;
  count: number;
  /**
   * All the pieces, drawn into one numbered square by `@/lib/boardCollage` —
   * what the family sees in the chat list before they tap anything. Built ahead
   * of the tap, because composing it takes several fetches and awaiting those
   * inside the gesture costs us the share sheet on Safari.
   */
  collage?: File | null;
  /** The first piece's photo. Used only when the collage could not be built. */
  image?: string;
};

/**
 * A shortlist asks for something, which is what makes its caption different
 * from the other two: a product share says "look at this", a board share says
 * "help me choose".
 *
 * It is also the only one of the three that is a message from HER to people who
 * know her, rather than the app talking to a stranger — so it reads like a
 * person asking a favour, not like a product explaining itself. Each line is
 * doing a job:
 *
 *   • the occasion, because "for Divya's wedding" is what makes a relative stop
 *     scrolling and care;
 *   • the count, because it tells them how long this will take before they
 *     commit to opening anything;
 *   • "no sign-up required", because that is the question that would otherwise
 *     stop an aunt from tapping at all;
 *   • "Vote here", because a bare link in a family group gets ignored.
 *
 * One piece is a different message. "Help me choose" between one thing is
 * nonsense, and the product page's one-tap ask makes exactly that board — so it
 * asks for an opinion rather than a vote.
 */
function boardCaption({ occasion, count, url }: ShareBoardInput): string {
  const where = occasion?.trim() ? ` for ${occasion.trim()}` : '';

  const message =
    count === 1
      ? `What do you think of this one${where}?🩷\nJust tap to tell me—no sign-up required. 😊`
      : `Help me choose${where}!🩷\nI've shortlisted ${count} beautiful outfits.\n` +
        `Just tap your favourite—no sign-up required. 😊`;

  return `${message}\n👇 Vote here:\n${url}`;
}

export function shareBoard(input: ShareBoardInput): Promise<ShareResult> {
  return shareWithImage({
    // The native share sheet's own heading, and the attached file's name.
    title: input.occasion?.trim() || 'Help me pick',
    text: boardCaption(input),
    url: input.url,
    file: input.collage,
    image: input.image,
    fallbackName: 'shortlist',
  });
}
