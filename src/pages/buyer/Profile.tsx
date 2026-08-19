import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
import { usePageMeta } from '@/lib/pageMeta';
import { useShop } from '@/state/ShopContext';
import { useAuth } from '@/auth/AuthContext';
import { ThemeToggle } from '@/components/ThemeToggle';
import { ProfileEditSheet } from '@/components/buyer/ProfileEditSheet';
import { AccountSheet } from '@/components/buyer/AccountSheet';
import { readOrders } from '@/lib/orderHistory';
import { syncAccount } from '@/lib/accountSync';
import { APP_VERSION, COMPANY } from '@/data/company';

/** "selva.kumar" / "selva_kumar" -> "Selva Kumar" for an email-derived name. */
function prettifyName(local: string): string {
  return local.replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

export function Profile() {
  usePageMeta({ title: 'My account', description: 'Your MangaiMart profile, orders, saved pieces and delivery details.' });
  const navigate = useNavigate();
  const { openSellModal, showToast, guest, setGuest, clearGuest, hasBuyerDetails, wishlist, cartCount } = useShop();
  const { session, signOut, loading: authLoading } = useAuth();
  const [editing, setEditing] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // Real-time figures: the buyer's own placed orders (in-memory for this visit,
  // merged with any read from their account), saved wishlist and current bag.
  const [orderCount, setOrderCount] = useState(() => readOrders().length);
  const wishCount = Object.keys(wishlist).length;

  // Signed in (Google / email code / password) means profile & orders sync
  // across devices via the account.
  const signedIn = !!session;
  const accountEmail = session?.user?.email ?? '';

  // Push edits to the account, pull the saved profile + orders back, merge
  // locally. An empty `msg` runs it silently (used for the on-return refresh).
  const doSync = async (patch?: { name: string; phone: string; city: string; address: string; pincode: string }, msg = 'Synced across devices') => {
    setSyncing(true);
    try {
      // Pass the current local details so anything entered as a guest migrates
      // up to the account rather than being lost on logout. Never let a synced
      // value blank out something we already have locally.
      const prof = await syncAccount(guest, patch);
      setGuest({
        name: prof.name || guest.name,
        phone: prof.phone || guest.phone,
        city: prof.city || guest.city,
        address: prof.address || guest.address,
        pincode: prof.pincode || guest.pincode,
      });
      setOrderCount(readOrders().length);
      if (msg) showToast(msg);
    } catch (e) {
      if (msg) showToast(e instanceof Error ? e.message : 'Sync failed', 'error');
    } finally {
      setSyncing(false);
    }
  };

  const onSignedIn = () => {
    setAccountOpen(false);
    showToast('Signed in');
  };

  // Whenever we land on the profile already signed in — a fresh login, a Google
  // redirect, a page reload, or after logout cleared local data — pull the saved
  // profile + orders back so previously-added data always shows. Runs once.
  const syncedRef = useRef(false);
  useEffect(() => {
    if (signedIn && !syncedRef.current) {
      syncedRef.current = true;
      void doSync(undefined, '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn]);

  // Once signed in, name the account after the Google/email identity.
  const meta = session?.user?.user_metadata as { full_name?: string; name?: string } | undefined;
  const emailName = accountEmail ? prettifyName(accountEmail.split('@')[0]) : '';
  const accountName = guest.name || meta?.full_name || meta?.name || emailName || 'Shopper';

  // A guest with no saved details and no account has nothing to show or edit yet.
  // Wait for auth to resolve so a refresh doesn't briefly offer "Sign in".
  const guestNoAccount = !authLoading && !signedIn && !hasBuyerDetails;
  const name = signedIn ? accountName : hasBuyerDetails ? guest.name : 'Guest shopper';
  const initial = guestNoAccount ? '' : name.trim().charAt(0).toUpperCase();
  const contactLine = [guest.phone && `+91 ${guest.phone}`, guest.city].filter(Boolean).join(' · ');
  const subline = signedIn
    ? contactLine || accountEmail
    : hasBuyerDetails
      ? contactLine
      : 'Add your details for a smoother checkout';

  const stats = [
    { label: 'Orders', value: orderCount, icon: 'receipt_long', go: () => navigate('/orders') },
    { label: 'Wishlist', value: wishCount, icon: 'favorite', go: () => navigate('/wishlist') },
    { label: 'Bag', value: cartCount, icon: 'shopping_bag', go: () => navigate('/cart') },
  ];

  type Row = { label: string; sub: string; icon: string; go?: () => void; href?: string };

  /** Shopping — everything tied to this buyer's own activity. */
  const shoppingRows: Row[] = [
    { label: 'My Orders', sub: 'Track & manage purchases', icon: 'receipt_long', go: () => navigate('/orders') },
    { label: 'Wishlist', sub: wishCount ? `${wishCount} ${wishCount === 1 ? 'piece' : 'pieces'} saved` : 'Pieces you saved', icon: 'favorite', go: () => navigate('/wishlist') },
    { label: 'Messages', sub: 'Chats with boutiques', icon: 'chat', go: () => navigate('/messages') },
    { label: 'Coupons & Offers', sub: 'Deals ready to use', icon: 'confirmation_number', go: () => navigate('/coupons') },
    { label: 'Delivery Address', sub: guest.address || 'Add where we ship', icon: 'location_on', go: () => setEditing(true) },
  ];

  /**
   * Support — one door in, not four. Help & Support, Contact Us, Call Support
   * and About Us used to be four separate rows all leading to the same place
   * (the Help policy page already ends with Email/Call buttons, and links on
   * to About from its sidebar) — collapsed to the single row a buyer actually
   * needs to tap.
   */
  const supportRows: Row[] = [
    { label: 'Support Center', sub: `FAQs, ${COMPANY.supportEmail}, ${COMPANY.phone}`, icon: 'support_agent', go: () => navigate('/help') },
  ];

  /** Legal — the policy pages, reachable from the account as required. */
  const legalRows: Row[] = [
    { label: 'Delivery Policy', sub: 'Timelines & charges', icon: 'local_shipping', go: () => navigate('/delivery-policy') },
    { label: 'Return & Refund Policy', sub: 'How returns work', icon: 'autorenew', go: () => navigate('/return-refund-policy') },
    { label: 'Cancellation Policy', sub: 'Changing your mind', icon: 'cancel', go: () => navigate('/cancellation-policy') },
    { label: 'Privacy Policy', sub: 'How we handle your data', icon: 'shield_person', go: () => navigate('/privacy-policy') },
    { label: 'Terms & Conditions', sub: 'The agreement between us', icon: 'gavel', go: () => navigate('/terms') },
  ];

  const renderRows = (title: string, rows: Row[]) => (
    <>
      <div className="agx-eyebrow" style={css('font-size:9.5px;color:var(--ag-muted);margin:20px 26px 8px;')}>{title}</div>
      <div style={css('margin:0 20px;background:var(--ag-surface);border-radius:20px;padding:6px;box-shadow:0 12px 30px -22px rgba(107,20,54,.55);')}>
        {rows.map((r, i) => {
          const inner = (
            <>
              <span style={css('width:40px;height:40px;flex:none;border-radius:12px;background:var(--ag-surface-2);display:flex;align-items:center;justify-content:center;')}>
                <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:#D6336C;font-size:21px;")}>{r.icon}</span>
              </span>
              <span style={css('flex:1;min-width:0;')}>
                <span style={css('display:block;font-weight:800;font-size:14.5px;color:var(--ag-ink);')}>{r.label}</span>
                <span style={css('display:block;font-size:12px;color:var(--ag-muted);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;')}>{r.sub}</span>
              </span>
              <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:#CBB0BC;flex:none;")}>chevron_right</span>
            </>
          );
          const rowCss = css(
            `width:100%;display:flex;align-items:center;gap:13px;padding:13px 12px;border:none;background:none;cursor:pointer;text-align:left;color:inherit;${
              i < rows.length - 1 ? 'border-bottom:1px solid var(--ag-border-soft);' : ''
            }`,
          );
          // Contact rows are real mail:/tel: links so the device opens the right
          // app, rather than a button that only shows the address in a toast.
          return r.href ? (
            <a key={r.label} href={r.href} style={rowCss}>{inner}</a>
          ) : (
            <button key={r.label} onClick={r.go} style={rowCss}>{inner}</button>
          );
        })}
      </div>
    </>
  );

  // Log out returns to the public buyer app.
  const logout = async () => {
    if (session) await signOut();
    clearGuest();
    navigate('/', { replace: true });
  };

  return (
    <div style={css('min-height:100%;background:var(--ag-bg);padding-bottom:24px;')}>
      <div style={css('max-width:720px;margin:0 auto;')}>
        {/* Identity header */}
        <div style={css('background:linear-gradient(150deg,#8E1C44,#B02454 55%,#D6336C);padding:26px 20px 40px;color:#fff;border-radius:0 0 28px 28px;position:relative;overflow:hidden;box-shadow:0 22px 44px -30px rgba(142,28,68,.9);')}>
          <div style={css('position:absolute;top:-70px;right:-40px;width:220px;height:220px;border-radius:50%;background:radial-gradient(circle,rgba(244,217,166,.22),transparent 70%);')} />
          <div className="agx-eyebrow" style={css('font-size:10px;color:#F4D9A6;position:relative;')}>My account</div>
          {/* Name, subline and the action button used to share one nowrap row, so
              on a phone "Guest shopper" arrived as "Guest sh…" and a real
              buyer's name was clipped to a few characters. The button now wraps
              onto its own line when the row runs out of width, and the name is
              allowed two lines before it truncates. */}
          <div className="agx-profile-id" style={css('display:flex;align-items:center;gap:15px;margin-top:12px;position:relative;flex-wrap:wrap;')}>
            <div style={css("width:66px;height:66px;flex:none;border-radius:20px;background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.28);display:flex;align-items:center;justify-content:center;font-family:'Playfair Display',serif;font-weight:700;font-size:30px;backdrop-filter:blur(4px);")}>
              {initial || <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:34px;opacity:.9;")}>person</span>}
            </div>
            <div style={css('flex:1 1 150px;min-width:0;')}>
              <h1 style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:clamp(20px,5.5vw,24px);line-height:1.12;margin:0;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;")}>{name}</h1>
              <div style={css('opacity:.88;font-size:13px;margin-top:4px;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;')}>{subline}</div>
            </div>
            <button
              onClick={() => (guestNoAccount ? setAccountOpen(true) : setEditing(true))}
              style={css('flex:none;height:38px;padding:0 15px;border:1px solid rgba(255,255,255,.35);background:rgba(255,255,255,.14);color:#fff;border-radius:12px;font-weight:800;font-size:13px;cursor:pointer;display:flex;align-items:center;gap:6px;white-space:nowrap;')}
            >
              <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:17px;")}>{guestNoAccount ? 'login' : 'edit'}</span>
              {guestNoAccount ? 'Sign in' : 'Edit'}
            </button>
          </div>
        </div>

        {/* Live stats */}
        <div style={css('margin:-24px 20px 0;background:var(--ag-surface);border-radius:20px;padding:6px;display:flex;box-shadow:0 16px 36px -26px rgba(107,20,54,.6);position:relative;')}>
          {stats.map((s, i) => (
            <button
              key={s.label}
              onClick={s.go}
              style={css(`flex:1;background:none;border:none;cursor:pointer;padding:14px 6px;display:flex;flex-direction:column;align-items:center;gap:4px;${i < stats.length - 1 ? 'border-right:1px solid var(--ag-border-soft);' : ''}`)}
            >
              <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:#D6336C;font-size:22px;")}>{s.icon}</span>
              <span style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:22px;color:var(--ag-ink);line-height:1;")}>{s.value}</span>
              <span style={css('font-size:11.5px;font-weight:700;color:var(--ag-muted);')}>{s.label}</span>
            </button>
          ))}
        </div>

        {/* Account / cross-device sync — hidden until auth has resolved so a
            refresh doesn't flash the signed-out prompt. */}
        {authLoading ? null : signedIn ? (
          <div style={css('margin:16px 20px 0;display:flex;align-items:center;gap:13px;padding:14px 15px;background:var(--ag-good-bg);border:1px solid var(--ag-good-bg);border-radius:18px;')}>
            <span style={css('width:40px;height:40px;flex:none;border-radius:12px;background:var(--ag-good-bg);display:flex;align-items:center;justify-content:center;')}>
              <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:var(--ag-good);font-size:22px;")}>verified</span>
            </span>
            <span style={css('flex:1;min-width:0;')}>
              <span style={css('display:block;font-weight:800;font-size:14.5px;color:var(--ag-good-text);')}>Synced across devices</span>
              <span style={css('display:block;font-size:12px;color:var(--ag-good-text);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;')}>{accountEmail || 'Orders & profile backed up'}</span>
            </span>
            <button onClick={() => void doSync()} disabled={syncing} style={css('flex:none;height:34px;padding:0 13px;border:1px solid var(--ag-good-bg);background:var(--ag-surface);color:var(--ag-good-text);border-radius:10px;font-weight:800;font-size:12.5px;cursor:pointer;display:flex;align-items:center;gap:5px;')}>
              <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:16px;")}>{syncing ? 'sync' : 'refresh'}</span>{syncing ? 'Syncing' : 'Refresh'}
            </button>
          </div>
        ) : (
          <button onClick={() => setAccountOpen(true)} style={css('margin:16px 20px 0;width:calc(100% - 40px);display:flex;align-items:center;gap:13px;padding:14px 15px;background:var(--ag-surface);border:1.5px dashed var(--ag-border);border-radius:18px;cursor:pointer;text-align:left;box-shadow:0 12px 30px -24px rgba(107,20,54,.55);')}>
            <span style={css('width:40px;height:40px;flex:none;border-radius:12px;background:var(--ag-surface-2);display:flex;align-items:center;justify-content:center;')}>
              <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:#D6336C;font-size:22px;")}>cloud_sync</span>
            </span>
            <span style={css('flex:1;min-width:0;')}>
              <span style={css('display:block;font-weight:800;font-size:14.5px;color:var(--ag-ink);')}>Sign in to sync</span>
              <span style={css('display:block;font-size:12px;color:var(--ag-muted);margin-top:1px;')}>Google or email to back up orders &amp; details</span>
            </span>
            <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:var(--ag-crimson);flex:none;")}>chevron_right</span>
          </button>
        )}

        {/* Menu, grouped so the legal pages don't sit in the middle of the
            shopping shortcuts. */}
        {renderRows('Shopping', shoppingRows)}
        <ThemeToggle />
        {renderRows('Support', supportRows)}
        {renderRows('Policies', legalRows)}

        {/* Sell CTA */}
        <button onClick={openSellModal} style={css('margin:16px 20px 0;width:calc(100% - 40px);display:flex;align-items:center;gap:13px;padding:15px;border:none;border-radius:18px;background:linear-gradient(135deg,#8E1C44,#B02454);color:#fff;cursor:pointer;box-shadow:0 16px 34px -18px rgba(142,28,68,.9);text-align:left;')}>
          <span style={css('width:42px;height:42px;border-radius:13px;background:rgba(255,255,255,.18);display:flex;align-items:center;justify-content:center;flex:none;')}>
            <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:23px;")}>storefront</span>
          </span>
          <span style={css('flex:1;')}>
            <span style={css('display:block;font-weight:800;font-size:15px;')}>Sell on MangaiMart</span>
            <span style={css('display:block;font-size:12.5px;opacity:.85;margin-top:2px;')}>Open your boutique &amp; start selling</span>
          </span>
          <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';opacity:.8;")}>chevron_right</span>
        </button>

        <button onClick={logout} style={css('margin:16px 20px 0;width:calc(100% - 40px);height:50px;border:1.5px solid var(--ag-border);background:var(--ag-surface);color:var(--ag-danger-text);border-radius:14px;font-weight:800;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;')}>
          <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:19px;")}>logout</span>
          {signedIn ? 'Log out' : 'Clear my details'}
        </button>

        {/* No "Admin login" row here. The admin console is staff-only and
            advertising its door to every buyer invites the guessing. Staff reach
            it at /admin, which redirects to the login when there's no session —
            see RequireRole. */}

        {/* Build stamp — the first thing support asks for. Injected from
            package.json at build time, so it can't drift from what's deployed. */}
        <div style={css('margin:18px 20px 0;text-align:center;color:var(--ag-muted-soft);')}>
          <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:16px;color:var(--ag-muted-soft);")}>{COMPANY.brand}</div>
          <div style={css("font-family:'IBM Plex Mono',monospace;font-size:11px;margin-top:5px;letter-spacing:.06em;")}>
            Version {APP_VERSION}
          </div>
          <div style={css('font-size:11.5px;margin-top:6px;')}>
            © {new Date().getFullYear()} {COMPANY.legalName}
          </div>
        </div>
      </div>

      {editing && (
        <ProfileEditSheet
          onClose={() => setEditing(false)}
          onSaved={(patch) => { if (signedIn) void doSync(patch); }}
        />
      )}
      {accountOpen && <AccountSheet onDone={onSignedIn} onClose={() => setAccountOpen(false)} />}
    </div>
  );
}
