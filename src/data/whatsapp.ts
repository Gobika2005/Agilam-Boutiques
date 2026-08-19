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

/* ────────────────────────────────────────────────────────────────────────────
 * Message log (migration 0091)
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Read-only, admin-only. Replies are still written in Meta Business Suite —
 * this exists so a conversation can be read next to the order it is about,
 * which Business Suite cannot do because it has no idea what an order number
 * means.
 *
 * NUMBERS ARE MASKED AT THE SOURCE, NOT IN CSS
 * `wa_threads` returns `masked` and a `thread_key` hash; the real number is
 * never in these payloads. `revealMsisdn` is a separate, deliberate call for one
 * number at a time — so an open DevTools panel on the list page shows nothing,
 * and a reveal is a distinct action worth writing to the audit log.
 */

export type WaThread = {
  thread_key: string;
  masked: string;
  profile_name: string | null;
  last_at: string;
  last_body: string;
  last_dir: 'in' | 'out';
  in_count: number;
  out_count: number;
  opted_out: boolean;
};

export type WaMessage = {
  at: string;
  dir: 'in' | 'out';
  body: string | null;
  msg_type: string | null;
  /** Outbound only: 'utility' for a template send, 'service' for an auto-reply. */
  status: string | null;
  delivery: string | null;
  err: string | null;
};

export async function fetchWaThreads(limit = 100): Promise<WaThread[]> {
  const { data, error } = await supabase.rpc('wa_threads', { p_limit: limit });
  if (error || !data) return [];
  return data as WaThread[];
}

export async function fetchWaThreadMessages(key: string, limit = 200): Promise<WaMessage[]> {
  const { data, error } = await supabase.rpc('wa_thread_messages', { p_key: key, p_limit: limit });
  if (error || !data) return [];
  return data as WaMessage[];
}

/** The only path by which a full customer number reaches the browser. */
export async function revealMsisdn(key: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('wa_reveal_msisdn', { p_key: key });
  if (error) return null;
  return (data as string) || null;
}
