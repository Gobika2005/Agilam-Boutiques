import { supabase } from '@/lib/supabase';

/**
 * Return requests (migration 0074).
 *
 * Both writes go through SECURITY DEFINER functions rather than a table write:
 * `return_requests` has RLS on and NO insert/update policy at all, so a direct
 * write from the browser is denied by design. The functions re-derive the
 * boutique from the order, re-check ownership, and enforce the return window
 * server-side — none of which a client-side check could be trusted to do.
 *
 * The window rule they enforce, because the UI has to explain it:
 *   • damaged / defective / wrong_item / not_as_described — a FAULT claim.
 *     Accepted regardless of `platform_settings.return_window_days`, up to a
 *     hard 30 days from delivery.
 *   • size_issue / changed_mind — GOODWILL. Gated on the admin's window, and
 *     refused outright when that window is 0.
 */

export type ReturnReason =
  | 'damaged'
  | 'defective'
  | 'wrong_item'
  | 'not_as_described'
  | 'size_issue'
  | 'changed_mind';

export type ReturnStatus = 'requested' | 'approved' | 'rejected' | 'refunded';

export interface ReturnRequest {
  id: string;
  order_id: string;
  boutique_id: string;
  buyer_id: string;
  reason: ReturnReason;
  note: string;
  photos: string[];
  status: ReturnStatus;
  seller_note: string | null;
  created_at: string;
  resolved_at: string | null;
}

/** Which reasons are a fault claim, and so exempt from the goodwill window. */
export const FAULT_REASONS: ReturnReason[] = ['damaged', 'defective', 'wrong_item', 'not_as_described'];

export function isFaultReason(r: ReturnReason): boolean {
  return FAULT_REASONS.includes(r);
}

/** Buyer-facing labels. Kept here so the buyer sheet and the seller queue agree. */
export const RETURN_REASON_LABEL: Record<ReturnReason, string> = {
  damaged: 'Arrived damaged',
  defective: 'Faulty or defective',
  wrong_item: 'Wrong item sent',
  not_as_described: 'Not as described',
  size_issue: 'Size doesn’t fit',
  changed_mind: 'Changed my mind',
};

export const RETURN_STATUS_LABEL: Record<ReturnStatus, string> = {
  requested: 'Awaiting the boutique',
  approved: 'Return approved',
  rejected: 'Not accepted',
  refunded: 'Refunded',
};

const COLUMNS =
  'id, order_id, boutique_id, buyer_id, reason, note, photos, status, seller_note, created_at, resolved_at';

/**
 * A missing table means 0074 has not been applied. Every read below treats that
 * as "no requests" rather than an error, so a console screen still renders on a
 * deployment that is one migration behind.
 */
function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === 'PGRST205' || /return_requests/.test(error.message ?? '');
}

/** The return request on one order, if there is one. */
export async function fetchReturnForOrder(orderId: string): Promise<ReturnRequest | null> {
  const { data, error } = await supabase
    .from('return_requests')
    .select(COLUMNS)
    .eq('order_id', orderId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error)) return null;
    throw error;
  }
  return (data as unknown as ReturnRequest) ?? null;
}

/** Every return request for a boutique — the seller's queue. */
export async function fetchReturnsForBoutique(boutiqueId: string): Promise<ReturnRequest[]> {
  const { data, error } = await supabase
    .from('return_requests')
    .select(COLUMNS)
    .eq('boutique_id', boutiqueId)
    .order('created_at', { ascending: false });
  if (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }
  return (data ?? []) as unknown as ReturnRequest[];
}

/**
 * Raise a return. Rejects with the server's own message — those strings are
 * written to be shown to the buyer verbatim ("The 7-day return window for this
 * order has closed"), so surfacing them beats a generic failure.
 */
export async function requestReturn(input: {
  orderId: string;
  reason: ReturnReason;
  note?: string;
  photos?: string[];
}): Promise<string> {
  const { data, error } = await supabase.rpc('request_return', {
    p_order_id: input.orderId,
    p_reason: input.reason,
    p_note: input.note ?? '',
    p_photos: input.photos ?? [],
  });
  if (error) {
    if (isMissingTable(error)) {
      throw new Error('Returns are not enabled yet — apply migration 0074.');
    }
    throw new Error(error.message || 'Could not raise this return.');
  }
  return data as string;
}

/** Seller/admin answer. `note` is required to reject. */
export async function resolveReturnRequest(
  requestId: string,
  status: 'approved' | 'rejected',
  note?: string,
): Promise<void> {
  const { error } = await supabase.rpc('resolve_return_request', {
    p_request_id: requestId,
    p_status: status,
    p_note: note ?? null,
  });
  if (error) throw new Error(error.message || 'Could not save that decision.');
}
