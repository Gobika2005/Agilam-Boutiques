import { supabase } from '@/lib/supabase';

/**
 * Admin broadcast — fans a single notification out to a whole audience through
 * the `broadcast_notification` SECURITY DEFINER RPC (migration 0048). The RPC
 * itself re-checks admin, so this is just a thin wrapper.
 */
export type Audience = 'all' | 'buyer' | 'seller';

export type BroadcastResult = { ok: true; sent: number } | { ok: false; error: string };

export async function broadcast(audience: Audience, title: string, body: string): Promise<BroadcastResult> {
  const t = title.trim();
  const b = body.trim();
  if (!t || !b) return { ok: false, error: 'Please add a title and a message.' };

  const { data, error } = await supabase.rpc('broadcast_notification', { p_audience: audience, p_title: t, p_body: b });
  if (error) {
    if (/function .*broadcast_notification.* does not exist/i.test(error.message)) {
      return { ok: false, error: 'Broadcasts are not enabled yet — apply migration 0048.' };
    }
    console.error('broadcast failed:', error.message);
    return { ok: false, error: 'Could not send the broadcast. Please try again.' };
  }
  return { ok: true, sent: Number(data) || 0 };
}

/** Rough audience sizes so the composer can preview reach before sending. */
/**
 * How many people each audience reaches.
 *
 * "Everyone" is buyers + sellers, matching what `broadcast_notification` sends
 * (migration 0050). It used to count every profile row, so it silently included
 * admins and the tiles never added up — Everyone showed 19 against 4 buyers and
 * 13 sellers. Derived from the two role counts rather than a third query so the
 * arithmetic cannot drift again.
 */
export async function fetchAudienceSizes(): Promise<{ all: number; buyer: number; seller: number }> {
  const [buyer, seller] = await Promise.all([
    supabase.from('profiles').select('id', { count: 'exact', head: true }).is('deleted_at', null).eq('role', 'buyer'),
    supabase.from('profiles').select('id', { count: 'exact', head: true }).is('deleted_at', null).eq('role', 'seller'),
  ]);
  const b = buyer.count ?? 0;
  const s = seller.count ?? 0;
  return { all: b + s, buyer: b, seller: s };
}
