/**
 * "Ask my people" — make a shortlist, share it, let the family vote.
 *
 * The behaviour this replaces already exists: a buyer screenshots three sarees,
 * drops them in a family WhatsApp group and asks which one. That decision step
 * happens outside the app, the screenshots are dead images nobody can tap, and
 * the relatives who saw the catalogue never reach it. This sheet turns the same
 * act into a link that leads back to the shop.
 *
 * Two steps, one sheet:
 *
 *   1. PICK — choose from the wishlist (plus whatever piece she opened this
 *      from), name what she's deciding, ask her question.
 *   2. SHARE — the link, straight into WhatsApp with the first piece's photo
 *      attached (see `shareBoard`). The share sheet opens on the same tap as
 *      creation, which is why `create_shortlist_board` returns the token rather
 *      than making us re-read the row.
 *
 * Creating needs a real account — a board is a durable, shareable object that
 * has to belong to someone, and the notifications when votes land have to reach
 * a person. Browsing and voting stay anonymous; only *owning* a board doesn't.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/auth/AuthContext';
import { useShop } from '@/state/ShopContext';
import { useCatalog } from '@/state/CatalogContext';
import { AccountSheet } from '@/components/buyer/AccountSheet';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { Icon } from '@/components/ui/Icon';
import { createBoard, DEFAULT_BOARD_TITLE, MAX_BOARD_ITEMS } from '@/data/shortlists';
import { shareBoard } from '@/lib/share';
import { buildBoardCollage } from '@/lib/boardCollage';
import { TONES, fmt } from '@/data/demo';

export function AskMyPeopleSheet({
  initialProductIds = [],
  onClose,
}: {
  /** Pre-ticked. The PDP passes the piece she's looking at. */
  initialProductIds?: string[];
  onClose: () => void;
}) {
  const showToast = useToast();
  const navigate = useNavigate();
  const { session } = useAuth();
  const { wishlist } = useShop();
  const { products: PRODUCTS } = useCatalog();

  const [picked, setPicked] = useState<string[]>(initialProductIds);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<{ id: string; token: string } | null>(null);
  const [collage, setCollage] = useState<File | null>(null);

  /**
   * What she can choose from: everything saved, plus the piece she opened this
   * from even if it isn't saved — arriving at "Ask my people" from a product
   * and not finding that product in the list would be baffling.
   */
  const choices = useMemo(() => {
    const ids = new Set([...initialProductIds, ...Object.keys(wishlist).filter((id) => wishlist[id])]);
    return PRODUCTS.filter((p) => ids.has(p.id));
  }, [PRODUCTS, wishlist, initialProductIds]);

  // In the order she picked them, which is the order the board stores and the
  // order the collage numbers.
  const pickedProducts = picked
    .map((id) => choices.find((p) => p.id === id))
    .filter((p): p is (typeof choices)[number] => !!p);
  const shareUrl = made ? `${window.location.origin}/shortlist/${made.token}` : '';

  /**
   * Draw the collage the moment the board exists, not when she taps Share.
   *
   * It takes one fetch per piece, and `navigator.share` must be called inside
   * the tap that triggered it — Safari drops the transient user activation
   * across an await and then refuses to open the sheet. By the time she reads
   * the share screen the picture is usually ready; if it isn't, `shareBoard`
   * falls back to the first photo on its own.
   */
  useEffect(() => {
    if (!made) return;
    let live = true;
    void buildBoardCollage(
      pickedProducts.map((p) => p.image),
      title.trim() || 'shortlist',
    ).then((file) => {
      if (live) setCollage(file);
    });
    return () => {
      live = false;
    };
    // Deliberately keyed on the board alone: the pieces are fixed once it is
    // created, and depending on the derived array would redraw on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [made]);

  const toggle = (id: string) => {
    setPicked((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id);
      if (cur.length >= MAX_BOARD_ITEMS) {
        showToast(`You can ask about up to ${MAX_BOARD_ITEMS} pieces`);
        return cur;
      }
      return [...cur, id];
    });
  };

  const submit = async () => {
    if (picked.length === 0) return showToast('Pick at least one piece');
    setBusy(true);
    try {
      const result = await createBoard({
        title: title.trim() || DEFAULT_BOARD_TITLE,
        note: note.trim(),
        productIds: picked,
      });
      setMade(result);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not make that shortlist');
    } finally {
      setBusy(false);
    }
  };

  const doShare = async () => {
    if (!made) return;
    const result = await shareBoard({
      // Deliberately not defaulted — an unnamed board drops the line entirely
      // rather than asking her family the same question twice.
      occasion: title.trim() || undefined,
      url: shareUrl,
      count: picked.length,
      collage,
      image: pickedProducts[0]?.image,
    });
    if (result === 'copied') showToast('Link copied — paste it in your family group');
    if (result === 'failed') showToast('Could not open sharing — copy the link instead');
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      showToast('Link copied');
    } catch {
      showToast('Could not copy — select the link and copy it');
    }
  };

  // Owning a board needs an account. Same sheet the rest of the app uses, so
  // she signs in without losing this one.
  if (!session) {
    return (
      <AccountSheet
        title="Sign in to ask your people"
        subtitle="A shortlist is yours to keep and share — sign in and we'll tell you the moment someone votes."
        onDone={() => showToast('Signed in — now pick your pieces')}
        onClose={onClose}
      />
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Ask my people"
      onClick={onClose}
      style={css('position:fixed;inset:0;z-index:70;background:rgba(20,8,14,.5);display:flex;align-items:flex-end;justify-content:center;')}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="agx-scroll"
        style={css('width:100%;max-width:520px;max-height:88vh;overflow-y:auto;background:var(--ag-surface);border-radius:24px 24px 0 0;padding:22px 20px 28px;animation:agx-sheet .3s ease;')}
      >
        {made ? (
          /* ── Step 2: share it ───────────────────────────────────────── */
          <>
            <div style={css('display:flex;justify-content:center;')}>
              <span style={css('width:56px;height:56px;border-radius:50%;background:var(--ag-good-bg);display:flex;align-items:center;justify-content:center;')}>
                <Icon name="groups" style={{ fontSize: 30, color: 'var(--ag-good)' }} />
              </span>
            </div>
            <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:21px;text-align:center;margin-top:12px;")}>
              Ready to ask
            </div>
            <div style={css('font-size:13px;color:var(--ag-muted);margin-top:6px;line-height:1.55;text-align:center;')}>
              Send this to your family group. They can vote straight away — no app, no sign-up.
            </div>

            <div style={css('display:flex;align-items:center;gap:8px;margin-top:18px;padding:11px 13px;border:1.5px solid var(--ag-border);border-radius:13px;background:var(--ag-bg);')}>
              <Icon name="link" style={{ fontSize: 18, color: 'var(--ag-crimson)' }} />
              <span style={css('flex:1;min-width:0;font-size:12.5px;color:var(--ag-label);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;')}>
                {shareUrl}
              </span>
              <button
                type="button"
                onClick={() => void copyLink()}
                aria-label="Copy link"
                style={css('flex:none;border:none;background:none;cursor:pointer;color:var(--ag-crimson);display:flex;padding:2px;')}
              >
                <Icon name="content_copy" style={{ fontSize: 19 }} />
              </button>
            </div>

            <button
              type="button"
              onClick={() => void doShare()}
              style={css('width:100%;height:50px;margin-top:12px;border:none;border-radius:14px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;font-size:14px;cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:8px;')}
            >
              <Icon name="share" style={{ fontSize: 19 }} />
              Share with my people
            </button>
            <button
              type="button"
              onClick={() => {
                onClose();
                navigate(`/shortlists/${made.id}`);
              }}
              style={css('width:100%;height:46px;margin-top:9px;border:1.5px solid var(--ag-border);background:var(--ag-surface);border-radius:14px;font-weight:700;font-size:13.5px;color:var(--ag-label);cursor:pointer;font-family:inherit;')}
            >
              See the votes as they come in
            </button>
          </>
        ) : (
          /* ── Step 1: pick and name ──────────────────────────────────── */
          <>
            <div style={css('display:flex;align-items:center;gap:9px;')}>
              <Icon name="groups" style={{ fontSize: 24, color: 'var(--ag-crimson)' }} />
              <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:21px;")}>Ask my people</div>
            </div>
            <div style={css('font-size:13px;color:var(--ag-muted);margin-top:5px;line-height:1.5;')}>
              Pick what you're torn between. Your family votes on a link — they don't need an account.
            </div>

            {choices.length === 0 ? (
              <div style={css('text-align:center;padding:34px 16px;')}>
                <Icon name="favorite" style={{ fontSize: 34, color: 'var(--ag-border)' }} />
                <div style={css('font-size:14px;font-weight:700;color:var(--ag-ink);margin-top:10px;')}>
                  Nothing saved yet
                </div>
                <div style={css('font-size:12.5px;color:var(--ag-muted);margin-top:6px;line-height:1.5;')}>
                  Tap the heart on the pieces you're considering, then come back and ask.
                </div>
              </div>
            ) : (
              <>
                <div style={css('display:flex;align-items:baseline;justify-content:space-between;margin-top:18px;')}>
                  <div style={css('font-size:13px;font-weight:700;color:var(--ag-label);')}>Which pieces?</div>
                  <div style={css('font-size:11.5px;font-weight:700;color:var(--ag-muted);')}>
                    {picked.length} chosen
                  </div>
                </div>

                <div style={css('display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:10px;margin-top:10px;')}>
                  {choices.map((p) => {
                    const on = picked.includes(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => toggle(p.id)}
                        aria-pressed={on}
                        style={css(
                          `position:relative;padding:0;border-radius:13px;overflow:hidden;cursor:pointer;font-family:inherit;text-align:left;background:${TONES[p.tone]};` +
                            `border:2.5px solid ${on ? 'var(--ag-crimson)' : 'transparent'};`,
                        )}
                      >
                        <div style={css('position:relative;aspect-ratio:3/4;')}>
                          <ImageSlot src={p.image} placeholder={p.title} className="agx-prod-fill" />
                          {on && (
                            <span style={css('position:absolute;top:5px;right:5px;width:21px;height:21px;border-radius:50%;background:var(--ag-crimson);color:#fff;display:flex;align-items:center;justify-content:center;')}>
                              <Icon name="done" style={{ fontSize: 14 }} />
                            </span>
                          )}
                        </div>
                        <div style={css('padding:6px 7px 8px;background:var(--ag-surface);')}>
                          <div className="agx-card-title" style={css('font-size:11.5px;font-weight:700;color:var(--ag-ink);')}>{p.title}</div>
                          <div style={css('font-size:12px;font-weight:800;color:var(--ag-crimson);margin-top:1px;')}>{fmt(p.price)}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>

                <label style={css('display:block;margin-top:18px;font-size:13px;font-weight:700;color:var(--ag-label);')}>
                  What's the occasion?
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value.slice(0, 80))}
                    placeholder="Divya's wedding"
                    style={css('display:block;width:100%;box-sizing:border-box;margin-top:7px;padding:11px 13px;border:1.5px solid var(--ag-border);border-radius:13px;background:var(--ag-bg);color:var(--ag-ink);font-family:inherit;font-size:14px;')}
                  />
                </label>

                <label style={css('display:block;margin-top:14px;font-size:13px;font-weight:700;color:var(--ag-label);')}>
                  Anything you want to ask them?
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value.slice(0, 300))}
                    rows={2}
                    placeholder="Reception is in the morning — which colour works?"
                    style={css('display:block;width:100%;box-sizing:border-box;margin-top:7px;padding:11px 13px;border:1.5px solid var(--ag-border);border-radius:13px;background:var(--ag-bg);color:var(--ag-ink);font-family:inherit;font-size:14px;resize:vertical;')}
                  />
                </label>
              </>
            )}

            <div style={css('display:flex;gap:10px;margin-top:20px;')}>
              <button
                type="button"
                onClick={onClose}
                style={css('flex:1;height:50px;border:1.5px solid var(--ag-border);background:var(--ag-surface);border-radius:14px;font-weight:700;font-size:14px;color:var(--ag-label);cursor:pointer;font-family:inherit;')}
              >
                Not now
              </button>
              <button
                type="button"
                disabled={busy || picked.length === 0}
                onClick={() => void submit()}
                style={css(`flex:2;height:50px;border:none;border-radius:14px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;font-size:14px;cursor:pointer;font-family:inherit;opacity:${busy || picked.length === 0 ? 0.6 : 1};`)}
              >
                {busy ? 'Just a moment…' : 'Ask them'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
