import { useState } from 'react';
import { css } from '@/lib/css';
import { useShop } from '@/state/ShopContext';
import { useAsync } from '@/hooks/useAsync';
import {
  T, Card, DataTable, EmptyState, GhostButton, IconButton, StatusPill,
  Drawer, ConfirmDialog, TabBar, type Column,
} from '@/components/admin/kit';
import { fmt } from '@/data/demo';
import {
  fetchAllCouriers, saveCourier, fetchDeliveryDisputes, resolveDeliveryDispute,
  fetchStalledShipments, buildTrackingUrl,
  fetchShiprocketShops, saveBoutiqueShiprocket, fetchPlatformSwitches, savePlatformSwitches,
  type Courier, type DeliveryIssueRow, type StalledShipmentRow, type ShiprocketShopRow,
} from '@/data/shipments';

/**
 * Deliveries — the three jobs migration 0063 created, in the order they matter.
 *
 *   1. **Disputes.** A buyer said a delivered order never arrived. The seller's
 *      payout is frozen until this is closed, so it is money sitting still and
 *      belongs at the top. Resolving is admin-only by design: 0063's guard
 *      trigger silently reverts a seller who tries to clear an accusation
 *      against themselves.
 *   2. **Stalled.** Parcels dispatched long ago that nobody marked delivered.
 *      Not fraud — the seller is stranding their own money — but it rots
 *      silently unless something surfaces it.
 *   3. **Couriers.** The list sellers pick from when shipping. Most Indian
 *      courier tracking pages are form-POST with no addressable URL, so many
 *      rows deliberately ship with no template; fill one in here once you have
 *      verified it opens.
 *   4. **Shiprocket.** The master switch and each shop's pickup location
 *      (migration 0067). A shop cannot book until BOTH switches are on and its
 *      pickup nickname is filled in, so this tab is where an integration that
 *      "does nothing" gets diagnosed.
 *
 * Deliberately a tab here rather than a new sidebar entry — the admin nav is
 * already 20 items deep, and everything on this screen is one subject: getting
 * a parcel from the shop to the buyer.
 */

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

const daysSince = (iso: string | null) =>
  iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : 0;

type Tab = 'disputes' | 'stalled' | 'couriers' | 'shiprocket';

