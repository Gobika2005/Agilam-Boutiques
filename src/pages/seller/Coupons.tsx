import { useMemo, useState } from 'react';
import { css } from '@/lib/css';
import { useShop } from '@/state/ShopContext';
import { useMyBoutique } from '@/hooks/useMyBoutique';
import { useAsync } from '@/hooks/useAsync';
import { FullscreenLoader } from '@/auth/RequireRole';
import { CouponFormFields } from '@/components/coupons/CouponFormFields';
import {
  fetchBoutiqueCoupons, fetchActiveCoupons, createCoupon, updateCoupon, setCouponActive, deleteCoupon,
  type CouponRow, type CouponInput,
} from '@/data/coupons';
import {
  emptyCouponInput, couponInputFromRow, validateCouponInput, describeCoupon, type CouponFieldErrors,
} from '@/lib/couponForm';
import { isExpired } from '@/lib/pricing';

/**
 * Seller coupons — a boutique's own discount codes.
 *
 * A seller coupon discounts only this boutique's items in a buyer's cart, and the
 * seller funds it: at checkout the discount is netted off this boutique's order
 * total, so it comes out of the payout (and the 10% commission is taken on the
 * discounted amount). Platform-wide coupons the marketplace runs are shown
 * read-only below so the seller knows what buyers already have.
 */

const fmtDate = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

type Editing = { id: string | null; input: CouponInput; errors: CouponFieldErrors };

