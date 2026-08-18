import { supabase } from '@/lib/supabase';

/**
 * Operational read-out for the WhatsApp outbox (migration 0090).
 *
 * WHY TWO RPCs AND NOT A SELECT
 * `whatsapp_outbox` and `whatsapp_optout` have RLS enabled with no policies at
 * all, so nothing but the service role can read them — deliberately, because
 * between them they hold every customer's phone number next to what they bought.
 * The admin console does not need that; it needs to know whether the queue is
 * moving and what is failing. `wa_outbox_stats()` and `wa_outbox_failures()` are
 * SECURITY DEFINER, gated on `is_admin()` internally, and the second masks the
 * recipient — enough to recognise a number you already know, not enough to
 * harvest one you do not.
 *
 * Both are granted `to authenticated` only. A grant left at PUBLIC would reach
 * `anon`, which is the mistake that blanked the storefront in 0086.
 */

export type WaStatus = 'queued' | 'sent' | 'failed' | 'suppressed' | 'stale';

export type WaStats = Record<WaStatus, number> & { newest: string | null };

export type WaFailure = {
  id: string;
  template: string;
  audience: 'buyer' | 'seller';
  recipient_masked: string;
  attempts: number;
  last_error: string | null;
  created_at: string;
};

const EMPTY: WaStats = { queued: 0, sent: 0, failed: 0, suppressed: 0, stale: 0, newest: null };

/**
 * Returns zeroes rather than throwing when migration 0090 has not been applied
 * yet, so the Settings page still renders on a database that predates it — the
 * same tolerance fetchSettings() shows for a missing platform_settings row.
 */
export async function fetchWaStats(): Promise<WaStats> {
  const { data, error } = await supabase.rpc('wa_outbox_stats');
  if (error || !data) return { ...EMPTY };

  const out: WaStats = { ...EMPTY };
  // `bucket`/`total`, not `status`/`count` — a RETURNS TABLE column named `count`
  // sitting beside a `count(*)` in the function body is an ambiguity waiting to
  // happen, so 0090 names them out of the way.
  for (const row of data as { bucket: WaStatus; total: number; newest: string | null }[]) {
    if (row.bucket in out) out[row.bucket] = Number(row.total) || 0;
    if (row.newest && (!out.newest || row.newest > out.newest)) out.newest = row.newest;
  }
  return out;
}

export async function fetchWaFailures(limit = 20): Promise<WaFailure[]> {
  const { data, error } = await supabase.rpc('wa_outbox_failures', { p_limit: limit });
  if (error || !data) return [];
  return data as WaFailure[];
}
