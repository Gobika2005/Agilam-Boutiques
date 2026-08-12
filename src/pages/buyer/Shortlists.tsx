/**
 * "My shortlists" — the boards this buyer has asked her people about.
 *
 * The owner's half of the feature. Everything here reads straight through
 * PostgREST rather than an RPC: 0077's select policies already scope every
 * board, item, vote and comment to `buyer_id = auth.uid()`, so a plain nested
 * select is both simpler and exactly as safe. Only the token-holding public
 * page needs a definer function.
 */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
import { usePageMeta } from '@/lib/pageMeta';
import { useAsync } from '@/hooks/useAsync';
import { useAuth } from '@/auth/AuthContext';
import { Icon } from '@/components/ui/Icon';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { AskMyPeopleSheet } from '@/components/buyer/AskMyPeopleSheet';
import { AccountSheet } from '@/components/buyer/AccountSheet';
import { fetchMyBoards, tallyVotes, type Board } from '@/data/shortlists';
import { TONES } from '@/data/demo';

export function Shortlists() {
  usePageMeta({
    title: 'My shortlists',
    description: 'The shortlists you have shared with your people.',
    noindex: true,
  });
  const navigate = useNavigate();
  const { session } = useAuth();
  const buyerId = session?.user?.id ?? null;
  const [asking, setAsking] = useState(false);

  const { data, loading, reload } = useAsync(
    () => (buyerId ? fetchMyBoards(buyerId) : Promise.resolve([])),
    [buyerId],
  );
  const boards = data ?? [];

  if (!buyerId) {
    return (
      <>
        <Empty
          icon="groups"
          title="Ask your people"
          body="Sign in to make a shortlist your family can vote on — they won't need an account."
          cta="Sign in"
          onCta={() => setAsking(true)}
        />
        {asking && <AccountSheet onDone={() => { setAsking(false); reload(); }} onClose={() => setAsking(false)} />}
      </>
    );
  }

  return (
    <div style={css('min-height:100%;background:var(--ag-bg);padding-bottom:20px;')}>
      <div style={css('display:flex;align-items:flex-end;justify-content:space-between;flex-wrap:wrap;gap:12px;padding:4px 0 6px;')}>
        <div>
          <div className="agx-eyebrow" style={css('font-size:10.5px;color:var(--ag-crimson);')}>Decided together</div>
          <h1 style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:clamp(27px,3.2vw,42px);line-height:1.1;padding-bottom:2px;margin:6px 0 0;letter-spacing:-.01em;")}>
            My shortlists
          </h1>
        </div>
        {boards.length > 0 && (
          <button
            type="button"
            onClick={() => setAsking(true)}
            style={css('background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;border:none;border-radius:13px;padding:11px 18px;font-weight:800;font-size:13px;cursor:pointer;font-family:inherit;display:flex;align-items:center;gap:6px;')}
          >
            <Icon name="add" style={{ fontSize: 17 }} />
            New
          </button>
        )}
      </div>

      {loading && boards.length === 0 ? (
        <div style={css('margin-top:20px;')}>
          <SkeletonRows rows={3} height={96} />
        </div>
      ) : boards.length === 0 ? (
        <Empty
          icon="groups"
          title="Nothing to decide yet"
          body="Torn between two sarees? Put them on a shortlist and let your family settle it — they vote on a link, no account needed."
          cta="Make a shortlist"
          onCta={() => setAsking(true)}
        />
      ) : (
        <div style={css('display:flex;flex-direction:column;gap:12px;margin-top:20px;')}>
          {boards.map((b) => (
            <BoardRow key={b.id} board={b} onOpen={() => navigate(`/shortlists/${b.id}`)} />
          ))}
        </div>
      )}

      {asking && <AskMyPeopleSheet onClose={() => { setAsking(false); reload(); }} />}
    </div>
  );
}

