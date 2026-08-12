/**
 * The shared shortlist — what a relative sees when they open the link.
 *
 * This page is the whole point of the feature, and it has one hard rule: the
 * person opening it has NO account and must never be asked for one. They type a
 * first name, tap ❤️ or 👎, optionally leave a line, and that's it. Everything
 * they do goes through the token-scoped RPCs in 0077, so the page works
 * identically for a signed-out visitor and for the buyer herself.
 *
 * It sits inside `BuyerLayout` on purpose. A relative who came to judge four
 * sarees is a shopper standing in the shop: every piece links to its real
 * product page, and the header and nav around them are the storefront's. That
 * is the acquisition half of the feature — four warm visitors per shortlist,
 * introduced by someone they trust rather than by an ad.
 *
 * `noindex`, always: these links are private family conversations. See also the
 * `/shortlist` prefix in middleware.js, which sets `x-robots-tag` for crawlers
 * that never parse the head.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { css } from '@/lib/css';
import { usePageMeta } from '@/lib/pageMeta';
import { routes } from '@/lib/seo';
import { Icon } from '@/components/ui/Icon';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { useToast } from '@/components/ui/Toast';
import { TONES, fmt } from '@/data/demo';
import {
  fetchSharedBoard,
  castVote,
  postComment,
  tallyVotes,
  familyFavourite,
  type SharedBoard as SharedBoardData,
  type SharedItem,
  type Verdict,
} from '@/data/shortlists';
import { voterKey, voterName, rememberVoterName } from '@/lib/voterIdentity';

export function SharedBoard() {
  const { token = '' } = useParams();
  const showToast = useToast();
  const me = useMemo(() => voterKey(), []);

  const [data, setData] = useState<SharedBoardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState(() => voterName());
  const [busyItem, setBusyItem] = useState<string | null>(null);
  const [openNote, setOpenNote] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [posting, setPosting] = useState(false);
  const nameRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await fetchSharedBoard(token));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'This shortlist link is not valid.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const board = data?.board;
  // Memoised rather than defaulted inline: `data?.items ?? []` is a new array
  // identity on every render, which would re-run the tally and the favourite on
  // every keystroke in the comment box.
  const items = useMemo(() => data?.items ?? [], [data]);
  const votes = useMemo(() => data?.votes ?? [], [data]);
  const tally = useMemo(() => tallyVotes(votes), [votes]);
  const favourite = useMemo(() => familyFavourite(items, votes), [items, votes]);
  const myVotes = useMemo(() => {
    const out: Record<string, Verdict> = {};
    for (const v of votes) if (v.voter_key === me) out[v.item_id] = v.verdict;
    return out;
  }, [votes, me]);

  const owner = board?.owner_name;
  const closed = board?.status === 'closed';
  const decided = items.find((i) => i.product_id === board?.decided_product_id) ?? null;

  usePageMeta({
    title: board ? `Help ${owner ?? 'pick'} choose` : 'Shortlist',
    description: 'A shortlist shared with you on MangaiMart.',
    noindex: true,
  });

  /** Every vote needs a name attached, or the tally is meaningless to her. */
  const requireName = (): string | null => {
    const clean = name.trim();
    if (!clean) {
      showToast('Add your name first so she knows who voted');
      nameRef.current?.focus();
      nameRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return null;
    }
    rememberVoterName(clean);
    return clean;
  };

  const vote = async (item: SharedItem, verdict: Verdict, note = '') => {
    const who = requireName();
    if (!who) return;
    setBusyItem(item.id);
    try {
      await castVote({ token, itemId: item.id, voterKey: me, voterName: who, verdict, note });
      // Re-read rather than patching locally: other people are voting at the
      // same time, and the tally beside her vote should reflect them.
      await load();
      setOpenNote(null);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not save that vote');
    } finally {
      setBusyItem(null);
    }
  };

  const send = async () => {
    const who = requireName();
    if (!who || !comment.trim()) return;
    setPosting(true);
    try {
      await postComment({ token, voterKey: me, voterName: who, body: comment.trim() });
      setComment('');
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not post that');
    } finally {
      setPosting(false);
    }
  };

  if (loading) {
    return (
      <div style={css('padding:60px 20px;text-align:center;color:var(--ag-muted);font-size:14px;')}>
        Opening the shortlist…
      </div>
    );
  }

  if (error || !board) {
    return (
      <div style={css('display:flex;flex-direction:column;align-items:center;text-align:center;padding:70px 26px;')}>
        <Icon name="link_off" style={{ fontSize: 42, color: 'var(--ag-border)' }} />
        <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:24px;margin-top:16px;")}>
          {error ?? 'Shortlist not found'}
        </div>
        <div style={css('color:var(--ag-muted);font-size:14px;margin-top:8px;max-width:340px;line-height:1.55;')}>
          Ask for a fresh link, or have a browse while you're here.
        </div>
        <Link
          to="/"
          style={css('margin-top:20px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;text-decoration:none;border-radius:14px;padding:13px 24px;font-weight:800;font-size:14px;')}
        >
          Browse boutiques
        </Link>
      </div>
    );
  }

  const voterCount = new Set(votes.map((v) => v.voter_key)).size;

  return (
    <div style={css('min-height:100%;background:var(--ag-bg);padding-bottom:30px;')}>
      {/* ── Who's asking, and what for ─────────────────────────────────── */}
      <div style={css('text-align:center;padding:14px 0 4px;')}>
        <div className="agx-eyebrow" style={css('font-size:10.5px;color:var(--ag-crimson);')}>
          {owner ? `${owner} needs your help` : 'Help them pick'}
        </div>
        <h1 style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:clamp(25px,3vw,38px);line-height:1.15;margin:7px 0 0;")}>
          {board.title}
        </h1>
        {board.note && (
          <p style={css('color:var(--ag-muted);font-size:14.5px;margin:9px auto 0;max-width:420px;line-height:1.55;')}>
            “{board.note}”
          </p>
        )}
        <div style={css('display:flex;align-items:center;justify-content:center;gap:6px;margin-top:11px;font-size:12px;font-weight:700;color:var(--ag-muted);')}>
          <Icon name="groups" style={{ fontSize: 16, color: 'var(--ag-crimson)' }} />
          {voterCount === 0
            ? 'Be the first to vote'
            : `${voterCount} ${voterCount === 1 ? 'person has' : 'people have'} voted`}
        </div>
      </div>

      {/* ── The result, once she's chosen ──────────────────────────────── */}
      {closed && (
        <div style={css('margin-top:16px;padding:14px 16px;border-radius:16px;background:var(--ag-good-bg);display:flex;align-items:center;gap:11px;')}>
          <Icon name="celebration" style={{ fontSize: 24, color: 'var(--ag-good)' }} />
          <div style={css('flex:1;min-width:0;')}>
            <div style={css('font-size:13.5px;font-weight:800;color:var(--ag-good-text);')}>
              {decided ? `${owner ?? 'She'} went with ${decided.title}` : 'The votes are in'}
            </div>
            <div style={css('font-size:12px;color:var(--ag-good-text);opacity:.85;margin-top:2px;')}>
              Thank you for helping choose. Voting is closed.
            </div>
          </div>
        </div>
      )}

      {/* ── Your name ──────────────────────────────────────────────────── */}
      {!closed && (
        <div style={css('margin-top:16px;padding:13px 15px;border:1.5px solid var(--ag-border);border-radius:16px;background:var(--ag-surface);')}>
          <label style={css('display:block;font-size:12.5px;font-weight:700;color:var(--ag-label);')}>
            Your name
            <input
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 40))}
              onBlur={() => name.trim() && rememberVoterName(name)}
              placeholder="Amma, Divya, Chithi…"
              style={css('display:block;width:100%;box-sizing:border-box;margin-top:6px;padding:11px 13px;border:1.5px solid var(--ag-border);border-radius:12px;background:var(--ag-bg);color:var(--ag-ink);font-family:inherit;font-size:14px;')}
            />
          </label>
          <div style={css('font-size:11.5px;color:var(--ag-muted);margin-top:7px;line-height:1.45;')}>
            That's all we need — no account, no password. Your name is only shown to {owner ?? 'her'}.
          </div>
        </div>
      )}

      {/* ── The pieces ─────────────────────────────────────────────────── */}
      <div style={css('display:flex;flex-direction:column;gap:14px;margin-top:18px;')}>
        {items.map((item) => {
          const t = tally[item.id] ?? { love: 0, no: 0, notes: [] };
          const mine = myVotes[item.id];
          const isFav = favourite === item.id;
          const isPicked = decided?.id === item.id;

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
                  {isPicked ? 'Her choice' : 'Family favourite'}
                </div>
              )}

              <div style={css('display:flex;gap:13px;padding:13px;')}>
                {/* The piece links to its real product page — this is a shop,
                    not a poll, and half these visitors have never seen it. */}
                <Link
                  to={routes.product({ id: item.product_id, title: item.title, slug: item.slug })}
                  aria-label={item.title}
                  style={css(`flex:none;width:96px;border-radius:13px;overflow:hidden;background:${TONES[item.tone] ?? TONES[0]};position:relative;aspect-ratio:3/4;display:block;`)}
                >
                  <ImageSlot src={item.image_url ?? ''} placeholder={item.title} className="agx-prod-fill" />
                </Link>

                <div style={css('flex:1;min-width:0;display:flex;flex-direction:column;')}>
                  <Link
                    to={routes.product({ id: item.product_id, title: item.title, slug: item.slug })}
                    style={css('text-decoration:none;color:inherit;')}
                  >
                    <div className="agx-card-title" style={css('font-size:14.5px;font-weight:700;color:var(--ag-ink);')}>
                      {item.title}
                    </div>
                    <div style={css('font-size:11.5px;color:var(--ag-muted);margin-top:2px;')}>{item.boutique_name}</div>
                    <div style={css("font-family:'Playfair Display',serif;font-weight:700;color:var(--ag-crimson);font-size:18px;margin-top:4px;")}>
                      {fmt(Number(item.price))}
                    </div>
                  </Link>

                  {!item.available && (
                    <div style={css('font-size:11.5px;font-weight:700;color:var(--ag-warn-text);margin-top:5px;')}>
                      No longer available
                    </div>
                  )}

                  {/* Counts. Shown even at zero so the row's shape doesn't jump
                      the moment the first vote lands. */}
                  <div style={css('display:flex;align-items:center;gap:13px;margin-top:8px;font-size:12.5px;font-weight:800;color:var(--ag-label);')}>
                    <span style={css('display:flex;align-items:center;gap:4px;')}>
                      <Icon name="favorite" style={{ fontSize: 16, color: 'var(--ag-crimson)' }} />
                      {t.love}
                    </span>
                    <span style={css('display:flex;align-items:center;gap:4px;opacity:.75;')}>
                      <Icon name="thumb_down" style={{ fontSize: 15, color: 'var(--ag-muted)' }} />
                      {t.no}
                    </span>
                  </div>

                  {!closed && (
                    <div style={css('display:flex;gap:8px;margin-top:10px;')}>
                      <button
                        type="button"
                        disabled={busyItem === item.id}
                        onClick={() => void vote(item, 'love')}
                        style={css(
                          `flex:1;height:40px;border-radius:12px;font-family:inherit;font-weight:800;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:5px;` +
                            (mine === 'love'
                              ? 'border:none;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;'
                              : 'border:1.5px solid var(--ag-border);background:var(--ag-surface);color:var(--ag-label);'),
                        )}
                      >
                        <Icon name="favorite" style={{ fontSize: 17 }} />
                        {mine === 'love' ? 'Loved' : 'Love it'}
                      </button>
                      <button
                        type="button"
                        disabled={busyItem === item.id}
                        onClick={() => void vote(item, 'no')}
                        style={css(
                          `flex:1;height:40px;border-radius:12px;font-family:inherit;font-weight:800;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:5px;` +
                            (mine === 'no'
                              ? 'border:none;background:var(--ag-ink);color:var(--ag-surface);'
                              : 'border:1.5px solid var(--ag-border);background:var(--ag-surface);color:var(--ag-label);'),
                        )}
                      >
                        <Icon name="thumb_down" style={{ fontSize: 16 }} />
                        {mine === 'no' ? 'Not this' : 'Not this'}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* ── Why. The single most useful field on the page: "the green
                  one — the blouse suits you" is what she actually reads. ── */}
              {!closed && (
                <div style={css('padding:0 13px 13px;')}>
                  {openNote === item.id ? (
                    <NoteBox
                      busy={busyItem === item.id}
                      onCancel={() => setOpenNote(null)}
                      onSend={(text) => void vote(item, mine ?? 'love', text)}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setOpenNote(item.id)}
                      style={css('display:flex;align-items:center;gap:6px;border:none;background:none;padding:0;cursor:pointer;font-family:inherit;font-size:12.5px;font-weight:700;color:var(--ag-crimson);')}
                    >
                      <Icon name="chat_bubble" style={{ fontSize: 15 }} />
                      Say why
                    </button>
                  )}
                </div>
              )}

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
        <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:19px;")}>What everyone's saying</div>

        <div style={css('display:flex;flex-direction:column;gap:9px;margin-top:12px;')}>
          {(data?.comments ?? []).length === 0 && (
            <div style={css('font-size:13px;color:var(--ag-muted);line-height:1.5;')}>
              Nothing yet. Tell {owner ?? 'her'} what you think — a line is plenty.
            </div>
          )}
          {(data?.comments ?? []).map((c) => (
            <div
              key={c.id}
              style={css(
                `border-radius:14px;padding:10px 13px;font-size:13px;line-height:1.5;` +
                  (c.is_owner
                    ? 'background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;align-self:flex-end;max-width:88%;'
                    : 'background:var(--ag-surface);border:1px solid var(--ag-border);color:var(--ag-ink);max-width:88%;'),
              )}
            >
              <div style={css(`font-size:11.5px;font-weight:800;${c.is_owner ? 'opacity:.9;' : 'color:var(--ag-crimson);'}`)}>
                {c.voter_name}
                {c.is_owner ? ' · asking' : ''}
              </div>
              <div style={css('margin-top:2px;')}>{c.body}</div>
            </div>
          ))}
        </div>

        {!closed && (
          <div style={css('display:flex;gap:8px;margin-top:12px;')}>
            <input
              value={comment}
              onChange={(e) => setComment(e.target.value.slice(0, 500))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && comment.trim()) void send();
              }}
              placeholder="Add a note for everyone…"
              style={css('flex:1;min-width:0;padding:12px 14px;border:1.5px solid var(--ag-border);border-radius:14px;background:var(--ag-surface);color:var(--ag-ink);font-family:inherit;font-size:14px;')}
            />
            <button
              type="button"
              disabled={posting || !comment.trim()}
              onClick={() => void send()}
              aria-label="Post note"
              style={css(`flex:none;width:50px;border:none;border-radius:14px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;opacity:${posting || !comment.trim() ? 0.6 : 1};`)}
            >
              <Icon name="send" style={{ fontSize: 19 }} />
            </button>
          </div>
        )}
      </div>

      {/* ── The invitation. They came to judge four sarees; they're standing
          in the shop. ─────────────────────────────────────────────────── */}
      <div style={css('margin-top:26px;padding:18px;border-radius:18px;background:var(--ag-surface);border:1.5px solid var(--ag-border);text-align:center;')}>
        <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:18px;")}>
          Found something you like?
        </div>
        <div style={css('font-size:13px;color:var(--ag-muted);margin-top:6px;line-height:1.55;')}>
          Every piece here is from a verified independent boutique. Have a look around while you're here.
        </div>
        <Link
          to="/"
          style={css('display:inline-block;margin-top:13px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;text-decoration:none;border-radius:13px;padding:12px 22px;font-weight:800;font-size:13.5px;')}
        >
          Browse the collections
        </Link>
      </div>
    </div>
  );
}

