/** Normalizes a buyer-entered phone number to WhatsApp's `wa.me` format
 *  (country code + number, digits only). Assumes India (+91) when a bare
 *  10-digit number is given, since the app only operates in India today. */
export function normalizeIndianPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return '91' + digits;
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  if (digits.length === 11 && digits.startsWith('0')) return '91' + digits.slice(1);
  return digits;
}

/** Direct-to-contact WhatsApp deep link — opens a chat with `phone` prefilled with `message`. */
export function buildWhatsAppLink(phone: string, message: string): string {
  return `https://wa.me/${normalizeIndianPhone(phone)}?text=${encodeURIComponent(message)}`;
}

export type BillItem = { title: string; qty: number; price: number };

/** Short greeting/promo caption sent alongside the bill image/PDF (the
 *  itemized breakdown lives on the image itself now — see BillReceipt — so
 *  this text stays a personal thank-you + a nudge back to the boutique's
 *  shareable MangaiMart page, not a re-statement of the bill). */
export function buildBillShareCaption(opts: {
  boutiqueName: string;
  boutiqueSlug?: string | null;
  buyerName?: string;
  billNumber: string;
  total: number;
}): string {
  const { boutiqueName, boutiqueSlug, buyerName, billNumber, total } = opts;
  const lines: string[] = [];
  lines.push(`Hi ${buyerName?.trim() || 'there'}, thank you for shopping with ${boutiqueName}!`);
  lines.push(`Here's your bill ${billNumber} — total ₹${total.toLocaleString('en-IN')}.`);
  lines.push('');
  lines.push(`Loved what you got? Visit ${boutiqueName} again and explore more boutiques on MangaiMart:`);
  if (boutiqueSlug) {
    lines.push(`${window.location.origin}/b/${boutiqueSlug}`);
  } else {
    lines.push(window.location.origin);
  }
  return lines.join('\n');
}