export function Deliveries() {
  const { showToast } = useShop();
  const [tab, setTab] = useState<Tab>('disputes');

  const { data: disputes, loading: dLoading, reload: reloadDisputes } = useAsync(fetchDeliveryDisputes, []);
  const { data: stalled, loading: sLoading } = useAsync(() => fetchStalledShipments(10), []);
  const { data: couriers, loading: cLoading, reload: reloadCouriers } = useAsync(fetchAllCouriers, []);

  const { data: shops, loading: shLoading, reload: reloadShops } = useAsync(
    () => fetchShiprocketShops().catch(() => [] as ShiprocketShopRow[]), []);
  const { data: switches, reload: reloadSwitches } = useAsync(fetchPlatformSwitches, []);

  const [resolving, setResolving] = useState<DeliveryIssueRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Partial<Courier> | null>(null);
  const [shop, setShop] = useState<ShiprocketShopRow | null>(null);

  const toggleSwitch = async (key: 'shiprocket_enabled' | 'cod_enabled', on: boolean) => {
    try {
      await savePlatformSwitches({ [key]: on });
      showToast(on ? 'Switched on' : 'Switched off');
      reloadSwitches();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not save that switch');
    }
  };

  const persistShop = async () => {
    if (!shop) return;
    setBusy(true);
    try {
      await saveBoutiqueShiprocket(shop.id, {
        shiprocket_enabled: shop.shiprocket_enabled,
        shiprocket_pickup_location: shop.shiprocket_pickup_location,
      });
      showToast(`${shop.name} saved`);
      setShop(null);
      reloadShops();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not save this boutique');
    } finally {
      setBusy(false);
    }
  };

  const resolve = async () => {
    if (!resolving) return;
    setBusy(true);
    try {
      await resolveDeliveryDispute(resolving.id);
      showToast('Dispute closed — the order can be paid out again');
      setResolving(null);
      reloadDisputes();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not close this dispute');
    } finally {
      setBusy(false);
    }
  };

  const persistCourier = async () => {
    if (!editing?.name?.trim()) return;
    setBusy(true);
    try {
      await saveCourier({ ...editing, name: editing.name });
      showToast('Courier saved');
      setEditing(null);
      reloadCouriers();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not save this courier');
    } finally {
      setBusy(false);
    }
  };

  const disputeCols: Column<DeliveryIssueRow>[] = [
    { key: 'order', header: 'ORDER', width: '1fr', render: (o) => (
      <div>
        <div style={css('font-weight:800;')}>{o.order_number}</div>
        <div style={css(`font-size:12px;color:${T.muted};`)}>{o.boutique?.name ?? '—'}</div>
      </div>
    ) },
    { key: 'buyer', header: 'BUYER', width: '1fr', render: (o) => (
      <div>
        <div>{o.guest_name ?? 'Account buyer'}</div>
        <div style={css(`font-size:12px;color:${T.muted};`)}>{o.guest_phone ?? '—'}</div>
      </div>
    ) },
    { key: 'note', header: 'REPORTED', width: '1.4fr', render: (o) => (
      <div>
        <div style={css('font-size:13px;')}>{o.delivery_dispute_note || 'Not received'}</div>
        <div style={css(`font-size:12px;color:${T.muted};`)}>
          {fmtDate(o.delivery_disputed_at)} · delivered {fmtDate(o.delivered_at)}
        </div>
      </div>
    ) },
    { key: 'value', header: 'VALUE', width: '110px', align: 'right', render: (o) => <span style={css('font-weight:800;')}>{fmt(Number(o.total))}</span> },
    // Whether the money already left is the first thing an admin needs to know:
    // a dispute on an unpaid order is a hold, on a paid one it is a recovery.
    { key: 'payout', header: 'PAYOUT', width: '130px', render: (o) => (
      <StatusPill status={o.payout_id ? 'cod' : 'paid'} label={o.payout_id ? 'Already paid' : 'Held'} />
    ) },
    { key: 'act', header: '', width: '60px', align: 'right', render: (o) => (
      <IconButton icon="task_alt" tone="success" title="Close this dispute" onClick={() => setResolving(o)} />
    ) },
  ];

  const stalledCols: Column<StalledShipmentRow>[] = [
    { key: 'order', header: 'ORDER', width: '1fr', render: (o) => <span style={css('font-weight:800;')}>{o.order_number}</span> },
    { key: 'boutique', header: 'BOUTIQUE', width: '1.2fr', render: (o) => o.boutique?.name ?? '—' },
    { key: 'shipped', header: 'SHIPPED', width: '1fr', render: (o) => (
      <div>
        <div>{fmtDate(o.shipped_at)}</div>
        <div style={css(`font-size:12px;color:${T.muted};`)}>{daysSince(o.shipped_at)} days ago</div>
      </div>
    ) },
    { key: 'value', header: 'VALUE', width: '110px', align: 'right', render: (o) => <span style={css('font-weight:800;')}>{fmt(Number(o.total))}</span> },
  ];

  const courierCols: Column<Courier>[] = [
    { key: 'name', header: 'COURIER', width: '1fr', render: (c) => <span style={css('font-weight:800;')}>{c.name}</span> },
    { key: 'tpl', header: 'TRACKING LINK', width: '2fr', render: (c) => (
      c.tracking_url_template
        ? <span style={css('font-size:12.5px;word-break:break-all;')}>{c.tracking_url_template}</span>
        : <span style={css(`font-size:12.5px;color:${T.muted};`)}>No link — sellers can paste one per parcel</span>
    ) },
    { key: 'state', header: 'STATUS', width: '120px', render: (c) => (
      <StatusPill status={c.active ? 'paid' : 'cod'} label={c.active ? 'Active' : 'Hidden'} />
    ) },
    { key: 'act', header: '', width: '60px', align: 'right', render: (c) => (
      <IconButton icon="edit" title="Edit courier" onClick={() => setEditing(c)} />
    ) },
  ];

  // "Ready" means all three conditions hold. Showing the reason rather than a
  // bare cross is the whole point of the column — an admin whose sellers say
  // "the button isn't there" needs to know which of the three is missing.
  const shopCols: Column<ShiprocketShopRow>[] = [
    { key: 'name', header: 'BOUTIQUE', width: '1.4fr', render: (b) => (
      <div>
        <div style={css('font-weight:800;')}>{b.name}</div>
        <div style={css(`font-size:12px;color:${T.muted};`)}>{b.status}</div>
      </div>
    ) },
    { key: 'pickup', header: 'PICKUP LOCATION', width: '1.4fr', render: (b) => (
      b.shiprocket_pickup_location
        ? <span style={css('font-size:13px;font-weight:700;')}>{b.shiprocket_pickup_location}</span>
        : <span style={css(`font-size:12.5px;color:${T.muted};`)}>Not registered</span>
    ) },
    { key: 'ready', header: 'BOOKING', width: '150px', render: (b) => {
      const ready = Boolean(switches?.shiprocket_enabled && b.shiprocket_enabled && b.shiprocket_pickup_location);
      const why = !switches?.shiprocket_enabled ? 'Platform off'
        : !b.shiprocket_enabled ? 'Shop off'
        : !b.shiprocket_pickup_location ? 'No pickup' : 'Ready';
      return <StatusPill status={ready ? 'paid' : 'cod'} label={why} />;
    } },
    { key: 'act', header: '', width: '60px', align: 'right', render: (b) => (
      <IconButton icon="edit" title="Configure" onClick={() => setShop(b)} />
    ) },
  ];

  const preview = editing?.tracking_url_template
    ? buildTrackingUrl(editing.tracking_url_template, '1234567890')
    : null;

  const field = `width:100%;height:44px;border-radius:11px;border:1.5px solid ${T.field};background:var(--ag-bg);color:${T.ink};padding:0 13px;font-size:14px;font-family:inherit;box-sizing:border-box;`;
  const label = `font-size:11.5px;font-weight:800;color:${T.muted};letter-spacing:.05em;margin-bottom:6px;`;

  return (
    <div>
      <TabBar<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'disputes', label: 'Disputes', count: disputes?.length ?? 0 },
          { key: 'stalled', label: 'Stalled parcels', count: stalled?.length ?? 0 },
          { key: 'couriers', label: 'Couriers' },
          { key: 'shiprocket', label: 'Shiprocket' },
        ]}
      />

      {tab === 'disputes' && (
        <>
          <Card style="padding:14px 18px;margin-bottom:14px;">
            <div style={css(`font-size:13px;color:${T.muted};line-height:1.6;`)}>
              A buyer reported that a delivered order never reached them. While a dispute is open the order is
              excluded from both automatic and manual payouts. Check the courier docket on the order before closing it —
              closing releases the money.
            </div>
          </Card>
          <DataTable
            columns={disputeCols}
            rows={disputes ?? []}
            loading={dLoading}
            getId={(o) => o.id}
            empty={<EmptyState icon="verified" title="No open disputes" sub="Every delivered order has been accepted by its buyer." />}
          />
        </>
      )}

      {tab === 'stalled' && (
        <>
          <Card style="padding:14px 18px;margin-bottom:14px;">
            <div style={css(`font-size:13px;color:${T.muted};line-height:1.6;`)}>
              Dispatched more than 10 days ago and still not marked delivered. The seller is holding up their own
              payout — the money only moves once the order reaches “delivered” — so this is usually a nudge, not a problem.
            </div>
          </Card>
          <DataTable
            columns={stalledCols}
            rows={stalled ?? []}
            loading={sLoading}
            getId={(o) => o.id}
            empty={<EmptyState icon="local_shipping" title="Nothing stalled" sub="Every dispatched parcel has been closed out." />}
          />
        </>
      )}

      {tab === 'couriers' && (
        <>
          <div style={css('display:flex;justify-content:flex-end;margin-bottom:12px;')}>
            <GhostButton icon="add" tone="primary" onClick={() => setEditing({ name: '', active: true, sort_order: 0 })}>
              Add courier
            </GhostButton>
          </div>
          <DataTable
            columns={courierCols}
            rows={couriers ?? []}
            loading={cLoading}
            getId={(c) => c.id}
            onRowClick={(c) => setEditing(c)}
            empty={<EmptyState icon="local_shipping" title="No couriers yet" sub="Add the couriers your sellers ship with." />}
          />
        </>
      )}

      {tab === 'shiprocket' && (
        <>
          {switches === null ? (
            <Card style="padding:16px 18px;margin-bottom:14px;">
              <div style={css(`font-size:13px;color:${T.muted};line-height:1.6;`)}>
                Migrations <strong>0066</strong> and <strong>0067</strong> have not been applied to this database yet,
                so there is nothing to switch. Apply them in the Supabase SQL editor first — see
                SHIPROCKET_INTEGRATION_2026-08-10.md.
              </div>
            </Card>
          ) : (
            <Card style="padding:16px 18px;margin-bottom:14px;">
              <div style={css('display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;')}>
                <div style={css('flex:1;min-width:240px;')}>
                  <div style={css('font-weight:800;font-size:14px;')}>Courier booking</div>
                  <div style={css(`font-size:12.5px;color:${T.muted};line-height:1.6;margin-top:4px;`)}>
                    When on, sellers can book a parcel instead of typing a docket number, and a courier scan —
                    not the seller — marks the order delivered. Needs the Edge Functions deployed and a funded
                    Shiprocket wallet. Cash-on-delivery orders are never booked this way.
                  </div>
                </div>
                <GhostButton
                  icon={switches.shiprocket_enabled ? 'toggle_on' : 'toggle_off'}
                  tone={switches.shiprocket_enabled ? 'primary' : undefined}
                  onClick={() => toggleSwitch('shiprocket_enabled', !switches.shiprocket_enabled)}
                >
                  {switches.shiprocket_enabled ? 'On' : 'Off'}
                </GhostButton>
              </div>

              <div style={css(`height:1px;background:${T.field};margin:16px 0;`)} />

              <div style={css('display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;')}>
                <div style={css('flex:1;min-width:240px;')}>
                  <div style={css('font-weight:800;font-size:14px;')}>Cash on delivery</div>
                  <div style={css(`font-size:12.5px;color:${T.muted};line-height:1.6;margin-top:4px;`)}>
                    The master switch. Turning it off refuses every COD checkout across the platform, whatever
                    individual shops have set. New boutiques already default to prepaid — leave this on unless
                    you want to stop cash orders everywhere at once.
                  </div>
                </div>
                <GhostButton
                  icon={switches.cod_enabled ? 'toggle_on' : 'toggle_off'}
                  tone={switches.cod_enabled ? 'primary' : undefined}
                  onClick={() => toggleSwitch('cod_enabled', !switches.cod_enabled)}
                >
                  {switches.cod_enabled ? 'On' : 'Off'}
                </GhostButton>
              </div>
            </Card>
          )}

          <DataTable
            columns={shopCols}
            rows={shops ?? []}
            loading={shLoading}
            getId={(b) => b.id}
            onRowClick={(b) => setShop(b)}
            empty={<EmptyState icon="storefront" title="No boutiques" sub="Boutiques appear here once they sign up." />}
          />
        </>
      )}

      <Drawer
        open={!!shop}
        onClose={() => setShop(null)}
        title={shop?.name ?? 'Boutique'}
        footer={
          <GhostButton icon="save" tone="primary" onClick={persistShop} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </GhostButton>
        }
      >
        <div style={css(label)}>PICKUP LOCATION NICKNAME</div>
        <input
          value={shop?.shiprocket_pickup_location ?? ''}
          onChange={(e) => setShop((s) => (s ? { ...s, shiprocket_pickup_location: e.target.value } : s))}
          placeholder="e.g. mangaimart-coimbatore-01"
          style={css(field)}
        />
        <div style={css(`font-size:12px;color:${T.muted};margin-top:7px;line-height:1.55;`)}>
          Add this shop as a <strong>pickup location</strong> in the Shiprocket panel first, using the address on
          its boutique profile, then paste the nickname Shiprocket gives it here. It must match exactly — booking
          fails otherwise. Sellers never get their own Shiprocket account.
        </div>

        <div style={css('display:flex;align-items:center;gap:10px;margin-top:18px;')}>
          <input
            id="shop-shiprocket"
            type="checkbox"
            checked={shop?.shiprocket_enabled ?? false}
            onChange={(e) => setShop((s) => (s ? { ...s, shiprocket_enabled: e.target.checked } : s))}
            style={css('width:18px;height:18px;accent-color:#D6336C;')}
          />
          <label htmlFor="shop-shiprocket" style={css('font-size:13.5px;font-weight:700;cursor:pointer;')}>
            Let this shop book couriers
          </label>
        </div>
        <div style={css(`font-size:12px;color:${T.muted};margin-top:6px;line-height:1.55;`)}>
          Turning this off leaves the shop on manual docket entry. Parcels already booked keep their tracking.
        </div>
      </Drawer>

      <ConfirmDialog
        open={!!resolving}
        title="Close this dispute?"
        message={
          resolving?.payout_id
            ? `Order ${resolving.order_number} has already been paid out to the boutique. Closing the dispute records it as settled but does not recover the money — that has to be handled separately.`
            : `Order ${resolving?.order_number ?? ''} becomes payable again immediately. Only do this once you are satisfied the parcel actually reached the buyer.`
        }
        confirmLabel="Close dispute"
        busy={busy}
        onConfirm={resolve}
        onCancel={() => setResolving(null)}
      />

      <Drawer
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'Edit courier' : 'Add courier'}
        footer={
          <GhostButton icon="save" tone="primary" onClick={persistCourier} disabled={busy || !editing?.name?.trim()}>
            {busy ? 'Saving…' : 'Save courier'}
          </GhostButton>
        }
      >
        <div style={css(label)}>NAME</div>
        <input
          value={editing?.name ?? ''}
          onChange={(e) => setEditing((s) => ({ ...s, name: e.target.value }))}
          placeholder="e.g. Delhivery"
          style={css(field)}
        />

        <div style={css(label + 'margin-top:16px;')}>TRACKING URL TEMPLATE</div>
        <input
          value={editing?.tracking_url_template ?? ''}
          onChange={(e) => setEditing((s) => ({ ...s, tracking_url_template: e.target.value }))}
          placeholder="https://example.com/track/{awb}"
          style={css(field)}
        />
        <div style={css(`font-size:12px;color:${T.muted};margin-top:7px;line-height:1.55;`)}>
          Put <strong>{'{awb}'}</strong> where the tracking number goes. Leave it blank if this courier’s tracking page
          is a form rather than a link — buyers still see the courier name and docket number, which beats a dead link.
          {preview && <><br />Preview: <span style={css('word-break:break-all;')}>{preview}</span></>}
        </div>

        <div style={css('display:flex;align-items:center;gap:10px;margin-top:18px;')}>
          <input
            id="courier-active"
            type="checkbox"
            checked={editing?.active ?? true}
            onChange={(e) => setEditing((s) => ({ ...s, active: e.target.checked }))}
            style={css('width:18px;height:18px;accent-color:#D6336C;')}
          />
          <label htmlFor="courier-active" style={css('font-size:13.5px;font-weight:700;cursor:pointer;')}>
            Offer this courier to sellers
          </label>
        </div>
        <div style={css(`font-size:12px;color:${T.muted};margin-top:6px;line-height:1.55;`)}>
          Hiding a courier only removes it from the seller’s dropdown. Parcels already sent with it keep their name.
        </div>

        <div style={css(label + 'margin-top:18px;')}>SORT ORDER</div>
        <input
          type="number"
          value={editing?.sort_order ?? 0}
          onChange={(e) => setEditing((s) => ({ ...s, sort_order: Number(e.target.value) }))}
          style={css(field)}
        />
      </Drawer>
    </div>
  );
}
