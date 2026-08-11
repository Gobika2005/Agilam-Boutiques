import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Analytics } from '@vercel/analytics/react';
import { AuthProvider } from '@/auth/AuthContext';
import { ThemeProvider } from '@/state/ThemeContext';
import { CatalogProvider } from '@/state/CatalogContext';
import { TaxonomyProvider } from '@/state/TaxonomyContext';
import { ShopProvider } from '@/state/ShopContext';
import { NotificationProvider } from '@/state/NotificationContext';
import { ToastProvider } from '@/components/ui/Toast';
import { UpdateNotice } from '@/components/layout/UpdateNotice';
import { supabaseConfigError } from '@/lib/supabase';
import { installStaleChunkRecovery } from '@/lib/appUpdate';
import { installContentProtection } from '@/lib/contentProtection';
import App from './App';
import './index.css';

// A deploy deletes the code-split chunks this tab hasn't downloaded yet, so the
// next lazy route it opens would fail with a blank screen. Recover before the
// user ever sees one.
installStaleChunkRecovery();

// Deter casual copy/save of catalogue text and imagery (see the module).
installContentProtection();

function ConfigErrorScreen({ message }: { message: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-rose-bg px-6">
      <div className="w-full max-w-lg rounded-3xl border border-rose-border bg-white p-8 text-center shadow-soft">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-rose-primary">Configuration Required</p>
        <h1 className="mt-3 text-2xl font-semibold text-ink">Supabase keys are missing</h1>
        <p className="mt-4 text-sm leading-6 text-ink-muted">{message}</p>
        {/* This screen is what a real shopper sees if the keys are ever missing,
            so it names the variables without naming the host. */}
        <p className="mt-4 text-sm leading-6 text-ink-muted">
          Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> in the deployment
          environment, then redeploy.
        </p>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {supabaseConfigError ? (
      <ConfigErrorScreen message={supabaseConfigError} />
    ) : (
      <ThemeProvider>
        <BrowserRouter>
          <AuthProvider>
            <CatalogProvider>
              <TaxonomyProvider>
                <ShopProvider>
                  <NotificationProvider>
                    <ToastProvider>
                      <App />
                      {/* Offers the new build; never takes the page away mid-task. */}
                      <UpdateNotice />
                      {/* Vercel Web Analytics — no-ops outside a Vercel deployment. */}
                      <Analytics />
                    </ToastProvider>
                  </NotificationProvider>
                </ShopProvider>
              </TaxonomyProvider>
            </CatalogProvider>
          </AuthProvider>
        </BrowserRouter>
      </ThemeProvider>
    )}
  </StrictMode>,
);
