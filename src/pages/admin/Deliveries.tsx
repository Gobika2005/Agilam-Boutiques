import { useState } from 'react';
import { css } from '@/lib/css';
import { useShop } from '@/state/ShopContext';
import { useAsync } from '@/hooks/useAsync';
import {
  T, Card, DataTable, EmptyState, GhostButton, IconButton, StatusPill,
  Drawer, ConfirmDialog, type Column,
} from '@/components/admin/kit';
import { fmt } from '@/data/demo';
import {
  fetchAllCouriers, saveCourier, fetchDeliveryDisputes, resolveDeliveryDispute,
  fetchStalledShipments, buildTrackingUrl,
  type Courier, type DeliveryIssueRow, type StalledShipmentRow,
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
 */

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

const daysSince = (iso: string | null) =>
  iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : 0;

type Tab = 'disputes' | 'stalled' | 'couriers';

export function Deliveries() {
  const { showToast } = useShop();
  const [tab, setTab] = useState<Tab>('disputes');

  const { data: disputes, loading: dLoading, reload: reloadDisputes } = useAsync(fetchDeliveryDisputes, []);
  const { data: stalled, loading: sLoading } = useAsync(() => fetchStalledShipments(10), []);
  const { data: couriers, loading: cLoading, reload: reloadCouriers } = useAsync(fetchAllCouriers, []);

  const [resolving, setResolving] = useState<DeliveryIssueRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Partial<Courier> | null>(null);

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

  const tabBtn = (key: Tab, label: string, count?: number) => (
    <button
      key={key}
      onClick={() => setTab(key)}
      style={css(`height:38px;padding:0 15px;border-radius:11px;border:1.5px solid ${tab === key ? T.accent2 : T.field};background:${tab === key ? 'var(--ag-surface-2)' : 'var(--ag-surface)'};color:${tab === key ? T.accent : T.muted};font-weight:800;font-size:13px;cursor:pointer;font-family:inherit;display:flex;align-items:center;gap:7px;`)}
    >
      {label}
      {count != null && count > 0 && (
        <span style={css(`min-width:20px;height:20px;padding:0 6px;border-radius:999px;background:${T.accent2};color:#fff;font-size:11px;display:flex;align-items:center;justify-content:center;`)}>{count}</span>
      )}
    </button>
  );

  const preview = editing?.tracking_url_template
    ? buildTrackingUrl(editing.tracking_url_template, '1234567890')
    : null;

  const field = `width:100%;height:44px;border-radius:11px;border:1.5px solid ${T.field};background:var(--ag-bg);color:${T.ink};padding:0 13px;font-size:14px;font-family:inherit;box-sizing:border-box;`;
  const label = `font-size:11.5px;font-weight:800;color:${T.muted};letter-spacing:.05em;margin-bottom:6px;`;

  return (
    <div>
      <div style={css('display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px;')}>
        {tabBtn('disputes', 'Disputes', disputes?.length ?? 0)}
        {tabBtn('stalled', 'Stalled parcels', stalled?.length ?? 0)}
        {tabBtn('couriers', 'Couriers')}
      </div>

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
