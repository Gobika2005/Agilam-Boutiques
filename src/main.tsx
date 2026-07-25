import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from '@/auth/AuthContext';
import { ThemeProvider } from '@/state/ThemeContext';
import { CatalogProvider } from '@/state/CatalogContext';
import { TaxonomyProvider } from '@/state/TaxonomyContext';
import { ShopProvider } from '@/state/ShopContext';
import { ToastProvider } from '@/components/ui/Toast';
import { UpdateNotice } from '@/components/layout/UpdateNotice';
import { supabaseConfigError } from '@/lib/supabase';
import { installStaleChunkRecovery } from '@/lib/appUpdate';
import App from './App';
import './index.css';

// A deploy deletes the code-split chunks this tab hasn't downloaded yet, so the
// next lazy route it opens would fail with a blank screen. Recover before the
// user ever sees one.
installStaleChunkRecovery();

function ConfigErrorScreen({ message }: { message: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-rose-bg px-6">
      <div className="w-full max-w-lg rounded-3xl border border-rose-border bg-white p-8 text-center shadow-soft">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-rose-primary">Configuration Required</p>
        <h1 className="mt-3 text-2xl font-semibold text-ink">Supabase keys are missing</h1>
        <p className="mt-4 text-sm leading-6 text-ink-muted">{message}</p>
        <p className="mt-4 text-sm leading-6 text-ink-muted">
          Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> in Vercel, then redeploy.
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
                  <ToastProvider>
                    <App />
                    {/* Offers the new build; never takes the page away mid-task. */}
                    <UpdateNotice />
                  </ToastProvider>
                </ShopProvider>
              </TaxonomyProvider>
            </CatalogProvider>
          </AuthProvider>
        </BrowserRouter>
      </ThemeProvider>
    )}
  </StrictMode>,
);
