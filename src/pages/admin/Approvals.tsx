import { useEffect, useState } from 'react';
import { css } from '@/lib/css';
import { useShop } from '@/state/ShopContext';
import { TONES } from '@/data/demo';
import { useAsync } from '@/hooks/useAsync';
import { fetchAllBoutiquesAdmin, setBoutiqueStatus, fetchBoutiquePrivate, type AdminBoutiqueRow } from '@/data/boutiques';
import { registerShiprocketPickup } from '@/data/shipments';
import { BOUTIQUE_STATUS_LABEL, type BoutiquePrivate, type BoutiqueStatus } from '@/data/types';
import { Skeleton } from '@/components/ui/Skeleton';

/**
 * Seller verification queue.
 *
 * An admin cannot responsibly approve a boutique from a name and a city, so
 * selecting a row opens the full application — everything the seven-step setup
 * wizard collected, including the GST and payout fields that migration 0021
 * withholds from the public API (read here through `boutique_private`).
 *
 * Three outcomes match the seller-side status screen: approve, send back a
 * correction list, or reject with a reason. The last two require a note — being
 * turned down with no explanation leaves the seller nothing to act on.
 */

const GRID = 'display:grid;grid-template-columns:2fr 1.2fr 1.4fr 1fr 1.2fr;';

type Tab = 'pending' | 'changes_requested' | 'draft' | 'approved' | 'rejected';

const TAB_ORDER: Tab[] = ['pending', 'changes_requested', 'draft', 'approved', 'rejected'];

const STATUS_CHIP: Record<BoutiqueStatus, { bg: string; fg: string }> = {
  draft: { bg: 'var(--ag-surface-2)', fg: 'var(--ag-muted)' },
  pending: { bg: 'var(--ag-warn-bg)', fg: 'var(--ag-warn-text)' },
  changes_requested: { bg: 'var(--ag-gold-bg)', fg: 'var(--ag-gold-text)' },
  approved: { bg: 'var(--ag-good-bg)', fg: 'var(--ag-good-text)' },
  rejected: { bg: 'var(--ag-bad-bg)', fg: 'var(--ag-bad-text)' },
};

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

