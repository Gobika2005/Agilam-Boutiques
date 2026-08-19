import { supabase } from '@/lib/supabase';

/**
 * Email broadcasts — the second channel on the admin Broadcast page.
 *
 * The bell broadcast next door (`@/data/broadcast`) calls a Postgres RPC and is
 * done in one round trip. Email cannot work that way: the Resend key is a server
 * secret, the list has to be walked in chunks, and consent has to be honoured per
 * recipient. All of that lives in the `broadcast-email` Edge Function — `api/` is
 * at Vercel's 12-route ceiling — and this module is the thin client for it.
 *
 * Nothing here throws. A blast is a one-shot, unrecallable action; the composer
 * needs a result it can show ("40 sent, 2 failed"), not an exception that loses
 * the count.
 */

export type EmailTemplate = 'announcement' | 'arrivals' | 'festival' | 'feature' | 'service';
/** `selected` is a hand-picked list of people, found by searching name or address. */
export type EmailAudience = 'all' | 'buyer' | 'seller' | 'selected';

/** The three that honour `marketing_opt_out` and carry an unsubscribe link. */
export const MARKETING_TEMPLATES: EmailTemplate[] = ['announcement', 'arrivals', 'festival', 'feature'];

export interface EmailBroadcastInput {
  template: EmailTemplate;
  audience: EmailAudience;
  subject: string;
  heading: string;
  preheader: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
  productIds: string[];
  /** Profile ids, when `audience` is 'selected'. Ignored otherwise. Max 50. */
  recipientIds: string[];
  alsoNotify: boolean;
  /** Send only to the signed-in admin, subject prefixed [TEST]. */
  test?: boolean;
}

export interface EmailBroadcastResult {
  ok: boolean;
  recipients: number;
  sent: number;
  failed: number;
  skippedOptOut: number;
  alsoNotified: boolean;
  test: boolean;
  error: string;
}

const EMPTY: EmailBroadcastResult = {
  ok: false, recipients: 0, sent: 0, failed: 0, skippedOptOut: 0, alsoNotified: false, test: false, error: '',
};

export async function sendEmailBroadcast(input: EmailBroadcastInput): Promise<EmailBroadcastResult> {
  try {
    const { data, error } = await supabase.functions.invoke('broadcast-email', { body: input });
    if (error) {
      // The function 404s until it is deployed, which is a setup step the owner
      // performs by hand — say so rather than showing a raw FunctionsFetchError.
      const notDeployed = /not found|404|failed to send a request/i.test(error.message);
      return {
        ...EMPTY,
        error: notDeployed
          ? 'Email broadcasts are not live yet — the broadcast-email function has to be deployed (supabase functions deploy broadcast-email).'
          : error.message,
      };
    }
    const res = (data ?? {}) as Partial<EmailBroadcastResult>;
    return { ...EMPTY, ...res, ok: res.ok === true };
  } catch (e) {
    return { ...EMPTY, error: e instanceof Error ? e.message : 'Could not send the broadcast' };
  }
}

/**
 * How many people a template would actually reach.
 *
 * Deliberately separate from `fetchAudienceSizes` in `@/data/broadcast`: that one
 * counts everyone in the bell audience, while this subtracts the people who have
 * no email address on file and — for marketing templates — the people who
 * unsubscribed. Showing the bell number next to an email send would overstate
 * the reach every time, which is exactly the number an operator reads before
 * pressing an unrecallable button.
 */
export interface EmailReach {
  buyer: number;
  seller: number;
  all: number;
  optedOut: number;
  /** True when migration 0089 has not been applied — the columns are missing. */
  notReady: boolean;
}