/**
 * The "say why" box.
 *
 * Sending a note IS a vote — it carries a verdict, defaulting to whatever they
 * already chose (or ❤️ if they've only written). Making someone tap a heart and
 * then separately tap send would lose most of the notes, which are the part
 * that makes the board worth opening twice.
 */
function NoteBox({
  busy,
  onSend,
  onCancel,
}: {
  busy: boolean;
  onSend: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState('');
  return (
    <div>
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, 300))}
        rows={2}
        placeholder="The green one — the blouse suits you."
        style={css('display:block;width:100%;box-sizing:border-box;padding:10px 12px;border:1.5px solid var(--ag-border);border-radius:12px;background:var(--ag-bg);color:var(--ag-ink);font-family:inherit;font-size:13.5px;resize:vertical;')}
      />
      <div style={css('display:flex;gap:8px;margin-top:8px;')}>
        <button
          type="button"
          onClick={onCancel}
          style={css('flex:1;height:38px;border:1.5px solid var(--ag-border);background:var(--ag-surface);border-radius:11px;font-weight:700;font-size:12.5px;color:var(--ag-label);cursor:pointer;font-family:inherit;')}
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={busy || !text.trim()}
          onClick={() => onSend(text.trim())}
          style={css(`flex:1;height:38px;border:none;border-radius:11px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;font-size:12.5px;cursor:pointer;font-family:inherit;opacity:${busy || !text.trim() ? 0.6 : 1};`)}
        >
          {busy ? 'Sending…' : 'Send'}
        </button>
      </div>
    </div>
  );
}
