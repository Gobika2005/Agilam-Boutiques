import { useSyncExternalStore } from 'react';
import { supabase } from '@/lib/supabase';
import { POLICY_TERMS, COMPANY } from '@/data/company';

/**
 * Platform settings — the admin-editable commercial knobs (commission, fees,
 * hold window…) added in migration 0048. Falls back to the compile-time
 * defaults in company.ts when the table isn't there yet, so the console renders
 * and degrades gracefully before the migration is applied.
 *
 * These are not just for the console. `src/lib/pricing.ts` prices every bag from
 * the cached row below, and `api/_settings.js` loads the same row server-side so
 * api/place-order.js re-derives an identical total. Before this was wired the
 * admin form saved values nothing ever read, and the storefront quietly kept
 * charging the compile-time constants.
 */
/**
 * Which Razorpay merchant account collects money right now. The keys themselves
 * live in the server environment (RAZORPAY_KEY_ID/_SECRET and the `_B` pair) —
 * this only names the slot, which is why it is safe under the table's public
 * read policy.
 */
export type RazorpayAccount = 'primary' | 'backup';

/**
 * Delivery and cash-on-delivery are deliberately absent.
 *
 * The delivery charge, the free-delivery threshold, the cash-handling fee and
 * the COD cap were platform-wide knobs here until migration 0076; they are now
 * each boutique's own, set in the seller console and priced per boutique by
 * src/lib/pricing.ts. The columns still exist in the table — dropping live
 * columns is not worth the risk — but nothing reads them, and they are gone from
 * this type so nothing accidentally starts to again.
 */
export interface PlatformSettings {
  commission_pct: number;
  return_window_days: number;
  payout_hold_days: number;
  /** Hours after delivery within which a seller payout is promised (migration
   *  0078). The admin Payouts console counts down against it and flags anything
   *  past it; the seller console publishes it. Delivery decides what is payable
   *  — this only decides when it is late. */
  payout_sla_hours: number;
  maintenance_mode: boolean;
  support_email: string;
  razorpay_account: RazorpayAccount;
  /** Master switch for WhatsApp order updates (migration 0090). False leaves the
   *  outbox filling and unsent — the triggers always queue, so the queue can be
   *  inspected before a single message goes out. */
  whatsapp_enabled: boolean;
  /** Coming-soon mode (migration 0096). True takes the storefront and the
   *  seller console off the air behind a "launching soon" page, served by
   *  middleware.js at the edge with HTTP 503. Distinct from `maintenance_mode`,
   *  which only adds a banner to a site that keeps working. */
  coming_soon: boolean;
  updated_at: string | null;
}

export const DEFAULT_SETTINGS: PlatformSettings = {
  commission_pct: POLICY_TERMS.commissionPct,
  return_window_days: POLICY_TERMS.returnWindowDays,
  payout_hold_days: 3,
  payout_sla_hours: 8,
  maintenance_mode: false,
  support_email: COMPANY.supportEmail,
  razorpay_account: 'primary',
  // Off until the Meta credentials are set and the templates are approved. A
  // deployment without migration 0090 also lands here, and must stay off.
  whatsapp_enabled: false,
  // Off unless the database says otherwise. A deployment without migration 0096
  // has no such column, `merge()` keeps this default, and the site stays up —
  // failing OPEN is right here: the alternative is a missing migration hiding a
  // live marketplace behind a launch page.
  coming_soon: false,
  updated_at: null,
};

function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === 'PGRST205' || /relation .*platform_settings.* does not exist/i.test(error.message ?? '');
}

export async function fetchSettings(): Promise<PlatformSettings> {
  const { data, error } = await supabase.from('platform_settings').select('*').eq('id', 1).maybeSingle();
  if (error) {
    if (!isMissingTable(error)) console.error('fetchSettings failed:', error.message);
    return DEFAULT_SETTINGS;
  }
  if (!data) return DEFAULT_SETTINGS;
  return merge(data as Partial<PlatformSettings>);
}

