import { supabase } from '@/lib/supabase';
import { fetchOrdersForBuyer } from '@/data/orders';
import { fromBuyerOrder, mergeServerOrders, type BuyerDbOrder } from '@/lib/orderHistory';

/**
 * Cross-device sync for a signed-in buyer.
 *
 * A signed-in buyer has a real account, so everything works through existing
 * RLS from the browser — no service role: their profile lives in `profiles`
 * (self-update policy) and their orders read back via the `buyer_id` policy.
 */

export type LocalProfile = { name: string; phone: string; city: string; address: string; pincode: string };

// Seeded placeholder names AuthContext gives a fresh account — treat as "unset".
const PLACEHOLDER_NAMES = ['New user', 'Customer'];

/**
 * Merge the buyer's account profile with what's in the browser, and pull their
 * orders back.
 *
 * - `local` — details currently in the browser (guest state).
 * - `patch` — an explicit edit the buyer just saved; overrides everything.
 *
 * With no patch this MERGES so nothing is lost: the account (DB) wins where it
 * has a value, otherwise the local value fills it in. So details typed as a
 * guest migrate up on first sign-in, and a later sign-in (or a page refresh,
 * even after logout wiped local) restores whatever the account holds.
 *
 * It is deliberately fault-tolerant: any DB hiccup (RLS lag, a not-yet-run
 * migration such as the `address` column) is swallowed and the LOCAL details are
 * returned untouched, so a refresh can never blank out what's already on screen.
 */
export async function syncAccount(local: LocalProfile, patch?: LocalProfile): Promise<LocalProfile> {
  const { data } = await supabase.auth.getSession();
  const uid = data.session?.user?.id;
  if (!uid) throw new Error('Not signed in');

  // Default to what we already have, so a failed read never loses data.
  let next: LocalProfile = patch ? { ...patch } : { ...local };

  try {
    const { data: prof, error } = await supabase
      .from('profiles')
      .select('full_name, phone, city, address, pincode')
      .eq('id', uid)
      .maybeSingle();

    if (!error) {
      const dbName = prof?.full_name && !PLACEHOLDER_NAMES.includes(prof.full_name) ? prof.full_name : '';
      const base: LocalProfile = { name: dbName, phone: prof?.phone ?? '', city: prof?.city ?? '', address: prof?.address ?? '', pincode: prof?.pincode ?? '' };

      // Explicit edit overrides; otherwise fill the account's blanks from local.
      next = patch
        ? { name: patch.name, phone: patch.phone, city: patch.city, address: patch.address, pincode: patch.pincode }
        : {
            name: base.name || local.name,
            phone: base.phone || local.phone,
            city: base.city || local.city,
            address: base.address || local.address,
            pincode: base.pincode || local.pincode,
          };

      // Persist only when it changes what the account holds.
      const changed = next.name !== base.name || next.phone !== base.phone || next.city !== base.city || next.address !== base.address || next.pincode !== base.pincode;
      if (changed) {
        await supabase
          .from('profiles')
          .update({ full_name: next.name, phone: next.phone || null, city: next.city || null, address: next.address || null, pincode: next.pincode || null })
          .eq('id', uid);
      }
    }
  } catch {
    /* DB unavailable / migration pending — keep `next` (local or patch) intact */
  }

  // Orders are independent of the profile read; merge whatever we can get.
  try {
    const orders = await fetchOrdersForBuyer(uid);
    mergeServerOrders(orders.map((o) => fromBuyerOrder(o as unknown as BuyerDbOrder)));
  } catch {
    /* offline / RLS — keep the local order history */
  }

  return next;
}
