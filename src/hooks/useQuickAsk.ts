import { useCallback, useRef, useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { createBoard, DEFAULT_BOARD_TITLE, MAX_BOARD_ITEMS } from '@/data/shortlists';
import { buildBoardCollage } from '@/lib/boardCollage';
import { shareBoard } from '@/lib/share';

/**
 * "Ask my people" in a single tap — make the board and open the share sheet,
 * with nothing in between.
 *
 * The full sheet exists because choosing WHICH pieces to ask about sometimes
 * needs a screen. Most of the time it doesn't: she is on one product and torn,
 * or she has three things saved and wants all three. Making those two cases
 * walk through pick → name → confirm → share is three taps of friction at the
 * exact moment she was about to leave and screenshot into WhatsApp instead.
 *
 * ── The one popup that cannot be removed ────────────────────────────────────
 * A board belongs to someone and notifies them when votes land, so it needs a
 * real account. A signed-out buyer therefore still gets the sign-in sheet —
 * `needsSignIn` — and the caller renders it. Browsing and voting stay anonymous;
 * only owning a board doesn't.
 *
 * ── Why the share can still degrade to a copied link ────────────────────────
 * Creating the board is a round trip and drawing the collage is one fetch per
 * piece, so by the time `navigator.share` is reached the browser may have
 * dropped the transient user activation that it requires — Safari is strict
 * about this, Chrome is not. `shareWithImage` already handles that: a refused
 * share falls through to putting the caption and link on the clipboard, so the
 * worst case is a toast telling her to paste it, never a dead button.
 */
export function useQuickAsk() {
  const { session } = useAuth();
  const showToast = useToast();
  const [busy, setBusy] = useState(false);
  const [needsSignIn, setNeedsSignIn] = useState(false);

  /**
   * Boards already made in this session, keyed by the set of pieces.
   *
   * Without it, tapping the button twice — which people do when a share sheet
   * is slow to appear — leaves a second identical board in her list.
   */
  const made = useRef(new Map<string, { id: string; token: string }>());

  const ask = useCallback(
    async (input: {
      /** In the order they should appear on the board and in the collage. */
      productIds: string[];
      /** Cover photos, same order. Used to draw the collage. */
      images: string[];
      /** Optional occasion. A direct ask usually has none. */
      occasion?: string;
    }) => {
      if (!session) {
        setNeedsSignIn(true);
        return;
      }
      const ids = input.productIds.slice(0, MAX_BOARD_ITEMS);
      if (ids.length === 0) {
        showToast('Save a few pieces first');
        return;
      }

      setBusy(true);
      try {
        const key = ids.join(',');
        let board = made.current.get(key);
        if (!board) {
          board = await createBoard({
            title: input.occasion?.trim() || DEFAULT_BOARD_TITLE,
            productIds: ids,
          });
          made.current.set(key, board);
        }

        const url = `${window.location.origin}/shortlist/${board.token}`;
        const collage = await buildBoardCollage(
          input.images.slice(0, ids.length),
          input.occasion || 'shortlist',
        );

        const result = await shareBoard({
          occasion: input.occasion?.trim() || undefined,
          url,
          count: ids.length,
          collage,
          image: input.images[0],
        });

        if (result === 'copied') showToast('Link copied — paste it in your family group');
        else if (result === 'failed') showToast('Could not share — open My shortlists to get the link');
      } catch (e) {
        showToast(e instanceof Error ? e.message : 'Could not make that shortlist');
      } finally {
        setBusy(false);
      }
    },
    [session, showToast],
  );

  return { ask, busy, needsSignIn, closeSignIn: () => setNeedsSignIn(false) };
}
