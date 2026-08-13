import { useMemo, useRef, useState } from 'react';
import { css } from '@/lib/css';
import { useShop } from '@/state/ShopContext';
import { useAsync } from '@/hooks/useAsync';
import {
  T, Card, DataTable, EmptyState, GhostButton, IconButton, Icon,
  SearchInput, Select, StatusPill, Drawer, ConfirmDialog, type Column,
} from '@/components/admin/kit';
import {
  fetchAllTaxonomy, setTaxonomyStatus, createTaxonomy, updateTaxonomy, deleteTaxonomy,
  uploadTaxonomyImage, countProductsUsing, KIND_LABEL, type TaxonomyKind, type TaxonomyRow,
} from '@/data/taxonomy';
import { CROP, useImageCropper } from '@/components/ui/ImageCropper';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { useSeededSearch } from '@/hooks/useSeededSearch';

/**
 * Catalogue vocabulary — the words the whole marketplace shops by.
 *
 * Sellers pick categories, occasions and fabrics from a managed list rather
 * than typing them, so this page is where that list is decided. Two jobs, in
 * the order they matter:
 *
 *   1. **The queue.** A seller asked for a name that does not exist. Their
 *      product is already live under it — what is waiting is whether buyers can
 *      *browse* by it. Approving adds a collection tile and a filter chip
 *      everywhere at once; rejecting asks them to pick the closest existing one
 *      and needs a reason, because "no" with no explanation leaves them nothing
 *      to act on.
 *   2. **The list.** Rename, retire, or add a term directly. Retiring shows the
 *      live product count first: pulling "Sarees" while sixty listings sit
 *      under it would strand every one of them.
 */

const KINDS: TaxonomyKind[] = ['category', 'occasion', 'fabric', 'color', 'size'];

/** The two vocabularies the buyer app draws as picture tiles. */
const HAS_TILE_ART = (kind: TaxonomyKind) => kind === 'category' || kind === 'occasion';

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

/**
 * The picture a category or occasion is drawn with on the buyer side — the
 * Home circle rail and the Collections tiles.
 *
 * This replaced a "type a Material Symbols icon name" box, which asked an admin
 * to know an icon font's vocabulary by heart and, when they guessed wrong, drew
 * nothing at all. A photograph is also simply the better tile: these are
 * garments, and the buyer is shopping with their eyes.
 *
 * Optional throughout. With no upload the tile falls back to a photo of
 * something actually listed under the term (see @/lib/collections), so a
 * category approved this morning is never a blank square.
 */
