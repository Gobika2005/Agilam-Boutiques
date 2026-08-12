import { supabase } from '@/lib/supabase';

/**
 * "Ask my people" — shareable shortlist boards (migration 0077).
 *
 * Two very different callers read through this file:
 *
 *   • The OWNER, signed in. Reads her boards straight through PostgREST — the
 *     select policies in 0077 scope every row to `buyer_id = auth.uid()`.
 *   • A RELATIVE, anonymous, holding the link. Reads and writes ONLY through
 *     `get_shared_board` / `cast_board_vote` / `post_board_comment`, which take
 *     the token as their first argument. The tables have no anon grant at all,
 *     so the token is the credential and nothing else will do.
 *
 * Every write is a SECURITY DEFINER function for the reason 0072 taught: a
 * column-blind update policy on a row you own lets you write columns the
 * feature never meant you to touch — here, `token` and `buyer_id`.
 */

export type BoardStatus = 'open' | 'closed';
export type Verdict = 'love' | 'no';

/** A board as its owner sees it, with the pieces and the votes cast so far. */
export interface Board {
  id: string;
  title: string;
  note: string;
  token: string;
  status: BoardStatus;
  decided_product_id: string | null;
  created_at: string;
  expires_at: string;
  items: BoardItem[];
  votes: BoardVote[];
}

export interface BoardItem {
  id: string;
  product_id: string;
  position: number;
  /** Present on the owner's read (a PostgREST join); absent is not an error. */
  product?: {
    id: string;
    title: string;
    price: number;
    image_url: string | null;
    slug: string | null;
    tone: number;
  } | null;
}

export interface BoardVote {
  item_id: string;
  voter_key: string;
  voter_name: string;
  verdict: Verdict;
  note: string;
  created_at: string;
}

export interface BoardComment {
  id: string;
  voter_key: string;
  voter_name: string;
  is_owner: boolean;
  body: string;
  created_at: string;
}

/** The public board — exactly what `get_shared_board` returns, nothing more. */
export interface SharedBoard {
  board: {
    id: string;
    title: string;
    note: string;
    status: BoardStatus;
    /** First name only. The RPC never returns the owner's id, email or phone. */
    owner_name: string | null;
    decided_product_id: string | null;
    created_at: string;
    expires_at: string;
  };
  items: SharedItem[];
  votes: BoardVote[];
  comments: BoardComment[];
}

export interface SharedItem {
  id: string;
  product_id: string;
  position: number;
  title: string;
  price: number;
  mrp: number | null;
  image_url: string | null;
  slug: string | null;
  tone: number;
  boutique_name: string;
  /** False once the boutique hides, deletes or sells out the piece. */
  available: boolean;
}

/** Caps enforced server-side; mirrored here only so the UI can say so first. */
export const MAX_BOARD_ITEMS = 30;

/**
 * A missing table means 0077 has not been applied. Reads treat that as "no
 * boards" so a screen still renders on a deployment one migration behind;
 * writes turn it into a sentence naming the migration.
 */
function isMissing(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === 'PGRST205' ||
    error.code === 'PGRST202' ||
    /shortlist_boards|shortlist_items|shortlist_votes|shortlist_comments|get_shared_board|create_shortlist_board/.test(
      error.message ?? '',
    )
  );
}

const NOT_APPLIED = 'Shortlists are not enabled yet — apply migration 0077.';

// ── The owner's side ────────────────────────────────────────────────────────

const BOARD_COLUMNS = `
  id, title, note, token, status, decided_product_id, created_at, expires_at,
  items:shortlist_items(
    id, product_id, position,
    product:products(id, title, price, image_url, slug, tone)
  ),
  votes:shortlist_votes(item_id, voter_key, voter_name, verdict, note, created_at)
`;

