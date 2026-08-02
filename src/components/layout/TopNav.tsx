import { useLocation, useNavigate } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { isTabActive } from '@/lib/navMatch';
import type { TabDef } from './BottomTabBar';

export function TopNav({ tabs, brand }: { tabs: TabDef[]; brand: string }) {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <div className="hidden flex-none items-center justify-between border-b border-rose-borderSoft bg-white px-6 py-3 md:flex">
      <div className="flex items-center gap-2.5">
        <div
          className="flex h-9 w-9 items-center justify-center rounded-[11px] font-serif text-lg font-bold text-white"
          style={{ background: 'linear-gradient(135deg,#D6336C,#B02454)' }}
        >
          A
        </div>
        <span className="font-serif text-lg font-bold">{brand}</span>
      </div>
      <div className="flex items-center gap-1.5">
        {tabs.map((t) => {
          const active = isTabActive(location.pathname, t.match);
          return (
            <button
              key={t.to}
              type="button"
              onClick={() => navigate(t.to)}
              aria-current={active ? 'page' : undefined}
              className="flex items-center gap-1.5 rounded-xl border-none px-3.5 py-2 text-[13.5px] font-bold"
              style={{ background: active ? 'var(--ag-surface-2)' : 'transparent', color: active ? 'var(--ag-crimson)' : 'var(--ag-label)' }}
            >
              <Icon name={t.icon} className="text-lg" />
              {t.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