function TilePicker({
  kind,
  value,
  onChange,
  onError,
}: {
  kind: TaxonomyKind;
  value: string;
  onChange: (url: string) => void;
  onError: (message: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const { cropImage, cropper } = useImageCropper();

  const pick = async (picked: File | undefined) => {
    // 4:5 is what the Collections grid draws, and the Home circle takes its
    // centre — so framing here settles both.
    const file = await cropImage(picked, CROP.tile);
    if (!file) return;
    setUploading(true);
    try {
      onChange(await uploadTaxonomyImage(kind, file));
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Photo upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      {cropper}
      <div style={css('font-size:13px;font-weight:700;color:var(--ag-label);')}>Tile picture — optional</div>
      <div style={css('display:flex;gap:12px;align-items:flex-start;margin-top:8px;')}>
        {/* 4:5, the aspect the Collections tiles crop to. */}
        <button
          type="button"
          onClick={() => input.current?.click()}
          style={css(`width:104px;height:130px;flex:none;border-radius:16px;border:2px dashed ${value ? 'transparent' : 'var(--ag-border)'};background:${value ? 'var(--ag-surface)' : 'var(--ag-surface-2)'};position:relative;overflow:hidden;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:0;`)}
        >
          {value ? (
            <img src={value} alt="" style={css('position:absolute;inset:0;width:100%;height:100%;object-fit:cover;')} />
          ) : (
            <>
              <Icon name={uploading ? 'progress_activity' : 'add_photo_alternate'} size={26} color={T.accent2} />
              <span style={css('font-size:11px;color:var(--ag-muted-soft);font-weight:700;')}>
                {uploading ? 'Uploading…' : 'Upload'}
              </span>
            </>
          )}
          <input
            ref={input}
            type="file"
            accept="image/*"
            style={css('display:none;')}
            onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }}
          />
        </button>

        <div style={css('flex:1;min-width:0;')}>
          <div style={css(`color:${T.muted};font-size:12.5px;line-height:1.6;`)}>
            Shown on the Home rail and the Collections page. A tall, well-lit shot
            of the garment works best — it is cropped to a circle on Home and to
            4:5 on the collections grid.
          </div>
          {value && (
            <div style={css('margin-top:10px;display:flex;gap:8px;')}>
              <GhostButton icon="swap_horiz" onClick={() => input.current?.click()}>Replace</GhostButton>
              <GhostButton icon="delete" tone="danger" onClick={() => onChange('')}>Remove</GhostButton>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

type WithBoutique = TaxonomyRow & { boutique?: { name: string } | null };

export function Catalogue() {
  const { showToast } = useShop();
  const { data, loading, reload } = useAsync(() => fetchAllTaxonomy(), []);

  const [kind, setKind] = useState<'all' | TaxonomyKind>('all');
  const [query, setQuery] = useSeededSearch();
  const [review, setReview] = useState<WithBoutique | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [busy, setBusy] = useState(false);

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ kind: 'category' as TaxonomyKind, name: '', hex: '', imageUrl: '' });

  const [retire, setRetire] = useState<{ row: TaxonomyRow; uses: number } | null>(null);
  // One edit drawer rather than a rename-only one: the thing an admin most
  // often wants to change about an existing category is its picture.
  const [edit, setEdit] = useState<TaxonomyRow | null>(null);
  const [editDraft, setEditDraft] = useState({ name: '', hex: '', imageUrl: '' });

  // Memoised so `live` below is not recomputed on every keystroke elsewhere —
  // `data ?? []` is a fresh array each render otherwise.
  const all = useMemo(() => (data ?? []) as WithBoutique[], [data]);
  const pending = all.filter((r) => r.status === 'pending');

  const live = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all
      .filter((r) => r.status !== 'pending')
      .filter((r) => kind === 'all' || r.kind === kind)
      .filter((r) => !q || r.name.toLowerCase().includes(q))
      .sort((a, b) => a.kind.localeCompare(b.kind) || a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  }, [all, kind, query]);

  const decide = async (row: TaxonomyRow, status: 'approved' | 'rejected', note?: string) => {
    if (status === 'rejected' && !note?.trim()) {
      showToast('Add a reason — the seller needs something to act on');
      return;
    }
    setBusy(true);
    try {
      await setTaxonomyStatus(row.id, status, note);
      showToast(
        status === 'approved'
          ? `“${row.name}” is now live for buyers to browse`
          : `“${row.name}” turned down`,
      );
      setReview(null);
      setReviewNote('');
      reload();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  };

  const askRetire = async (row: TaxonomyRow) => {
    try {
      setRetire({ row, uses: await countProductsUsing(row.kind, row.name) });
    } catch {
      setRetire({ row, uses: 0 });
    }
  };

  const doRetire = async () => {
    if (!retire) return;
    setBusy(true);
    try {
      await deleteTaxonomy(retire.row.id);
      showToast(`“${retire.row.name}” removed from the list`);
      setRetire(null);
      reload();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not remove it');
    } finally {
      setBusy(false);
    }
  };

  const openEdit = (row: TaxonomyRow) => {
    setEdit(row);
    setEditDraft({ name: row.name, hex: row.hex ?? '', imageUrl: row.image_url ?? '' });
  };

  const doEdit = async () => {
    if (!edit || !editDraft.name.trim()) return;
    setBusy(true);
    try {
      await updateTaxonomy(edit.id, {
        name: editDraft.name.trim(),
        hex: edit.kind === 'color' ? editDraft.hex || null : edit.hex,
        image_url: HAS_TILE_ART(edit.kind) ? editDraft.imageUrl || null : edit.image_url,
      });
      showToast('Saved');
      setEdit(null);
      reload();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const doAdd = async () => {
    if (draft.name.trim().length < 2) {
      showToast('Enter a name');
      return;
    }
    setBusy(true);
    try {
      await createTaxonomy({
        kind: draft.kind,
        name: draft.name,
        hex: draft.kind === 'color' ? draft.hex || null : null,
        imageUrl: HAS_TILE_ART(draft.kind) ? draft.imageUrl || null : null,
      });
      showToast(`“${draft.name.trim()}” added`);
      setAdding(false);
      setDraft({ kind: 'category', name: '', hex: '', imageUrl: '' });
      reload();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not add it');
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<WithBoutique>[] = [
    {
      key: 'name',
      header: 'Term',
      width: '2fr',
      render: (r) => (
        <span style={css('display:flex;align-items:center;gap:9px;min-width:0;')}>
          {r.hex ? (
            <span style={css(`width:20px;height:20px;flex:none;border-radius:50%;background:${r.hex};box-shadow:0 0 0 1px ${T.field};`)} />
          ) : r.image_url ? (
            <img src={r.image_url} alt="" style={css(`width:28px;height:28px;flex:none;border-radius:8px;object-fit:cover;box-shadow:0 0 0 1px ${T.field};`)} />
          ) : HAS_TILE_ART(r.kind) ? (
            // No picture yet — the buyer tile falls back to a photo of something
            // listed under it, so this is a nudge rather than a fault.
            <span style={css(`width:28px;height:28px;flex:none;border-radius:8px;background:${T.head};display:flex;align-items:center;justify-content:center;`)} title="No tile picture yet">
              <Icon name="image" size={15} color="#C3A7B4" />
            </span>
          ) : null}
          <span style={css('font-weight:700;font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;')}>{r.name}</span>
        </span>
      ),
    },
    { key: 'kind', header: 'List', width: '110px', render: (r) => <span style={css(`color:${T.muted};font-size:13px;`)}>{KIND_LABEL[r.kind]}</span> },
    { key: 'status', header: 'Status', width: '110px', render: (r) => <StatusPill status={r.status} /> },
    {
      key: 'origin',
      header: 'Added by',
      width: '1.2fr',
      render: (r) => (
        <span style={css(`color:${T.muted};font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`)}>
          {r.boutique?.name ?? (r.requested_by ? 'A seller' : 'MangaiMart')}
        </span>
      ),
    },
    { key: 'created', header: 'Added', width: '120px', render: (r) => <span style={css(`color:${T.muted};font-size:12.5px;`)}>{fmtDate(r.created_at)}</span> },
    {
      key: 'actions',
      header: '',
      width: '96px',
      align: 'right',
      render: (r) => (
        <span style={css('display:flex;gap:6px;justify-content:flex-end;')}>
          <IconButton icon="edit" title="Edit name and picture" onClick={() => openEdit(r)} />
          <IconButton icon="delete" tone="danger" title="Remove from the list" onClick={() => askRetire(r)} />
        </span>
      ),
    },
  ];

  return (
    <div>
      {/* ── The queue ──────────────────────────────────────────────────── */}
      <Card style="margin-bottom:16px;">
        <div style={css('display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;')}>
          <div>
            <div style={css('font-weight:800;font-size:15px;display:flex;align-items:center;gap:9px;')}>
              Requests from sellers
              {pending.length > 0 && (
                <span style={css('min-width:22px;height:22px;padding:0 7px;border-radius:11px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-size:12px;display:inline-flex;align-items:center;justify-content:center;')}>
                  {pending.length}
                </span>
              )}
            </div>
            <div style={css(`color:${T.muted};font-size:12.5px;margin-top:4px;line-height:1.5;max-width:620px;`)}>
              Their product is already live under the requested name. What you are deciding is whether buyers get a collection tile and a filter chip for it.
            </div>
          </div>
          <GhostButton icon="add" tone="primary" onClick={() => setAdding(true)}>Add a term</GhostButton>
        </div>

        <div style={css('margin-top:16px;')}>
          {loading && <SkeletonRows rows={3} height={62} thumb={false} label="Loading requests…" />}

          {!loading && pending.length === 0 && (
            <EmptyState icon="inbox" title="Nothing waiting" sub="Seller requests for a new category, occasion or fabric land here." />
          )}

          <div style={css('display:flex;flex-direction:column;gap:10px;')}>
            {pending.map((r) => (
              <div
                key={r.id}
                style={css(`display:flex;align-items:center;gap:14px;padding:14px 16px;border:1.5px solid ${T.field};border-radius:14px;background:var(--ag-surface-2);flex-wrap:wrap;`)}
              >
                <span style={css(`width:38px;height:38px;flex:none;border-radius:11px;background:${T.head};display:flex;align-items:center;justify-content:center;`)}>
                  <Icon name={r.kind === 'fabric' ? 'texture' : r.kind === 'occasion' ? 'celebration' : 'checkroom'} size={19} color={T.accent} />
                </span>
                <span style={css('min-width:140px;flex:1;')}>
                  <span style={css('display:block;font-weight:800;font-size:14.5px;')}>{r.name}</span>
                  <span style={css(`display:block;color:${T.muted};font-size:12px;margin-top:2px;`)}>
                    {KIND_LABEL[r.kind]} · {r.boutique?.name ?? 'a seller'} · {fmtDate(r.created_at)}
                  </span>
                </span>
                {r.note && <span style={css(`flex:1;min-width:180px;color:${T.muted};font-size:12.5px;font-style:italic;`)}>“{r.note}”</span>}
                <span style={css('display:flex;gap:8px;')}>
                  <GhostButton icon="close" onClick={() => { setReview(r); setReviewNote(''); }}>Turn down</GhostButton>
                  <GhostButton icon="check" tone="primary" onClick={() => decide(r, 'approved')}>Approve</GhostButton>
                </span>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* ── The list ───────────────────────────────────────────────────── */}
      <div style={css('display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap;')}>
        <SearchInput value={query} onChange={setQuery} placeholder="Search terms…" />
        <Select
          value={kind}
          onChange={(v) => setKind(v as 'all' | TaxonomyKind)}
          options={[{ value: 'all', label: 'All lists' }, ...KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))]}
        />
      </div>

      <DataTable
        columns={columns}
        rows={live}
        loading={loading}
        getId={(r) => r.id}
        empty={<EmptyState icon="sell" title="No terms yet" sub="Apply migration 0024, or add the first one above." />}
      />

      {/* ── Turn down, with a reason ───────────────────────────────────── */}
      <Drawer
        open={!!review}
        onClose={() => setReview(null)}
        title={review ? `Turn down “${review.name}”` : ''}
        footer={
          <div style={css('display:flex;gap:10px;')}>
            <GhostButton onClick={() => setReview(null)}>Cancel</GhostButton>
            <div style={css('flex:1;')} />
            <GhostButton icon="block" tone="danger" onClick={() => review && decide(review, 'rejected', reviewNote)}>
              {busy ? 'Working…' : 'Turn down'}
            </GhostButton>
          </div>
        }
      >
        <div style={css(`color:${T.muted};font-size:13.5px;line-height:1.6;`)}>
          The seller sees this on their product form, so write it as advice: which existing term should they use instead?
        </div>
        <textarea
          value={reviewNote}
          onChange={(e) => setReviewNote(e.target.value)}
          autoFocus
          placeholder="e.g. Please list this under “Sarees” — we keep fabric detail in the Fabric field."
          style={css(`width:100%;margin-top:14px;min-height:120px;border:1.5px solid ${T.field};border-radius:14px;padding:12px 14px;font-size:13.5px;font-family:inherit;resize:vertical;color:var(--ag-ink);`)}
        />
      </Drawer>

      {/* ── Add a term directly ────────────────────────────────────────── */}
      <Drawer
        open={adding}
        onClose={() => setAdding(false)}
        title="Add a term"
        footer={
          <div style={css('display:flex;gap:10px;')}>
            <GhostButton onClick={() => setAdding(false)}>Cancel</GhostButton>
            <div style={css('flex:1;')} />
            <GhostButton icon="check" tone="primary" onClick={doAdd}>{busy ? 'Adding…' : 'Add'}</GhostButton>
          </div>
        }
      >
        <div style={css('display:flex;flex-direction:column;gap:14px;')}>
          <label style={css('font-size:13px;font-weight:700;color:var(--ag-label);')}>
            List
            <div style={css('margin-top:6px;')}>
              <Select
                value={draft.kind}
                onChange={(v) => setDraft({ ...draft, kind: v as TaxonomyKind })}
                options={KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))}
              />
            </div>
          </label>
          <label style={css('font-size:13px;font-weight:700;color:var(--ag-label);')}>
            Name
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="e.g. Dupattas"
              style={css(`width:100%;margin-top:6px;height:48px;border:1.5px solid ${T.field};border-radius:13px;padding:0 14px;font-size:14px;font-weight:600;font-family:inherit;color:var(--ag-ink);`)}
            />
          </label>
          {draft.kind === 'color' && (
            <label style={css('font-size:13px;font-weight:700;color:var(--ag-label);')}>
              Swatch — buyers filter by this dot, so it has to look like the cloth
              <div style={css('display:flex;gap:10px;align-items:center;margin-top:6px;')}>
                <input
                  type="color"
                  value={draft.hex || '#E7719F'}
                  onChange={(e) => setDraft({ ...draft, hex: e.target.value })}
                  style={css(`width:52px;height:48px;border:1.5px solid ${T.field};border-radius:13px;background:var(--ag-surface);cursor:pointer;padding:4px;`)}
                />
                <input
                  value={draft.hex}
                  onChange={(e) => setDraft({ ...draft, hex: e.target.value })}
                  placeholder="#E7719F"
                  style={css(`flex:1;height:48px;border:1.5px solid ${T.field};border-radius:13px;padding:0 14px;font-size:14px;font-weight:600;font-family:'IBM Plex Mono',monospace;color:var(--ag-ink);`)}
                />
              </div>
            </label>
          )}
          {HAS_TILE_ART(draft.kind) && (
            <TilePicker
              kind={draft.kind}
              value={draft.imageUrl}
              onChange={(url) => setDraft({ ...draft, imageUrl: url })}
              onError={showToast}
            />
          )}
        </div>
      </Drawer>

      {/* ── Edit an existing term ──────────────────────────────────────── */}
      <Drawer
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit ? `Edit “${edit.name}”` : ''}
        footer={
          <div style={css('display:flex;gap:10px;')}>
            <GhostButton onClick={() => setEdit(null)}>Cancel</GhostButton>
            <div style={css('flex:1;')} />
            <GhostButton icon="check" tone="primary" onClick={doEdit}>{busy ? 'Saving…' : 'Save'}</GhostButton>
          </div>
        }
      >
        <div style={css('display:flex;flex-direction:column;gap:14px;')}>
          <label style={css('font-size:13px;font-weight:700;color:var(--ag-label);')}>
            Name
            <input
              value={editDraft.name}
              onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })}
              autoFocus
              style={css(`width:100%;margin-top:6px;height:48px;border:1.5px solid ${T.field};border-radius:13px;padding:0 14px;font-size:14px;font-weight:600;font-family:inherit;color:var(--ag-ink);`)}
            />
            <span style={css(`display:block;color:${T.muted};font-size:12px;margin-top:6px;line-height:1.5;`)}>
              Renaming changes the browsing term only — products already listed keep
              the old spelling on their record. Correct a typo here; do not repurpose
              a term that has stock under it.
            </span>
          </label>

          {edit?.kind === 'color' && (
            <label style={css('font-size:13px;font-weight:700;color:var(--ag-label);')}>
              Swatch
              <div style={css('display:flex;gap:10px;align-items:center;margin-top:6px;')}>
                <input
                  type="color"
                  value={editDraft.hex || '#E7719F'}
                  onChange={(e) => setEditDraft({ ...editDraft, hex: e.target.value })}
                  style={css(`width:52px;height:48px;border:1.5px solid ${T.field};border-radius:13px;background:var(--ag-surface);cursor:pointer;padding:4px;`)}
                />
                <input
                  value={editDraft.hex}
                  onChange={(e) => setEditDraft({ ...editDraft, hex: e.target.value })}
                  placeholder="#E7719F"
                  style={css(`flex:1;height:48px;border:1.5px solid ${T.field};border-radius:13px;padding:0 14px;font-size:14px;font-weight:600;font-family:'IBM Plex Mono',monospace;color:var(--ag-ink);`)}
                />
              </div>
            </label>
          )}

          {edit && HAS_TILE_ART(edit.kind) && (
            <TilePicker
              kind={edit.kind}
              value={editDraft.imageUrl}
              onChange={(url) => setEditDraft({ ...editDraft, imageUrl: url })}
              onError={showToast}
            />
          )}
        </div>
      </Drawer>

      <ConfirmDialog
        open={!!retire}
        title={`Remove “${retire?.row.name ?? ''}”?`}
        message={
          retire && retire.uses > 0
            ? `${retire.uses} live ${retire.uses === 1 ? 'product is' : 'products are'} listed under this. They stay on sale and stay searchable, but buyers lose the tile and the filter chip for them.`
            : 'Nothing is listed under this term, so removing it costs nothing.'
        }
        confirmLabel="Remove"
        danger
        busy={busy}
        onCancel={() => setRetire(null)}
        onConfirm={doRetire}
      />
    </div>
  );
}
