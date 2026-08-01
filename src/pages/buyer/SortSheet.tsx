import { useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
import { useDismissOnEscape } from '@/hooks/useDismissOnEscape';
import { useShop } from '@/state/ShopContext';
import { SORTS } from '@/data/demo';

/** Bottom-sheet sort picker, shown over the results screen on mobile. */
export function SortSheet() {
  const navigate = useNavigate();
  const { filters, setSort } = useShop();

  const close = () => navigate('/buyer/results');
  useDismissOnEscape(close);

  return (
    <div style={css('position:fixed;inset:0;z-index:120;')}>
      <div onClick={close} style={css('position:absolute;inset:0;background:rgba(42,10,24,.45);backdrop-filter:blur(4px);animation:agx-fade .2s ease;')} />
      <div className="agx-scroll" style={css('position:absolute;left:0;right:0;bottom:0;max-height:88%;overflow-y:auto;background:var(--ag-surface);border-radius:28px 28px 0 0;padding:14px 22px 24px;animation:agx-sheet .28s cubic-bezier(.2,.9,.3,1);')}>
        <div style={css('width:44px;height:5px;border-radius:3px;background:var(--ag-border);margin:0 auto 14px;')} />
        <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:26px;")}>Sort by</div>

        <div style={css('display:flex;flex-direction:column;gap:2px;margin-top:12px;')}>
          {SORTS.map((s) => {
            const on = filters.sort === s;
            return (
              <button
                key={s}
                onClick={() => { setSort(s); close(); }}
                style={css(`display:flex;align-items:center;justify-content:space-between;border:none;background:none;padding:15px 4px;cursor:pointer;font-size:15px;font-weight:${on ? 800 : 600};color:${on ? 'var(--ag-ink)' : 'var(--ag-label)'};border-bottom:1px solid var(--ag-border-soft);`)}
              >
                {s}<span style={css(`font-family:'Material Symbols Outlined';color:#D6336C;opacity:${on ? 1 : 0};`)}>check_circle</span>
              </button>
            );
          })}
        </div>

        <button onClick={close} style={css('width:100%;height:52px;margin-top:22px;border:none;border-radius:14px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;cursor:pointer;box-shadow:0 14px 30px -14px rgba(214,51,108,.8);')}>
          Done
        </button>
      </div>
    </div>
  );
}