export function Approvals() {
  const { showToast } = useShop();
  const [tab, setTab] = useState<Tab>('pending');
  const [selected, setSelected] = useState<AdminBoutiqueRow | null>(null);
  const { data: rows, loading, reload } = useAsync(() => fetchAllBoutiquesAdmin(), []);

  const all = rows ?? [];
  const list = all.filter((b) => b.status === tab);

  const decide = async (b: AdminBoutiqueRow, status: BoutiqueStatus, note?: string) => {
    try {
      await setBoutiqueStatus(b.id, status, note);
      showToast(`${b.name} — ${BOUTIQUE_STATUS_LABEL[status].toLowerCase()}`);
      setSelected(null);
      reload();

      /*
       * Approval is the moment a shop becomes real, so it is also the moment to
       * give it a collection point at Shiprocket (migration 0068) — rather than
       * leaving an admin to retype the address into their panel later.
       *
       * Deliberately AFTER the approval has been reported and never allowed to
       * throw: a courier account being unreachable must not make an approval
       * look like it failed. The shop is approved either way, and the
       * registration is retryable from Deliveries → Shiprocket.
       */
      if (status === 'approved') {
        void registerShiprocketPickup(b.id)
          .then((r) => {
            if (!r.alreadyRegistered) showToast(`Pickup address registered — ${r.nickname}`);
          })
          .catch((e) => {
            // Not silent: the admin needs to know it did not happen, but the
            // reason belongs in the console where it persists.
            showToast(`Pickup address not registered: ${e instanceof Error ? e.message : 'failed'}`);
          });
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Update failed');
    }
  };

  return (
    <div>
      <div style={css('display:flex;gap:9px;margin-bottom:16px;flex-wrap:wrap;')}>
        {TAB_ORDER.map((key) => {
          const on = tab === key;
          const count = all.filter((b) => b.status === key).length;
          return (
            <button
              key={key}
              onClick={() => setTab(key)}
              style={css(`padding:8px 16px;border:none;border-radius:999px;font-size:13px;font-weight:700;cursor:pointer;background:${on ? 'var(--ag-crimson)' : 'var(--ag-surface)'};color:${on ? '#fff' : 'var(--ag-label)'};font-family:inherit;`)}
            >
              {BOUTIQUE_STATUS_LABEL[key]} · {count}
            </button>
          );
        })}
      </div>

      <div style={css('background:var(--ag-surface);border-radius:18px;overflow:hidden;box-shadow:0 12px 30px -24px rgba(107,20,54,.6);')}>
        <div className="agx-adm-tablewrap">
        <div className="agx-adm-tablegrid">
        <div style={css(`${GRID}padding:14px 20px;background:var(--ag-surface-2);font-size:12px;font-weight:800;color:var(--ag-muted);letter-spacing:.04em;`)}>
          <span>BOUTIQUE</span><span>CITY</span><span>OWNER</span><span>SUBMITTED</span><span style={css('text-align:right;')}>ACTION</span>
        </div>

        {loading && (
          <div role="status" aria-busy="true">
            <span className="agx-visually-hidden">Loading boutiques…</span>
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} style={css(`${GRID}padding:16px 20px;border-top:1px solid var(--ag-border-soft);align-items:center;`)}>
                {Array.from({ length: 5 }, (_, j) => <Skeleton key={j} w={`${58 + ((i * 11 + j * 17) % 30)}%`} />)}
              </div>
            ))}
          </div>
        )}
        {!loading && list.length === 0 && (
          <div style={css('padding:20px;color:var(--ag-muted);font-size:13.5px;')}>
            No boutiques in “{BOUTIQUE_STATUS_LABEL[tab]}”.
          </div>
        )}

        {list.map((a, i) => (
          <div key={a.id} style={css(`${GRID}padding:14px 20px;align-items:center;border-top:1px solid var(--ag-border-soft);`)}>
            <div style={css('display:flex;align-items:center;gap:10px;min-width:0;')}>
              <div style={css(`width:36px;height:36px;flex:none;border-radius:11px;overflow:hidden;background:${TONES[a.tone ?? i % TONES.length]};display:flex;align-items:center;justify-content:center;font-family:'Playfair Display',serif;font-weight:700;color:rgba(42,26,32,.5);`)}>
                {a.logo_url ? <img src={a.logo_url} alt="" style={css('width:100%;height:100%;object-fit:cover;')} /> : a.name.charAt(0)}
              </div>
              <span style={css('font-weight:700;font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;')}>{a.name}</span>
            </div>
            <span style={css('font-size:13px;color:var(--ag-label);')}>{a.city || '—'}</span>
            <span style={css('font-size:13px;color:var(--ag-label);')}>{a.owner_name || a.owner?.full_name || '—'}</span>
            <span style={css('font-size:12.5px;color:var(--ag-muted);')}>{fmtDate(a.submitted_at)}</span>
            <div style={css('display:flex;justify-content:flex-end;')}>
              <button
                onClick={() => setSelected(a)}
                style={css('height:34px;padding:0 14px;border-radius:10px;border:1.5px solid var(--ag-border);background:var(--ag-surface);color:var(--ag-crimson);font-weight:800;font-size:12.5px;cursor:pointer;font-family:inherit;')}
              >
                Review
              </button>
            </div>
          </div>
        ))}
        </div>
        </div>
      </div>

      {selected && <ReviewDrawer boutique={selected} onClose={() => setSelected(null)} onDecide={decide} />}
    </div>
  );
}

