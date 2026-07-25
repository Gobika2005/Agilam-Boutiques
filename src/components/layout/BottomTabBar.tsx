import { useLocation, useNavigate } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';

export type TabDef = { label: string; icon: string; to: string; match: string[] };

export function BottomTabBar({ tabs }: { tabs: TabDef[] }) {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <div
      className="flex flex-none justify-around border-t border-rose-borderMid bg-white px-2.5 pb-5 pt-2"
      style={{ boxShadow: '0 -8px 24px -18px rgba(107,20,54,.4)' }}
    >
      {tabs.map((t) => {
        const active = t.match.some((m) => location.pathname.startsWith(m));
        return (
          <button
            key={t.to}
            type="button"
            onClick={() => navigate(t.to)}
            aria-label={t.label}
            aria-current={active ? 'page' : undefined}
            className="flex min-h-[44px] flex-1 cursor-pointer flex-col items-center justify-center gap-0.5 border-none bg-transparent py-1"
            style={{ color: active ? '#D6336C' : 'var(--ag-muted-soft)' }}
          >
            <Icon name={t.icon} className="text-2xl" />
            <span className="text-[10.5px] font-bold">{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}
