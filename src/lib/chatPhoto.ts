import { uploadPrivateFile, signedFileUrl } from '@/lib/privateUpload';

/**
 * Photos sent in a conversation.
 *
 * The bucket is private (migration 0079), so what is stored in the message is
 * the object PATH, never a URL. A signed URL lives for an hour; a message lives
 * forever, and a thread reopened next week would be a column of broken images.
 * The path is signed on demand, when a bubble actually renders.
 *
 * Everything is re-encoded to JPEG before it leaves the device, which does three
 * jobs at once: it strips the EXIF block (a phone photo carries GPS
 * coordinates, and a buyer sending a picture of a dress should not be sending
 * her address with it), it takes a 5 MB camera original down to a few hundred
 * kilobytes on a mobile connection, and it means the bucket only ever holds
 * formats every browser can display.
 */

/** Long edge, in pixels. A chat bubble is ~300px wide; 1600 survives a zoom. */
const MAX_EDGE = 1600;
const QUALITY = 0.82;

/** What the picker accepts. HEIC is included so an iPhone can offer its own
 *  photos — Safari decodes it into a canvas, and what we upload is the JPEG. */
export const CHAT_PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,image/*';

/** Before re-encoding. The bucket's own cap is 8 MB, after the downscale. */
const MAX_INPUT_BYTES = 25 * 1024 * 1024;

export const CHAT_BUCKET = 'chat-images';

/** A photo message's body, as it is stored. */
export type ChatImage = { path: string; w: number; h: number; caption?: string };

export const IMAGE_MARKER = '@@IMAGE@@';

export function encodeImageMessage(img: ChatImage): string {
  return IMAGE_MARKER + JSON.stringify(img);
}

export function parseImageMessage(body: string): ChatImage | null {
  if (!body.startsWith(IMAGE_MARKER)) return null;
  try {
    const parsed = JSON.parse(body.slice(IMAGE_MARKER.length)) as ChatImage;
    return parsed && typeof parsed.path === 'string' && parsed.path ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Decode, downscale and re-encode. Returns the JPEG plus the dimensions the
 * bubble should reserve — without them the thread jumps as each photo lands.
 */
async function toJpeg(file: File): Promise<{ blob: Blob; w: number; h: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      // The realistic cause is HEIC on a browser that cannot decode it, so the
      // message names a fix the sender can actually carry out.
      el.onerror = () => reject(new Error('That image could not be read — try saving it as a JPEG first'));
      el.src = url;
    });

    const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not process that image');
    // A transparent PNG flattens onto white rather than onto black, which is
    // what an un-cleared canvas would give a JPEG encoder.
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);

    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', QUALITY));
    if (!blob) throw new Error('Could not process that image');
    return { blob, w, h };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Prepare and upload one photo, returning the message body to send.
 *
 * The object lands under the conversation's own id, which is what the storage
 * policies in 0079 read to decide who may fetch it — so the path is not merely
 * tidy, it is the access rule.
 */
export async function uploadChatPhoto(conversationId: string, file: File): Promise<ChatImage> {
  if (!file.type.startsWith('image/')) throw new Error('Please choose a photo');
  if (file.size > MAX_INPUT_BYTES) throw new Error('That photo is too large — please use one under 25 MB');

  const { blob, w, h } = await toJpeg(file);
  const jpeg = new File([blob], 'photo.jpg', { type: 'image/jpeg' });
  const path = await uploadPrivateFile(CHAT_BUCKET, conversationId, jpeg, '0079');
  return { path, w, h };
}

/**
 * A viewable link for a stored photo.
 *
 * An hour, rather than the ten minutes the expense proofs use: a buyer scrolls
 * back through a thread, and a link that dies while they are still reading it
 * turns the history into broken images.
 */
export function signChatPhoto(path: string): Promise<string | null> {
  return signedFileUrl(CHAT_BUCKET, path, 3600);
}

/** The one-line summary shown outside the thread. Mirrors `message_preview` in
 *  migration 0079 — the path never appears in either. */
export function imagePreview(img: ChatImage): string {
  return `📷 ${img.caption?.trim() || 'Photo'}`;
}