export async function fetchEmailReach(marketing: boolean): Promise<EmailReach> {
  const base = () =>
    supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .is('deleted_at', null)
      .eq('status', 'active')
      .not('email', 'is', null);

  try {
    const buyerQ = marketing ? base().eq('marketing_opt_out', false) : base();
    const sellerQ = marketing ? base().eq('marketing_opt_out', false) : base();

    const [buyer, seller, optedOut] = await Promise.all([
      buyerQ.eq('role', 'buyer'),
      sellerQ.eq('role', 'seller'),
      supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .is('deleted_at', null)
        .in('role', ['buyer', 'seller'])
        .eq('marketing_opt_out', true),
    ]);

    if (buyer.error && /marketing_opt_out|column/.test(buyer.error.message)) {
      return { buyer: 0, seller: 0, all: 0, optedOut: 0, notReady: true };
    }

    const b = buyer.count ?? 0;
    const s = seller.count ?? 0;
    return { buyer: b, seller: s, all: b + s, optedOut: optedOut.count ?? 0, notReady: false };
  } catch {
    return { buyer: 0, seller: 0, all: 0, optedOut: 0, notReady: true };
  }
}

export interface EmailPerson {
  id: string;
  full_name: string;
  email: string;
  role: string;
  marketing_opt_out: boolean;
}

/**
 * Find individual people to email, by name or address.
 *
 * This is the "email these four sellers about their pending verification" path,
 * not a second way to blast a role — the Edge Function caps a hand-picked send at
 * 50. Unlike the role audiences it will return admins and staff too: when you
 * have typed someone's name and chosen them from a list, excluding your own
 * colleagues is surprising rather than protective.
 *
 * The opt-out state comes back so the composer can warn BEFORE sending that a
 * marketing template will skip someone who has unsubscribed.
 */
export async function searchEmailRecipients(term: string): Promise<EmailPerson[]> {
  // `or()` takes a comma-separated filter STRING, so a comma, parenthesis or
  // backslash in the term is parsed as filter syntax rather than searched for —
  // at best a 400, at worst a filter the caller did not write. Stripped rather
  // than escaped: none of the four appear in a name or an address anyone would
  // be searching for.
  const q = term.trim().replace(/[,()\\]/g, ' ').trim();
  if (q.length < 2) return [];

  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, role, marketing_opt_out')
    .is('deleted_at', null)
    .eq('status', 'active')
    .not('email', 'is', null)
    .or(`full_name.ilike.%${q}%,email.ilike.%${q}%`)
    .order('full_name')
    .limit(20);

  if (error) return [];
  return (data ?? []) as EmailPerson[];
}

export interface PickableProduct {
  id: string;
  title: string;
  price: number;
  image_url: string | null;
}

/**
 * Products the admin can drop into the "new arrivals" template. Newest first,
 * live listings only — an email that links to a hidden or out-of-stock product
 * is worse than one with no products at all.
 */
export async function fetchPickableProducts(search: string): Promise<PickableProduct[]> {
  let q = supabase
    .from('products')
    .select('id, title, price, image_url')
    .eq('status', 'active')
    .eq('auto_hidden', false)
    .gt('stock', 0)
    .order('created_at', { ascending: false })
    .limit(24);

  const term = search.trim();
  if (term) q = q.ilike('title', `%${term}%`);

  const { data, error } = await q;
  if (error) return [];
  return (data ?? []) as PickableProduct[];
}

export interface EmailBroadcastRow {
  id: string;
  created_at: string;
  audience: EmailAudience;
  template: EmailTemplate;
  subject: string;
  recipients: number;
  sent: number;
  failed: number;
  skipped_opt_out: number;
  also_notified: boolean;
  status: 'sending' | 'sent' | 'partial' | 'failed';
}

/** What has already gone out — so nobody sends the same festival greeting twice. */
export async function fetchEmailBroadcastHistory(): Promise<EmailBroadcastRow[]> {
  const { data, error } = await supabase
    .from('email_broadcasts')
    .select('id, created_at, audience, template, subject, recipients, sent, failed, skipped_opt_out, also_notified, status')
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) return [];
  return (data ?? []) as EmailBroadcastRow[];
}
