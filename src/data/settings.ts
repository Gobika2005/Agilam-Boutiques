import { supabase } from '@/lib/supabase';
import { POLICY_TERMS, COMPANY } from '@/data/company';

/**
 * Platform settings — the admin-editable commercial knobs (commission, fees,
 * hold window…) added in migration 0048. Falls back to the compile-time
 * defaults in company.ts when the table isn't there yet, so the console renders
 * and degrades gracefully before the migration is applied.
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
  return { ...DEFAULT_SETTINGS, ...(data as Partial<PlatformSettings>) };
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
  return { ok: true };
}