/** The full application, plus the three decisions an admin can record. */
function ReviewDrawer({
  boutique, onClose, onDecide,
}: {
  boutique: AdminBoutiqueRow;
  onClose: () => void;
  onDecide: (b: AdminBoutiqueRow, status: BoutiqueStatus, note?: string) => void;
}) {
  const [priv, setPriv] = useState<BoutiquePrivate | null>(null);
  const [note, setNote] = useState('');
  const [asking, setAsking] = useState<'changes_requested' | 'rejected' | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchBoutiquePrivate(boutique.id)
      .then((p) => { if (!cancelled) setPriv(p); })
      .catch(() => { /* the private block simply stays empty */ });
    return () => { cancelled = true; };
  }, [boutique.id]);

  const chip = STATUS_CHIP[boutique.status];
  const dash = (v: string | number | null | undefined) => (v === null || v === undefined || v === '' ? '—' : String(v));

  const groups: { title: string; rows: [string, string][] }[] = [
    {
      title: 'Boutique',
      rows: [
        ['Name', dash(boutique.name)],
        ['Owner', dash(boutique.owner_name || boutique.owner?.full_name)],
        ['Category', dash(boutique.category)],
        ['Bio', dash(boutique.description)],
        ['Years in business', dash(boutique.years_in_business)],
      ],
    },
    {
      title: 'Contact',
      rows: [
        ['Mobile', dash(boutique.phone)],
        ['WhatsApp', dash(boutique.whatsapp)],
        ['Email', dash(boutique.email)],
        ['Instagram', boutique.instagram ? `@${boutique.instagram}` : '—'],
      ],
    },
    {
      title: 'Address',
      rows: [
        ['Shop address', dash(boutique.address_line)],
        ['Area', dash(boutique.area)],
        ['City / district', `${dash(boutique.city)} · ${dash(boutique.district)}`],
        ['State / pincode', `${dash(boutique.state)} · ${dash(boutique.pincode)}`],
        ['Map link', dash(boutique.map_url)],
      ],
    },
    {
      title: 'Store settings',
      rows: [
        ['Timing', boutique.open_time && boutique.close_time ? `${boutique.open_time} – ${boutique.close_time}` : '—'],
        ['Working days', boutique.working_days?.length ? boutique.working_days.join(', ') : '—'],
        ['Delivery', boutique.delivery_available ? `${dash(boutique.delivery_areas)} · ₹${boutique.delivery_charge ?? 0}` : 'Store pickup only'],
        ['Payments', [boutique.cod_enabled && 'Cash on delivery', boutique.online_payment_enabled && 'Online'].filter(Boolean).join(', ') || '—'],
      ],
    },
    {
      title: 'Documents & payout (private)',
      rows: [
        ['GST number', dash(priv?.gst_number)],
        ['Registration', dash(priv?.business_reg_number)],
        ['UPI ID', dash(priv?.upi_id)],
        ['Account holder', dash(priv?.bank_account_name)],
        ['Account number', dash(priv?.bank_account_number)],
        ['IFSC', dash(priv?.bank_ifsc)],
      ],
    },
  ];

  const confirm = () => {
    if (!asking) return;
    if (note.trim().length < 5) return;
    setBusy(true);
    onDecide(boutique, asking, note.trim());
  };

  return (
    <div
      onClick={onClose}
      style={css('position:fixed;inset:0;z-index:200;background:rgba(42,26,32,.45);display:flex;justify-content:flex-end;animation:agx-fade .18s ease;')}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={css('width:min(560px,100%);height:100%;background:var(--ag-bg);overflow-y:auto;box-shadow:-24px 0 60px -30px rgba(0,0,0,.6);')}
      >
        <div style={css('position:sticky;top:0;z-index:2;background:linear-gradient(135deg,#8E1C44,#B02454 60%,#D6336C);color:#fff;padding:20px;')}>
          <div style={css('display:flex;align-items:flex-start;gap:12px;')}>
            <div style={css("width:48px;height:48px;flex:none;border-radius:15px;overflow:hidden;background:rgba(255,255,255,.18);display:flex;align-items:center;justify-content:center;font-family:'Playfair Display',serif;font-weight:700;font-size:21px;")}>
              {boutique.logo_url ? <img src={boutique.logo_url} alt="" style={css('width:100%;height:100%;object-fit:cover;')} /> : boutique.name.charAt(0)}
            </div>
            <div style={css('flex:1;min-width:0;')}>
              <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:22px;line-height:1.2;")}>{boutique.name}</div>
              <div style={css('font-size:12.5px;opacity:.85;margin-top:3px;')}>Submitted {fmtDate(boutique.submitted_at)}</div>
              <span style={css(`display:inline-block;margin-top:8px;font-size:11px;font-weight:800;padding:4px 10px;border-radius:8px;background:${chip.bg};color:${chip.fg};`)}>{BOUTIQUE_STATUS_LABEL[boutique.status]}</span>
            </div>
            <button
              onClick={onClose}
              style={css('width:36px;height:36px;flex:none;border-radius:11px;border:1px solid rgba(255,255,255,.28);background:rgba(255,255,255,.14);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;')}
            >
              <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:19px;")}>close</span>
            </button>
          </div>
        </div>

        <div style={css('padding:16px 20px 24px;display:flex;flex-direction:column;gap:14px;')}>
          {priv?.review_note && (
            <div style={css('background:var(--ag-gold-bg);border:1px solid var(--ag-gold-border);border-radius:16px;padding:13px 15px;')}>
              <div style={css('font-size:11.5px;font-weight:800;color:#B9862F;letter-spacing:.04em;')}>PREVIOUS NOTE TO SELLER</div>
              <div style={css('font-size:13px;color:var(--ag-gold-text);font-weight:600;line-height:1.6;margin-top:5px;white-space:pre-wrap;')}>{priv.review_note}</div>
            </div>
          )}

          {groups.map((g) => (
            <div key={g.title} style={css('background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:18px;padding:15px 17px;')}>
              <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:16px;")}>{g.title}</div>
              <div style={css('margin-top:9px;display:flex;flex-direction:column;gap:7px;')}>
                {g.rows.map(([k, v]) => (
                  <div key={k} style={css('display:flex;gap:12px;align-items:baseline;')}>
                    <span style={css('flex:none;width:130px;font-size:11.5px;font-weight:700;color:var(--ag-muted);')}>{k}</span>
                    <span style={css('flex:1;min-width:0;font-size:13px;font-weight:600;color:var(--ag-ink);word-break:break-word;')}>{v}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* Decision --------------------------------------------------- */}
          {asking ? (
            <div style={css('background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:18px;padding:16px 17px;')}>
              <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:16px;")}>
                {asking === 'rejected' ? 'Reason for rejection' : 'What needs changing?'}
              </div>
              <div style={css('font-size:12px;color:var(--ag-muted);font-weight:600;margin-top:3px;')}>
                The seller sees this word for word on their verification screen.
              </div>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                autoFocus
                placeholder={asking === 'rejected'
                  ? 'We could not verify the business registration provided…'
                  : '1. The shop address does not match the map link\n2. Upload a clearer boutique logo'}
                style={css('width:100%;margin-top:11px;border:1.5px solid var(--ag-border);background:var(--ag-surface);border-radius:13px;padding:12px 14px;font-size:14px;font-weight:500;color:var(--ag-ink);box-sizing:border-box;font-family:inherit;resize:vertical;min-height:110px;')}
              />
              <div style={css('display:flex;gap:10px;margin-top:12px;')}>
                <button
                  onClick={() => { setAsking(null); setNote(''); }}
                  disabled={busy}
                  style={css('height:46px;padding:0 18px;border:1.5px solid var(--ag-border);background:var(--ag-surface);color:var(--ag-label);border-radius:13px;font-weight:800;font-size:14px;cursor:pointer;font-family:inherit;')}
                >
                  Cancel
                </button>
                <button
                  onClick={confirm}
                  disabled={busy || note.trim().length < 5}
                  style={css(`flex:1;height:46px;border:none;border-radius:13px;background:${asking === 'rejected' ? 'var(--ag-bad-text)' : 'var(--ag-gold-text)'};color:#fff;font-weight:800;font-size:14px;cursor:pointer;opacity:${busy || note.trim().length < 5 ? 0.55 : 1};font-family:inherit;`)}
                >
                  {busy ? 'Saving…' : asking === 'rejected' ? 'Reject boutique' : 'Send correction list'}
                </button>
              </div>
            </div>
          ) : (
            <div style={css('display:flex;gap:10px;flex-wrap:wrap;')}>
              <button
                onClick={() => setAsking('rejected')}
                style={css('flex:1;min-width:130px;height:48px;border:1.5px solid var(--ag-border);background:var(--ag-surface);color:var(--ag-bad-text);border-radius:13px;font-weight:800;font-size:14px;cursor:pointer;font-family:inherit;')}
              >
                Reject
              </button>
              <button
                onClick={() => setAsking('changes_requested')}
                style={css('flex:1;min-width:130px;height:48px;border:1.5px solid var(--ag-gold-border);background:var(--ag-surface);color:#B9862F;border-radius:13px;font-weight:800;font-size:14px;cursor:pointer;font-family:inherit;')}
              >
                Needs changes
              </button>
              <button
                onClick={() => onDecide(boutique, 'approved')}
                style={css('flex:1;min-width:130px;height:48px;border:none;background:var(--ag-good-text);color:#fff;border-radius:13px;font-weight:800;font-size:14px;cursor:pointer;font-family:inherit;')}
              >
                Approve
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
