/**
 * One shortlist, from the owner's side — the votes as they come in.
 *
 * This is the screen she opens after the notification says "Amma voted on your
 * shortlist", so it leads with what she came for: who said what, and which
 * piece is winning. `useAsync`'s background revalidation means a board left
 * open on screen fills in as her family votes, without a refresh and without a
 * skeleton flashing over what she is reading.
 *
 * The one action that matters at the end is "I'll take this one": it records
 * the decision, closes voting, and — crucially — shows the result to everyone
 * who helped when they open the link again. Leaving them wondering is what
 * makes people ignore the second shortlist.
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { css } from '@/lib/css';
import { usePageMeta } from '@/lib/pageMeta';
import { routes } from '@/lib/seo';
import { useAsync } from '@/hooks/useAsync';
import { useGoBack } from '@/hooks/useGoBack';
import { Icon } from '@/components/ui/Icon';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { useShop } from '@/state/ShopContext';
import { shareBoard } from '@/lib/share';
import { voterKey, voterName, rememberVoterName } from '@/lib/voterIdentity';
import { TONES, fmt } from '@/data/demo';
import {
  fetchBoard,
  fetchBoardComments,
  decideBoard,
  deleteBoard,
  removeBoardItem,
  updateBoard,
  postComment,
  tallyVotes,
  familyFavourite,
} from '@/data/shortlists';

export function ShortlistDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const goBack = useGoBack('/shortlists');
  const showToast = useToast();
  const { addToCart } = useShop();

  const [reply, setReply] = useState('');
  const [posting, setPosting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data: board, loading, reload } = useAsync(() => fetchBoard(id), [id]);
  const { data: comments, reload: reloadComments } = useAsync(() => fetchBoardComments(id), [id]);

  const tally = useMemo(() => tallyVotes(board?.votes ?? []), [board]);
  const favourite = useMemo(
    () => familyFavourite(board?.items ?? [], board?.votes ?? []),
    [board],
  );

  usePageMeta({
    title: board?.title ?? 'Shortlist',
    description: 'Votes on your shortlist.',
    noindex: true,
  });

  if (loading && !board) {
    return <div style={css('padding-top:18px;')}><SkeletonRows rows={4} height={110} /></div>;
  }

  if (!board) {
    return (
      <div style={css('display:flex;flex-direction:column;align-items:center;text-align:center;padding:70px 26px;')}>
        <Icon name="link_off" style={{ fontSize: 40, color: 'var(--ag-border)' }} />
        <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:23px;margin-top:14px;")}>
          Shortlist not found
        </div>
        <Link to="/shortlists" style={css('margin-top:16px;color:var(--ag-crimson);font-weight:800;font-size:14px;text-decoration:none;')}>
          Back to my shortlists
        </Link>
      </div>
    );
  }

  const shareUrl = `${window.location.origin}/shortlist/${board.token}`;
  const voters = new Set(board.votes.map((v) => v.voter_key)).size;
  const closed = board.status === 'closed';
  const expired = new Date(board.expires_at) <= new Date();

  const doShare = async () => {
    const result = await shareBoard({
      title: board.title,
      url: shareUrl,
      count: board.items.length,
      image: board.items[0]?.product?.image_url ?? undefined,
    });
    if (result === 'copied') showToast('Link copied — paste it in your family group');
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      showToast('Link copied');
    } catch {
      showToast('Could not copy the link');
    }
  };

  const decide = async (productId: string, title: string) => {
    try {
      await decideBoard(board.id, productId);
      showToast(`${title} it is — everyone who voted can see`);
      reload();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not save that');
    }
  };

  const remove = async (itemId: string) => {
    try {
      await removeBoardItem(itemId);
      reload();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not remove that piece');
    }
  };

  const reopen = async () => {
    try {
      await updateBoard(board.id, { status: 'open' });
      showToast('Voting is open again');
      reload();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not reopen it');
    }
  };

  const send = async () => {
    const body = reply.trim();
    if (!body) return;
    setPosting(true);
    try {
      // She posts under her own name through the same anonymous-safe RPC; 0077
      // stamps `profile_id` from auth.uid(), never from anything sent here,
      // which is what earns the "asking" badge on her messages.
      const who = voterName() || 'Me';
      rememberVoterName(who);
      await postComment({ token: board.token, voterKey: voterKey(), voterName: who, body });
      setReply('');
      reloadComments();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not post that');
    } finally {
      setPosting(false);
    }
  };

  const destroy = async () => {
    try {
      await deleteBoard(board.id);
      showToast('Shortlist deleted');
      navigate('/shortlists', { replace: true });
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not delete that');
    }
  };

  return (
    <div style={css('min-height:100%;background:var(--ag-bg);padding-bottom:26px;')}>
      <div style={css('display:flex;align-items:center;gap:10px;padding:6px 0 2px;')}>
        <button
          type="button"
          onClick={goBack}
          aria-label="Back"
          style={css('flex:none;width:36px;height:36px;border-radius:11px;border:1.5px solid var(--ag-border);background:var(--ag-surface);cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--ag-ink);')}
        >
          <Icon name="arrow_back" style={{ fontSize: 19 }} />
        </button>
        <div style={css('flex:1;min-width:0;')}>
          <h1 style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:clamp(21px,2.4vw,30px);line-height:1.15;margin:0;")}>
            {board.title}
          </h1>
          <div style={css('font-size:12px;color:var(--ag-muted);margin-top:3px;')}>
            {voters === 0
              ? 'No votes yet'
              : `${voters} ${voters === 1 ? 'person' : 'people'} voted`}
            {closed && ' · decided'}
          </div>
        </div>
      </div>

      {board.note && (
        <div style={css('margin-top:12px;padding:12px 14px;border-radius:14px;background:var(--ag-surface-2);font-size:13.5px;color:var(--ag-ink);line-height:1.5;')}>
          “{board.note}”
        </div>
      )}

      {/* ── Share ──────────────────────────────────────────────────────── */}
      {!closed && !expired && (
        <div style={css('margin-top:14px;padding:13px 14px;border:1.5px solid var(--ag-border);border-radius:16px;background:var(--ag-surface);')}>
          <div style={css('font-size:12.5px;font-weight:800;color:var(--ag-label);')}>
            {voters === 0 ? 'Send this to your people' : 'Ask a few more'}
          </div>
          <div style={css('display:flex;align-items:center;gap:8px;margin-top:9px;')}>
            <div style={css('flex:1;min-width:0;padding:10px 12px;border:1.5px solid var(--ag-border);border-radius:12px;background:var(--ag-bg);font-size:12px;color:var(--ag-label);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;')}>
              {shareUrl}
            </div>
            <button
              type="button"
              onClick={() => void copyLink()}
              aria-label="Copy link"
              style={css('flex:none;width:42px;height:42px;border:1.5px solid var(--ag-border);background:var(--ag-surface);border-radius:12px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--ag-crimson);')}
            >
              <Icon name="content_copy" style={{ fontSize: 18 }} />
            </button>
            <button
              type="button"
              onClick={() => void doShare()}
              aria-label="Share"
              style={css('flex:none;width:42px;height:42px;border:none;background:linear-gradient(135deg,#D6336C,#B02454);border-radius:12px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#fff;')}
            >
              <Icon name="share" style={{ fontSize: 18 }} />
            </button>
          </div>
        </div>
      )}

      {expired && !closed && (
        <div style={css('margin-top:14px;padding:12px 14px;border-radius:14px;background:var(--ag-warn-bg);color:var(--ag-warn-text);font-size:12.5px;font-weight:700;line-height:1.5;')}>
          This link has expired, so nobody new can vote. The votes below are still yours to keep.
        </div>
      )}

      {/* ── The pieces, in vote order ──────────────────────────────────── */}
      <div style={css('display:flex;flex-direction:column;gap:13px;margin-top:18px;')}>
        {board.items.map((item) => {
          const p = item.product;
          const t = tally[item.id] ?? { love: 0, no: 0, notes: [] };
          const isFav = favourite === item.id;
          const isPicked = board.decided_product_id === item.product_id;

          return (
            <div
              key={item.id}
              style={css(
                `border-radius:18px;overflow:hidden;background:var(--ag-surface);` +
                  `border:1.5px solid ${isPicked ? 'var(--ag-good)' : isFav ? 'var(--ag-crimson)' : 'var(--ag-border)'};`,
              )}
            >
              {(isFav || isPicked) && (
                <div
                  style={css(
                    `padding:6px 14px;font-size:11px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:#fff;` +
                      `background:${isPicked ? 'var(--ag-good)' : 'linear-gradient(135deg,#D6336C,#B02454)'};`,
                  )}
                >
                  {isPicked ? 'You chose this' : 'Family favourite'}
                </div>
              )}

              <div style={css('display:flex;gap:13px;padding:13px;')}>
                <Link
                  to={p ? routes.product({ id: p.id, title: p.title, slug: p.slug }) : '/wishlist'}
                  aria-label={p?.title ?? 'Piece'}
                  style={css(`flex:none;width:88px;border-radius:13px;overflow:hidden;background:${TONES[p?.tone ?? 0]};position:relative;aspect-ratio:3/4;display:block;`)}
                >
                  <ImageSlot src={p?.image_url ?? ''} placeholder={p?.title ?? ''} className="agx-prod-fill" />
                </Link>

                <div style={css('flex:1;min-width:0;')}>
                  <div className="agx-card-title" style={css('font-size:14px;font-weight:700;color:var(--ag-ink);')}>
                    {p?.title ?? 'This piece is no longer listed'}
                  </div>
                  {p && (
                    <div style={css("font-family:'Playfair Display',serif;font-weight:700;color:var(--ag-crimson);font-size:17px;margin-top:3px;")}>
                      {fmt(Number(p.price))}
                    </div>
                  )}

                  <div style={css('display:flex;align-items:center;gap:13px;margin-top:7px;font-size:12.5px;font-weight:800;color:var(--ag-label);')}>
                    <span style={css('display:flex;align-items:center;gap:4px;')}>
                      <Icon name="favorite" style={{ fontSize: 16, color: 'var(--ag-crimson)' }} />
                      {t.love}
                    </span>
                    <span style={css('display:flex;align-items:center;gap:4px;opacity:.75;')}>
                      <Icon name="thumb_down" style={{ fontSize: 15, color: 'var(--ag-muted)' }} />
                      {t.no}
                    </span>
                    {!closed && (
                      <button
                        type="button"
                        onClick={() => void remove(item.id)}
                        aria-label="Remove from shortlist"
                        style={css('margin-left:auto;border:none;background:none;cursor:pointer;color:var(--ag-muted);display:flex;padding:2px;')}
                      >
                        <Icon name="close" style={{ fontSize: 17 }} />
                      </button>
                    )}
                  </div>

                  {p && (
                    <div style={css('display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;')}>
                      {!closed && (
                        <button
                          type="button"
                          onClick={() => void decide(item.product_id, p.title)}
                          style={css('flex:1;min-width:130px;height:38px;border:none;border-radius:11px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;font-size:12.5px;cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:5px;')}
                        >
                          <Icon name="check_circle" style={{ fontSize: 16 }} />
                          I'll take this
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          addToCart(p.id);
                          showToast('Added to your bag');
                        }}
                        style={css('flex:1;min-width:110px;height:38px;border:1.5px solid var(--ag-border);background:var(--ag-surface);border-radius:11px;font-weight:800;font-size:12.5px;color:var(--ag-label);cursor:pointer;font-family:inherit;')}
                      >
                        Add to bag
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* What they actually said — the reason she opens this twice. */}
              {t.notes.length > 0 && (
                <div style={css('padding:0 13px 13px;display:flex;flex-direction:column;gap:7px;')}>
                  {t.notes.map((n, i) => (
                    <div
                      key={`${n.voter_name}-${i}`}
                      style={css('background:var(--ag-surface-2);border-radius:12px;padding:9px 11px;font-size:12.5px;color:var(--ag-ink);line-height:1.45;')}
                    >
                      <span style={css('font-weight:800;')}>{n.voter_name}</span>
                      <span style={css('color:var(--ag-muted);')}> · {n.verdict === 'love' ? 'loves it' : 'not this one'}</span>
                      <div style={css('margin-top:2px;')}>{n.note}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── The conversation ───────────────────────────────────────────── */}
      <div style={css('margin-top:24px;')}>
        <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:19px;")}>What everyone said</div>
        <div style={css('display:flex;flex-direction:column;gap:9px;margin-top:12px;')}>
          {(comments ?? []).length === 0 && (
            <div style={css('font-size:13px;color:var(--ag-muted);line-height:1.5;')}>
              No notes yet. They'll show up here as your people reply.
            </div>
          )}
          {(comments ?? []).map((c) => (
            <div
              key={c.id}
              style={css(
                `border-radius:14px;padding:10px 13px;font-size:13px;line-height:1.5;max-width:88%;` +
                  (c.is_owner
                    ? 'background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;align-self:flex-end;'
                    : 'background:var(--ag-surface);border:1px solid var(--ag-border);color:var(--ag-ink);'),
              )}
            >
              <div style={css(`font-size:11.5px;font-weight:800;${c.is_owner ? 'opacity:.9;' : 'color:var(--ag-crimson);'}`)}>
                {c.is_owner ? 'You' : c.voter_name}
              </div>
              <div style={css('margin-top:2px;')}>{c.body}</div>
            </div>
          ))}
        </div>

        {!closed && !expired && (
          <div style={css('display:flex;gap:8px;margin-top:12px;')}>
            <input
              value={reply}
              onChange={(e) => setReply(e.target.value.slice(0, 500))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && reply.trim()) void send();
              }}
              placeholder="Reply to your people…"
              style={css('flex:1;min-width:0;padding:12px 14px;border:1.5px solid var(--ag-border);border-radius:14px;background:var(--ag-surface);color:var(--ag-ink);font-family:inherit;font-size:14px;')}
            />
            <button
              type="button"
              disabled={posting || !reply.trim()}
              onClick={() => void send()}
              aria-label="Send reply"
              style={css(`flex:none;width:50px;border:none;border-radius:14px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;opacity:${posting || !reply.trim() ? 0.6 : 1};`)}
            >
              <Icon name="send" style={{ fontSize: 19 }} />
            </button>
          </div>
        )}
      </div>

      {/* ── Housekeeping ───────────────────────────────────────────────── */}
      <div style={css('margin-top:26px;display:flex;flex-direction:column;gap:9px;')}>
        {closed && (
          <button
            type="button"
            onClick={() => void reopen()}
            style={css('height:44px;border:1.5px solid var(--ag-border);background:var(--ag-surface);border-radius:13px;font-weight:800;font-size:13px;color:var(--ag-label);cursor:pointer;font-family:inherit;')}
          >
            Reopen voting
          </button>
        )}
        {confirmDelete ? (
          <div style={css('display:flex;gap:9px;')}>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              style={css('flex:1;height:44px;border:1.5px solid var(--ag-border);background:var(--ag-surface);border-radius:13px;font-weight:800;font-size:13px;color:var(--ag-label);cursor:pointer;font-family:inherit;')}
            >
              Keep it
            </button>
            <button
              type="button"
              onClick={() => void destroy()}
              style={css('flex:1;height:44px;border:none;background:var(--ag-danger-text);color:#fff;border-radius:13px;font-weight:800;font-size:13px;cursor:pointer;font-family:inherit;')}
            >
              Delete for good
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            style={css('height:44px;border:1.5px solid var(--ag-border);background:var(--ag-surface);border-radius:13px;font-weight:800;font-size:13px;color:var(--ag-danger-text);cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:6px;')}
          >
            <Icon name="delete" style={{ fontSize: 17 }} />
            Delete this shortlist
          </button>
        )}
        <div style={css('font-size:11.5px;color:var(--ag-muted);text-align:center;line-height:1.5;margin-top:2px;')}>
          The link stops working on {new Date(board.expires_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}.
        </div>
      </div>
    </div>
  );
}
