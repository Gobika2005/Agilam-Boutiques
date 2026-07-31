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
export interface PlatformSettings {
  commission_pct: number;
  cod_fee: number;
  cod_max_order: number;
  free_delivery_over: number;
  standard_shipping: number;
  return_window_days: number;
  payout_hold_days: number;
  maintenance_mode: boolean;
  support_email: string;
  updated_at: string | null;
}

export const DEFAULT_SETTINGS: PlatformSettings = {
  commission_pct: POLICY_TERMS.commissionPct,
  cod_fee: POLICY_TERMS.codFee,
  cod_max_order: POLICY_TERMS.codMaxOrder,
  free_delivery_over: POLICY_TERMS.freeDeliveryOver,
  standard_shipping: POLICY_TERMS.standardShipping,
  return_window_days: POLICY_TERMS.returnWindowDays,
  payout_hold_days: 3,
  maintenance_mode: false,
  support_email: COMPANY.supportEmail,
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

/* ────────────────────────────────────────────────────────────────────────────
 * Live cache
 *
 * Pricing runs in synchronous code paths (cart memos, render), so it cannot
 * await a fetch. The app loads the row once at boot and everything reads this
 * snapshot; until it resolves, the compile-time defaults apply — the same
 * numbers the policy pages quote, so a slow load can never price a bag at zero.
 * ──────────────────────────────────────────────────────────────────────────── */

let current: PlatformSettings = DEFAULT_SETTINGS;
let inflight: Promise<PlatformSettings> | null = null;
const listeners = new Set<() => void>();

function publish(next: PlatformSettings) {
  current = next;
  listeners.forEach((l) => l());
}

/** The settings in force right now. Never null — defaults until the load lands. */
export function currentSettings(): PlatformSettings {
  return current;
}

/** Load (once) and cache the platform settings. Safe to call repeatedly. */
export function loadSettings(force = false): Promise<PlatformSettings> {
  if (inflight) return inflight;
  if (!force && current !== DEFAULT_SETTINGS) return Promise.resolve(current);
  inflight = fetchSettings()
    .then((s) => { publish(s); return s; })
    .finally(() => { inflight = null; });
  return inflight;
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Re-renders the component when the platform settings land or change. */
export function useSettings(): PlatformSettings {
  return useSyncExternalStore(subscribe, currentSettings, currentSettings);
}