export function Coupons() {
  const { showToast } = useShop();
  const { boutique, loading: boutiqueLoading } = useMyBoutique();
  const boutiqueId = boutique?.id;

  const { data: mine, loading, reload } = useAsync(
    () => (boutiqueId ? fetchBoutiqueCoupons(boutiqueId) : Promise.resolve([] as CouponRow[])),
    [boutiqueId],
  );
  // The marketplace-wide coupons buyers already have, shown read-only.
  const { data: activeAll } = useAsync(() => fetchActiveCoupons(), []);
  const platformOffers = useMemo(() => (activeAll ?? []).filter((c) => !c.boutique_id), [activeAll]);

  const [editing, setEditing] = useState<Editing | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (boutiqueLoading) return <FullscreenLoader />;

  const rows = mine ?? [];

  const openNew = () => setEditing({ id: null, input: emptyCouponInput(boutiqueId ?? null), errors: {} });
  const openEdit = (c: CouponRow) => setEditing({ id: c.id, input: couponInputFromRow(c), errors: {} });
  const patch = (p: Partial<CouponInput>) =>
    setEditing((e) => (e ? { ...e, input: { ...e.input, ...p }, errors: {} } : e));

  const save = async () => {
    if (!editing) return;
    const errors = validateCouponInput(editing.input, { allowShip: false });
    if (Object.keys(errors).length) {
      setEditing({ ...editing, errors });
      return;
    }
    setBusy(true);
    try {
      if (editing.id) await updateCoupon(editing.id, editing.input);
      else await createCoupon(editing.input);
      showToast(editing.id ? 'Coupon updated' : 'Coupon created');
      setEditing(null);
      reload();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not save the coupon';
      showToast(/duplicate|unique/i.test(msg) ? 'That code is already taken — pick another' : msg);
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (c: CouponRow) => {
    try {
      await setCouponActive(c.id, !c.active);
      showToast(c.active ? 'Coupon paused' : 'Coupon activated');
      reload();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not update the coupon');
    }
  };

  const remove = async () => {
    if (!confirmId) return;
    setBusy(true);
    try {
      await deleteCoupon(confirmId);
      showToast('Coupon deleted');
      setConfirmId(null);
      reload();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not delete the coupon');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={css('min-height:100%;background:var(--ag-bg);padding:16px 16px 90px;')}>
      <div style={css('max-width:720px;margin:0 auto;')}>
        <div style={css('display:flex;align-items:flex-start;gap:12px;')}>
          <div style={css('flex:1;min-width:0;')}>
            <div className="agx-eyebrow" style={css('font-size:10px;color:var(--ag-crimson);')}>Boutique offers</div>
            <h1 style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:26px;line-height:1.1;margin-top:3px;")}>Coupons</h1>
            <div style={css('color:var(--ag-muted);font-size:12.5px;margin-top:5px;line-height:1.5;')}>
              Discount codes for your own items. You fund these — the discount comes off your payout, and commission is taken on the reduced amount.
            </div>
          </div>
          <button onClick={openNew} disabled={!boutiqueId} style={css(`flex:none;height:44px;padding:0 16px;border:none;border-radius:13px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;font-size:13.5px;cursor:pointer;display:flex;align-items:center;gap:6px;opacity:${boutiqueId ? 1 : 0.6};`)}>
            <span style={css("font-family:'Material Symbols Outlined';font-size:19px;")}>add</span>New
          </button>
        </div>

        {/* The seller's own coupons */}
        <div style={css('display:flex;flex-direction:column;gap:12px;margin-top:18px;')}>
          {loading && rows.length === 0 && (
            <div style={css('padding:30px;text-align:center;color:var(--ag-muted-soft);font-weight:700;font-size:13px;')}>Loading…</div>
          )}
          {!loading && rows.length === 0 && (
            <div style={css('background:var(--ag-surface);border:1px dashed var(--ag-border);border-radius:18px;padding:28px 18px;text-align:center;box-shadow:0 14px 32px -30px rgba(107,20,54,.5);')}>
              <span style={css("font-family:'Material Symbols Outlined';font-size:34px;color:var(--ag-border);")}>local_offer</span>
              <div style={css('font-weight:800;font-size:14.5px;color:var(--ag-ink-2);margin-top:8px;')}>No coupons yet</div>
              <div style={css('color:var(--ag-muted);font-size:12.5px;margin-top:4px;')}>Create a code to bring buyers back to your boutique.</div>
            </div>
          )}
          {rows.map((c) => {
            const expired = isExpired(c);
            return (
              <div key={c.id} style={css(`background:var(--ag-surface);border:1.5px solid ${expired ? 'var(--ag-border)' : c.active ? 'var(--ag-surface-3)' : 'var(--ag-border)'};border-radius:18px;padding:15px;box-shadow:0 14px 34px -30px rgba(107,20,54,.5);opacity:${expired || !c.active ? 0.72 : 1};`)}>
                <div style={css('display:flex;align-items:center;gap:10px;flex-wrap:wrap;')}>
                  <span style={css("font-family:'IBM Plex Mono',monospace;font-weight:600;font-size:15px;color:var(--ag-crimson);letter-spacing:.04em;")}>{c.code}</span>
                  <span style={css(`font-size:10px;font-weight:800;border-radius:6px;padding:2px 8px;${expired ? 'color:var(--ag-bad-text);background:var(--ag-bad-bg);' : c.active ? 'color:var(--ag-good-text);background:var(--ag-good-bg);' : 'color:var(--ag-muted);background:var(--ag-surface-2);'}`)}>
                    {expired ? 'EXPIRED' : c.active ? 'ACTIVE' : 'PAUSED'}
                  </span>
                  <div style={css('flex:1;')} />
                  <div style={css('display:flex;gap:6px;')}>
                    <IconBtn icon="edit" onClick={() => openEdit(c)} />
                    <IconBtn icon={c.active ? 'pause' : 'play_arrow'} onClick={() => toggleActive(c)} />
                    <IconBtn icon="delete" danger onClick={() => setConfirmId(c.id)} />
                  </div>
                </div>
                <div style={css('font-weight:700;font-size:14px;color:var(--ag-ink);margin-top:8px;')}>{describeCoupon(c)}</div>
                {c.description && <div style={css('font-size:12.5px;color:var(--ag-label);margin-top:3px;')}>{c.description}</div>}
                <div style={css(`font-size:11.5px;margin-top:6px;color:${expired ? '#B03A3A' : '#9A8088'};font-weight:600;`)}>
                  {expired ? `Expired ${fmtDate(c.expires_at)}` : `Valid till ${fmtDate(c.expires_at)}`}
                </div>
              </div>
            );
          })}
        </div>

        {/* Marketplace coupons, read-only — so the seller knows what buyers have. */}
        {platformOffers.length > 0 && (
          <div style={css('margin-top:26px;')}>
            <div className="agx-eyebrow" style={css('font-size:10px;color:var(--ag-muted);')}>Marketplace offers · run by MangaiMart</div>
            <div style={css('display:flex;flex-direction:column;gap:10px;margin-top:10px;')}>
              {platformOffers.map((c) => (
                <div key={c.id} style={css('display:flex;align-items:center;gap:12px;background:var(--ag-surface-2);border:1px solid var(--ag-border);border-radius:14px;padding:12px 14px;')}>
                  <span style={css("font-family:'Material Symbols Outlined';color:var(--ag-crimson);")}>redeem</span>
                  <div style={css('flex:1;min-width:0;')}>
                    <span style={css("font-family:'IBM Plex Mono',monospace;font-weight:600;font-size:13px;color:var(--ag-crimson);")}>{c.code}</span>
                    <div style={css('font-size:12px;color:var(--ag-label);font-weight:600;margin-top:1px;')}>{describeCoupon(c)}</div>
                  </div>
                  <span style={css('font-size:11px;color:var(--ag-muted);font-weight:600;')}>till {fmtDate(c.expires_at)}</span>
                </div>
              ))}
            </div>
            <div style={css('font-size:11.5px;color:var(--ag-muted);margin-top:8px;line-height:1.5;')}>
              These are funded by MangaiMart, not you — your payout is unaffected when a buyer uses one.
            </div>
          </div>
        )}
      </div>

      {/* Create / edit sheet */}
      {editing && (
        <div onClick={() => !busy && setEditing(null)} style={css('position:fixed;inset:0;z-index:200;background:rgba(40,10,22,.5);backdrop-filter:blur(4px);display:flex;align-items:flex-end;justify-content:center;')}>
          <div onClick={(e) => e.stopPropagation()} className="agx-scroll" style={css('width:100%;max-width:520px;max-height:92vh;overflow-y:auto;background:var(--ag-bg);border-radius:26px 26px 0 0;padding:20px 20px 26px;box-shadow:0 -20px 60px -20px rgba(107,20,54,.5);')}>
            <div style={css('display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;')}>
              <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:20px;")}>{editing.id ? 'Edit coupon' : 'New coupon'}</div>
              <button onClick={() => setEditing(null)} style={css('width:36px;height:36px;border-radius:11px;border:none;background:var(--ag-surface-2);color:var(--ag-crimson);cursor:pointer;display:flex;align-items:center;justify-content:center;')}>
                <span style={css("font-family:'Material Symbols Outlined';")}>close</span>
              </button>
            </div>

            <CouponFormFields input={editing.input} onChange={patch} errors={editing.errors} allowShip={false} />

            <button onClick={save} disabled={busy} style={css(`width:100%;height:52px;margin-top:20px;border:none;border-radius:15px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;font-size:15px;cursor:pointer;opacity:${busy ? 0.7 : 1};`)}>
              {busy ? 'Saving…' : editing.id ? 'Save changes' : 'Create coupon'}
            </button>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {confirmId && (
        <div onClick={() => !busy && setConfirmId(null)} style={css('position:fixed;inset:0;z-index:210;background:rgba(42,26,32,.45);display:flex;align-items:center;justify-content:center;padding:20px;')}>
          <div onClick={(e) => e.stopPropagation()} style={css('width:400px;max-width:100%;background:var(--ag-surface);border-radius:20px;padding:24px;box-shadow:0 30px 70px -30px rgba(107,20,54,.7);')}>
            <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:20px;")}>Delete coupon?</div>
            <div style={css('color:var(--ag-muted);font-size:13.5px;margin-top:8px;line-height:1.5;')}>Buyers will no longer be able to use this code. This can’t be undone.</div>
            <div style={css('display:flex;gap:10px;margin-top:22px;')}>
              <button onClick={() => setConfirmId(null)} disabled={busy} style={css('flex:1;height:48px;border-radius:14px;border:1.5px solid var(--ag-border);background:var(--ag-surface);color:var(--ag-label);font-weight:700;font-size:14px;cursor:pointer;')}>Cancel</button>
              <button onClick={remove} disabled={busy} style={css('flex:1;height:48px;border-radius:14px;border:none;color:#fff;font-weight:800;font-size:14px;cursor:pointer;background:linear-gradient(135deg,#E4636F,var(--ag-bad-text));')}>{busy ? 'Deleting…' : 'Delete'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function IconBtn({ icon, onClick, danger }: { icon: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={css(`width:34px;height:34px;border-radius:10px;border:1.5px solid ${danger ? 'var(--ag-border)' : 'var(--ag-border)'};background:var(--ag-surface);color:${danger ? 'var(--ag-danger-text)' : 'var(--ag-crimson)'};cursor:pointer;display:flex;align-items:center;justify-content:center;`)}
    >
      <span style={css("font-family:'Material Symbols Outlined';font-size:18px;")}>{icon}</span>
    </button>
  );
}