/** Every board this buyer has made, newest first. */
export async function fetchMyBoards(buyerId: string): Promise<Board[]> {
  const { data, error } = await supabase
    .from('shortlist_boards')
    .select(BOARD_COLUMNS)
    .eq('buyer_id', buyerId)
    .order('created_at', { ascending: false });
  if (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  return ((data ?? []) as unknown as Board[]).map((b) => ({
    ...b,
    items: [...(b.items ?? [])].sort((x, y) => x.position - y.position),
    votes: b.votes ?? [],
  }));
}

/** One board by id, for the owner's detail screen. */
export async function fetchBoard(boardId: string): Promise<Board | null> {
  const { data, error } = await supabase
    .from('shortlist_boards')
    .select(BOARD_COLUMNS)
    .eq('id', boardId)
    .maybeSingle();
  if (error) {
    if (isMissing(error)) return null;
    throw error;
  }
  if (!data) return null;
  const b = data as unknown as Board;
  return { ...b, items: [...(b.items ?? [])].sort((x, y) => x.position - y.position), votes: b.votes ?? [] };
}

/** The comment thread on a board the caller owns. */
export async function fetchBoardComments(boardId: string): Promise<BoardComment[]> {
  const { data, error } = await supabase
    .from('shortlist_comments')
    .select('id, voter_key, voter_name, profile_id, body, created_at')
    .eq('board_id', boardId)
    .order('created_at', { ascending: true });
  if (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  // `is_owner` is derived in the RPC for the public view; on the owner's own
  // read it is simply "did I write this".
  return ((data ?? []) as unknown as (BoardComment & { profile_id: string | null })[]).map((c) => ({
    id: c.id,
    voter_key: c.voter_key,
    voter_name: c.voter_name,
    is_owner: !!c.profile_id,
    body: c.body,
    created_at: c.created_at,
  }));
}

/** Make a board. Returns its id and share token in one round trip. */
export async function createBoard(input: {
  title: string;
  note?: string;
  productIds: string[];
}): Promise<{ id: string; token: string }> {
  const { data, error } = await supabase.rpc('create_shortlist_board', {
    p_title: input.title,
    p_note: input.note ?? '',
    p_product_ids: input.productIds,
  });
  if (error) {
    if (isMissing(error)) throw new Error(NOT_APPLIED);
    // The server's messages are written to be read by the buyer.
    throw new Error(error.message || 'Could not make that shortlist.');
  }
  return data as { id: string; token: string };
}

export async function updateBoard(
  boardId: string,
  patch: { title?: string; note?: string; status?: BoardStatus },
): Promise<void> {
  const { error } = await supabase.rpc('update_shortlist_board', {
    p_board_id: boardId,
    p_title: patch.title ?? null,
    p_note: patch.note ?? null,
    p_status: patch.status ?? null,
  });
  if (error) throw new Error(error.message || 'Could not save that change.');
}

/** Returns how many were actually added — duplicates and hidden pieces are skipped. */
export async function addBoardItems(boardId: string, productIds: string[]): Promise<number> {
  const { data, error } = await supabase.rpc('add_shortlist_items', {
    p_board_id: boardId,
    p_product_ids: productIds,
  });
  if (error) throw new Error(error.message || 'Could not add those pieces.');
  return Number(data ?? 0);
}

export async function removeBoardItem(itemId: string): Promise<void> {
  const { error } = await supabase.rpc('remove_shortlist_item', { p_item_id: itemId });
  if (error) throw new Error(error.message || 'Could not remove that piece.');
}

/** Mark the winner and close voting, so everyone who helped sees the result. */
export async function decideBoard(boardId: string, productId: string): Promise<void> {
  const { error } = await supabase.rpc('decide_shortlist', {
    p_board_id: boardId,
    p_product_id: productId,
  });
  if (error) throw new Error(error.message || 'Could not save that choice.');
}

export async function deleteBoard(boardId: string): Promise<void> {
  const { error } = await supabase.from('shortlist_boards').delete().eq('id', boardId);
  if (error) throw new Error(error.message || 'Could not delete that shortlist.');
}

// ── The public side (anonymous, token-only) ─────────────────────────────────

/**
 * Read a shared board. Rejects with the server's own wording — "This shortlist
 * link has expired" is a better thing to show a relative than a 400.
 */
export async function fetchSharedBoard(token: string): Promise<SharedBoard> {
  const { data, error } = await supabase.rpc('get_shared_board', { p_token: token });
  if (error) {
    if (isMissing(error)) throw new Error(NOT_APPLIED);
    throw new Error(error.message || 'This shortlist link is not valid.');
  }
  return data as SharedBoard;
}

export async function castVote(input: {
  token: string;
  itemId: string;
  voterKey: string;
  voterName: string;
  verdict: Verdict;
  note?: string;
}): Promise<void> {
  const { error } = await supabase.rpc('cast_board_vote', {
    p_token: input.token,
    p_item_id: input.itemId,
    p_voter_key: input.voterKey,
    p_voter_name: input.voterName,
    p_verdict: input.verdict,
    p_note: input.note ?? '',
  });
  if (error) throw new Error(error.message || 'Could not save that vote.');
}

export async function postComment(input: {
  token: string;
  voterKey: string;
  voterName: string;
  body: string;
}): Promise<void> {
  const { error } = await supabase.rpc('post_board_comment', {
    p_token: input.token,
    p_voter_key: input.voterKey,
    p_voter_name: input.voterName,
    p_body: input.body,
  });
  if (error) throw new Error(error.message || 'Could not post that.');
}

// ── Tally ───────────────────────────────────────────────────────────────────

export interface Tally {
  love: number;
  no: number;
  /** Votes with something written on them — the part she actually reads. */
  notes: { voter_name: string; note: string; verdict: Verdict }[];
}

/** Per-item counts, keyed by item id. Shared by the owner and public screens. */
export function tallyVotes(votes: BoardVote[]): Record<string, Tally> {
  const out: Record<string, Tally> = {};
  for (const v of votes) {
    const t = (out[v.item_id] ??= { love: 0, no: 0, notes: [] });
    if (v.verdict === 'love') t.love += 1;
    else t.no += 1;
    if (v.note.trim()) t.notes.push({ voter_name: v.voter_name, note: v.note, verdict: v.verdict });
  }
  return out;
}

/**
 * The piece with the most hearts — the "family favourite" the board leads with.
 *
 * Ties break on fewest 👎, then on board order, so the winner is stable between
 * renders rather than flipping as votes arrive. Returns null until at least one
 * heart exists: crowning something on zero votes would be a lie.
 */
export function familyFavourite(
  items: { id: string; position: number }[],
  votes: BoardVote[],
): string | null {
  const tally = tallyVotes(votes);
  let best: { id: string; love: number; no: number; position: number } | null = null;
  for (const item of items) {
    const t = tally[item.id];
    if (!t || t.love === 0) continue;
    const row = { id: item.id, love: t.love, no: t.no, position: item.position };
    if (
      !best ||
      row.love > best.love ||
      (row.love === best.love && row.no < best.no) ||
      (row.love === best.love && row.no === best.no && row.position < best.position)
    ) {
      best = row;
    }
  }
  return best?.id ?? null;
}
