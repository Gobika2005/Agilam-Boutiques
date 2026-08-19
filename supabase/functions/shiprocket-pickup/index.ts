/**
 * Register one boutique as a Shiprocket pickup address.
 *
 * Called when an admin approves a shop (and re-runnable from
 * Admin → Deliveries → Shiprocket). Replaces the copy-paste of retyping a
 * seller's address into Shiprocket's panel and pasting the nickname back.
 *
 * ADMIN ONLY. Creating a pickup address adds a collection point to the platform
 * account, so this is not something a seller may do for themselves — the caller
 * must hold the admin role, checked against `profiles`, not against a claim in
 * the JWT that the client could shape.
 *
 * THE LIMIT WORTH KNOWING (see migration 0068): Shiprocket's panel asks a human
 * to confirm a pin on a map; their API takes no coordinates and geocodes the
 * text address instead. So this is only as accurate as the seller's own
 * `address_line` and `pincode`. It refuses to guess — a shop missing an
 * address, pincode or phone is rejected here rather than registered badly,
 * because a pickup address the rider cannot find fails silently at collection
 * time, days later, and looks like a courier problem.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { CORS, SrError, getToken, json, serviceClient, srFetch } from '../_shared/shiprocket.ts';

type Shop = {
  id: string;
  name: string;
  owner_name: string | null;
  email: string | null;
  phone: string | null;
  address_line: string | null;
  district: string | null;
  state: string | null;
  pincode: string | null;
  shiprocket_pickup_location: string | null;
};

/**
 * Shiprocket's `pickup_location` is a short unique key, not a label — it is
 * matched literally on every booking. Built from the shop name so the panel
 * stays readable, suffixed with part of the boutique id so two shops called
 * "Nila Designers" cannot collide, and truncated because they reject long ones.
 */
function makeNickname(name: string, id: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 22)
    .replace(/-+$/, '');
  return `mm-${slug || 'shop'}-${id.replace(/-/g, '').slice(0, 6)}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const db = serviceClient();
  let boutiqueId: string | null = null;

  try {
    const body = await req.json().catch(() => ({}));
    boutiqueId = body?.boutiqueId ?? null;
    if (!boutiqueId) return json({ error: 'boutiqueId is required' }, 400);

    // ── Caller must be an admin ─────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'Not signed in' }, 401);

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
    );
    const { data: userData } = await userClient.auth.getUser();
    const user = userData?.user;
    if (!user) return json({ error: 'Not signed in' }, 401);

    const { data: profile } = await db
      .from('profiles').select('role').eq('id', user.id).maybeSingle();
    if (profile?.role !== 'admin') return json({ error: 'Admins only' }, 403);

    // ── Is the integration on ───────────────────────────────────────────────
    const { data: settings } = await db
      .from('platform_settings').select('shiprocket_enabled').eq('id', 1).maybeSingle();
    if (!settings?.shiprocket_enabled) {
      return json({ error: 'Shiprocket is switched off for this platform' }, 409);
    }

    // `boutiques` cannot be read with select('*') — column grants since 0021.
    const { data: shop } = await db
      .from('boutiques')
      .select('id, name, owner_name, email, phone, address_line, district, state, pincode, shiprocket_pickup_location')
      .eq('id', boutiqueId)
      .maybeSingle<Shop>();
    if (!shop) return json({ error: 'Boutique not found' }, 404);

    // Already done. Returned as success, not an error: approval may fire this
    // more than once, and a re-approval must not create a duplicate collection
    // point on the account.
    if (shop.shiprocket_pickup_location) {
      return json({ ok: true, alreadyRegistered: true, nickname: shop.shiprocket_pickup_location });
    }

    // ── Refuse to guess ─────────────────────────────────────────────────────
    const phone = (shop.phone ?? '').replace(/\D/g, '').slice(-10);
    const missing: string[] = [];
    if (!shop.address_line?.trim()) missing.push('shop address');
    if (!/^\d{6}$/.test((shop.pincode ?? '').trim())) missing.push('a 6-digit pincode');
    if (phone.length !== 10) missing.push('a 10-digit phone number');
    if (missing.length) {
      const message = `Cannot register a pickup address without ${missing.join(', ')}. Ask the seller to complete their shop profile.`;
      await db.from('boutiques').update({ shiprocket_pickup_error: message }).eq('id', shop.id);
      return json({ error: message }, 422);
    }

    const nickname = makeNickname(shop.name, shop.id);
    const token = await getToken(db);

    const created = await srFetch<{ success?: boolean; address?: { pickup_location?: string } }>(
      token,
      '/settings/company/addpickup',
      {
        method: 'POST',
        body: {
          pickup_location: nickname,
          name: (shop.owner_name ?? shop.name).slice(0, 36),
          email: shop.email ?? '',
          phone,
          address: shop.address_line!.trim().slice(0, 120),
          address_2: '',
          city: (shop.district ?? '').trim(),
          state: (shop.state ?? '').trim(),
          country: 'India',
          pin_code: shop.pincode!.trim(),
        },
      },
    );

    // Trust what comes back over what we sent: Shiprocket may normalise or
    // de-duplicate the nickname, and booking matches THEIR value literally.
    const saved = created?.address?.pickup_location ?? nickname;

    const { error: saveErr } = await db
      .from('boutiques')
      .update({
        shiprocket_pickup_location: saved,
        shiprocket_pickup_registered_at: new Date().toISOString(),
        shiprocket_pickup_error: null,
        // Not switched on automatically — an admin decides when a shop starts
        // booking, and the pin should be eyeballed in the panel first.
      })
      .eq('id', shop.id);

    if (saveErr) {
      // The collection point exists at Shiprocket but we did not record it.
      // Surfaced loudly: a retry would create a second one.
      console.error('pickup saved at Shiprocket but not in DB', { nickname: saved, error: saveErr.message });
      return json({
        error: `Pickup address "${saved}" was created at Shiprocket but could not be saved here. Paste it in by hand rather than registering again.`,
      }, 500);
    }

    return json({ ok: true, nickname: saved });
  } catch (e) {
    const message = e instanceof SrError
      ? e.message
      : e instanceof Error ? e.message : 'Could not register the pickup address';

    // Keep the reason where the admin console can show it. Shiprocket's
    // validation text is the diagnosis, so it is stored verbatim.
    if (boutiqueId) {
      await db.from('boutiques').update({ shiprocket_pickup_error: message }).eq('id', boutiqueId);
    }
    console.error('shiprocket-pickup failed', e);
    return json({ error: message }, e instanceof SrError && e.status < 500 ? e.status : 502);
  }
});