/**
 * Overlay a stored row on the defaults, ignoring blanks.
 *
 * A column that is null, an empty string or a non-finite number keeps its
 * default rather than overwriting it — otherwise an unset `support_email`
 * blanks out the published support address, and a null fee would price a cart
 * at NaN. This is why the Settings form showed an empty support email despite
 * `COMPANY.supportEmail` having a value.
 */
function merge(row: Partial<PlatformSettings>): PlatformSettings {
  const out = { ...DEFAULT_SETTINGS };
  for (const [k, v] of Object.entries(row) as [keyof PlatformSettings, unknown][]) {
    if (v == null) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    if (typeof v === 'number' && !Number.isFinite(v)) continue;
    (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

export type SaveResult = { ok: true } | { ok: false; error: string };

export async function saveSettings(patch: Partial<PlatformSettings>, updatedBy?: string | null): Promise<SaveResult> {
  const { error } = await supabase
    .from('platform_settings')
    .update({ ...patch, updated_at: new Date().toISOString(), updated_by: updatedBy ?? null })
    .eq('id', 1);
  if (error) {
    if (isMissingTable(error)) return { ok: false, error: 'Settings are not enabled yet — apply migration 0048.' };
    console.error('saveSettings failed:', error.message);
    return { ok: false, error: 'Could not save settings. Please try again.' };
  }
  // Push the saved values into the live cache so pricing, the policy copy and
  // every open screen pick them up without a reload.
  publish({ ...current, ...patch });
  return { ok: true };
}

/**
 * Flip which Razorpay merchant account collects money, as its own write.
 *
 * Deliberately NOT folded into the commercial-terms form. Two reasons:
 *
 *   • It is an emergency control. It has to take effect the moment it is
 *     tapped, not when someone remembers to press "Save changes" — and it must
 *     not ride along with an unrelated half-finished edit to the COD fee.
 *   • It writes a column added in migration 0064. Sending it inside the main
 *     patch would make the ENTIRE settings form fail to save on any deployment
 *     where 0064 hasn't been applied yet, taking commission and fees down with
 *     it. Isolated, a missing column only breaks the switch, and says so.
 *
 * The next /api/create-order reads the new value, so the change is live for the
 * following checkout — no redeploy.
 */
export async function setRazorpayAccount(account: RazorpayAccount, updatedBy?: string | null): Promise<SaveResult> {
  const { error } = await supabase
    .from('platform_settings')
    .update({ razorpay_account: account, updated_at: new Date().toISOString(), updated_by: updatedBy ?? null })
    .eq('id', 1);
  if (error) {
    if (isMissingTable(error)) return { ok: false, error: 'Settings are not enabled yet — apply migration 0048.' };
    // PGRST204 = "column not found in schema cache", i.e. 0064 hasn't been run.
    if (error.code === 'PGRST204' || /razorpay_account/i.test(error.message ?? '')) {
      return { ok: false, error: 'The payment-account switch needs migration 0064 applied first.' };
    }
    console.error('setRazorpayAccount failed:', error.message);
    return { ok: false, error: 'Could not switch the payment account. Please try again.' };
  }
  publish({ ...current, razorpay_account: account });
  return { ok: true };
}

/**
 * Put the public site behind the coming-soon page, or take it back off.
 *
 * Its own write, for both of `setRazorpayAccount`'s reasons:
 *
 *   • It takes effect the moment it is tapped, not when someone remembers to
 *     press "Save changes" — and it must not ride along with an unrelated
 *     half-finished edit to the commission rate.
 *   • It writes a column added in migration 0096. Sent inside the main settings
 *     patch, a database that has not run 0096 yet would fail the ENTIRE form,
 *     taking commission, the return window and the payout hold down with it.
 *     Isolated, a missing column breaks only this switch — and says so.
 *
 * The edge reads `platform_settings` directly on the next request, so the site
 * goes dark (or comes back) without a redeploy. Give the CDN a moment: the
 * shell is cached, so a page or two may still serve from the edge cache.
 */
export async function setComingSoon(on: boolean, updatedBy?: string | null): Promise<SaveResult> {
  const { error } = await supabase
    .from('platform_settings')
    .update({ coming_soon: on, updated_at: new Date().toISOString(), updated_by: updatedBy ?? null })
    .eq('id', 1);
  if (error) {
    if (isMissingTable(error)) return { ok: false, error: 'Settings are not enabled yet — apply migration 0048.' };
    // PGRST204 = "column not found in schema cache", i.e. 0096 hasn't been run.
    if (error.code === 'PGRST204' || /coming_soon/i.test(error.message ?? '')) {
      return { ok: false, error: 'Coming-soon mode needs migration 0096 applied first.' };
    }
    console.error('setComingSoon failed:', error.message);
    return { ok: false, error: 'Could not change coming-soon mode. Please try again.' };
  }
  publish({ ...current, coming_soon: on });
  return { ok: true };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Live cache
 *
 * Pricing runs in synchronous code paths (cart memos, render), so it cannot
 * await a fetch. The app loads the row once at boot and everything reads this
 * snapshot; until it resolves, the compile-time defaults apply — the same
 * numbers the policy pages quote, so a slow load can never price a bag at zero.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Last known settings, kept in localStorage and read back synchronously on the
 * very first render.
 *
 * Without it the app spends the first second or two of every visit on the
 * compile-time defaults and then swaps to the real row when the fetch lands.
 * That is visible in two ways:
 *
 *   • the maintenance banner is absent from the first paint and then inserted
 *     at the top of the document, pushing the whole page down ~53px mid-read —
 *     measured as a layout shift of 0.06 on every screen while it is switched on
 *   • the delivery fee and free-delivery threshold render at their defaults
 *     first, so a cart can visibly re-price itself under the buyer
 *
 * A stale cached value is harmless: it is one render old at worst, the network
 * row overwrites it a moment later, and every number it can supply is one the
 * defaults would have supplied anyway. Pricing that matters is still re-derived
 * server-side at checkout (`api/_settings.js`), so this can never decide what
 * someone is actually charged.
 */
const CACHE_KEY = 'agx:platform-settings';

function readCache(): PlatformSettings {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return merge(JSON.parse(raw) as Partial<PlatformSettings>);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function writeCache(s: PlatformSettings) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(s));
  } catch {
    /* private mode / quota — the app just loads from the network as before */
  }
}

let current: PlatformSettings = readCache();
/** Whether `current` is still only a guess (defaults or cache), not the live row. */
let loadedFromNetwork = false;
let inflight: Promise<PlatformSettings> | null = null;
const listeners = new Set<() => void>();

function publish(next: PlatformSettings) {
  current = next;
  writeCache(next);
  listeners.forEach((l) => l());
}

/** The settings in force right now. Never null — defaults until the load lands. */
export function currentSettings(): PlatformSettings {
  return current;
}

/** Load (once) and cache the platform settings. Safe to call repeatedly. */
export function loadSettings(force = false): Promise<PlatformSettings> {
  if (inflight) return inflight;
  // `loadedFromNetwork`, not `current !== DEFAULT_SETTINGS`: with the cache in
  // place `current` is already populated on the first call, and the old check
  // would have taken that as "loaded" and never fetched the live row at all.
  if (!force && loadedFromNetwork) return Promise.resolve(current);
  inflight = fetchSettings()
    .then((s) => { loadedFromNetwork = true; publish(s); return s; })
    .finally(() => { inflight = null; });
  return inflight;
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/**
 * Subscribe to settings changes from outside this module.
 *
 * Exported for `src/data/policies.ts`, which builds the buyer-facing legal copy
 * from these same values and needs its own `useSyncExternalStore` over them.
 * Importing `useSettings` there instead would be circular — settings.ts already
 * imports the copy-only terms from company.ts, which policies.ts also uses.
 */
export const subscribeSettings = subscribe;

/** Re-renders the component when the platform settings land or change. */
export function useSettings(): PlatformSettings {
  return useSyncExternalStore(subscribe, currentSettings, currentSettings);
}
