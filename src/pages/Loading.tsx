import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';

/**
 * Loading splash — the app entry point. Auto-advances to the buyer home after
 * 2.5s (matching the design), or immediately when tapped.
 */
export function Loading() {
  const navigate = useNavigate();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    timer.current = setTimeout(() => navigate('/', { replace: true }), 2500);
    return () => clearTimeout(timer.current);
  }, [navigate]);

  const skip = () => {
    clearTimeout(timer.current);
    navigate('/', { replace: true });
  };

  return (
    <div
      onClick={skip}
      style={css('min-height:100vh;background:radial-gradient(120% 95% at 50% 42%,var(--ag-surface-2) 0%,var(--ag-surface) 52%,var(--ag-bg) 100%);display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;overflow:hidden;')}
    >
      {/* 512px WebP (17 kB). This is a splash screen — the one place a slow
          image is most obviously the wait itself — and it was loading the
          1.7 MB master PNG to draw it at 380px. */}
      <img
        src="/mangaimart-logo-512.webp"
        alt="MangaiMart"
        width={512}
        height={512}
        fetchPriority="high"
        style={css('width:min(72vw,380px);height:auto;border-radius:34px;box-shadow:0 34px 90px -34px rgba(142,28,68,.45);animation:agxLogoIn 1s cubic-bezier(.2,.7,.2,1) both;')}
      />
      <div style={css('margin-top:36px;width:132px;height:4px;border-radius:4px;background:rgba(142,28,68,.14);overflow:hidden;')}>
        <div style={css('width:38%;height:100%;border-radius:4px;background:linear-gradient(90deg,#D6336C,#8E1C44);animation:agxBar 1.3s ease-in-out infinite;')} />
      </div>
      <div style={css('margin-top:16px;font-size:11.5px;letter-spacing:.22em;text-transform:uppercase;color:#9A4A63;font-weight:700;')}>
        All Boutiques · One Place
      </div>
    </div>
  );
}