function BoardRow({ board, onOpen }: { board: Board; onOpen: () => void }) {
  const tally = tallyVotes(board.votes);
  const voters = new Set(board.votes.map((v) => v.voter_key)).size;
  const hearts = Object.values(tally).reduce((sum, t) => sum + t.love, 0);
  const expired = new Date(board.expires_at) <= new Date();

  return (
    <button
      type="button"
      onClick={onOpen}
      className="agx-lift"
      style={css('display:flex;gap:12px;align-items:center;text-align:left;padding:12px;border:1.5px solid var(--ag-border);border-radius:18px;background:var(--ag-surface);cursor:pointer;font-family:inherit;width:100%;')}
    >
      {/* The first three pieces, fanned — enough to recognise the board at a glance. */}
      <div style={css('flex:none;display:flex;')}>
        {board.items.slice(0, 3).map((item, i) => (
          <div
            key={item.id}
            style={css(
              `width:46px;height:60px;border-radius:10px;overflow:hidden;border:2px solid var(--ag-surface);background:${TONES[item.product?.tone ?? 0]};position:relative;` +
                (i > 0 ? 'margin-left:-16px;' : ''),
            )}
          >
            <ImageSlot src={item.product?.image_url ?? ''} placeholder={item.product?.title ?? ''} className="agx-prod-fill" />
          </div>
        ))}
      </div>

      <div style={css('flex:1;min-width:0;')}>
        <div className="agx-card-title" style={css('font-size:14.5px;font-weight:700;color:var(--ag-ink);')}>{board.title}</div>
        <div style={css('font-size:12px;color:var(--ag-muted);margin-top:3px;')}>
          {board.items.length} {board.items.length === 1 ? 'piece' : 'pieces'}
          {voters > 0 && ` · ${voters} ${voters === 1 ? 'person' : 'people'} voted`}
        </div>
        <div style={css('display:flex;align-items:center;gap:9px;margin-top:6px;')}>
          {board.status === 'closed' ? (
            <span style={css('font-size:11px;font-weight:800;color:var(--ag-good-text);background:var(--ag-good-bg);border-radius:8px;padding:3px 8px;')}>
              Decided
            </span>
          ) : expired ? (
            <span style={css('font-size:11px;font-weight:800;color:var(--ag-muted);background:var(--ag-surface-2);border-radius:8px;padding:3px 8px;')}>
              Link expired
            </span>
          ) : voters === 0 ? (
            <span style={css('font-size:11px;font-weight:800;color:var(--ag-crimson);background:var(--ag-surface-2);border-radius:8px;padding:3px 8px;')}>
              Waiting for votes
            </span>
          ) : (
            <span style={css('display:flex;align-items:center;gap:4px;font-size:12px;font-weight:800;color:var(--ag-label);')}>
              <Icon name="favorite" style={{ fontSize: 15, color: 'var(--ag-crimson)' }} />
              {hearts}
            </span>
          )}
        </div>
      </div>

      <Icon name="chevron_right" style={{ fontSize: 20, color: 'var(--ag-muted)' }} />
    </button>
  );
}

function Empty({
  icon,
  title,
  body,
  cta,
  onCta,
}: {
  icon: string;
  title: string;
  body: string;
  cta: string;
  onCta: () => void;
}) {
  return (
    <div style={css('display:flex;flex-direction:column;align-items:center;text-align:center;padding:70px 30px;')}>
      <div style={css('width:82px;height:82px;border-radius:50%;background:var(--ag-surface-2);display:flex;align-items:center;justify-content:center;box-shadow:0 12px 26px -12px rgba(214,51,108,.55);')}>
        <Icon name={icon} style={{ fontSize: 38, color: 'var(--ag-crimson)' }} />
      </div>
      <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:26px;margin-top:20px;")}>{title}</div>
      <div style={css('color:var(--ag-muted);font-size:14.5px;margin-top:8px;max-width:360px;line-height:1.55;')}>{body}</div>
      <button
        type="button"
        onClick={onCta}
        style={css('margin-top:20px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;border:none;border-radius:14px;padding:13px 24px;font-weight:800;font-size:14px;cursor:pointer;font-family:inherit;box-shadow:0 14px 30px -14px rgba(214,51,108,.8);')}
      >
        {cta}
      </button>
      <Link to="/wishlist" style={css('margin-top:14px;font-size:13px;font-weight:700;color:var(--ag-crimson);text-decoration:none;')}>
        Go to my wishlist
      </Link>
    </div>
  );
}
