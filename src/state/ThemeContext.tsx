import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

/**
 * App-wide light/dark theme.
 *
 * Light is the default: a first-time (or storage-cleared) visitor always opens
 * in light and the OS `prefers-color-scheme` is intentionally ignored — dark is
 * a deliberate opt-in. The choice persists per device in localStorage and is
 * applied by stamping `data-theme` on <html>, which drives the CSS token layer
 * in index.css. A matching inline script in index.html applies the stored value
 * before first paint so returning dark users never see a light flash.
 */
export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'ag-theme';

type ThemeCtx = {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
};

const Ctx = createContext<ThemeCtx | null>(null);

function readStored(): Theme {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readStored);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* private mode — the in-memory value still drives this session */
    }
    // Keep the browser chrome (address bar) in step with the surface behind it.
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#120A0E' : '#FBF6F2');
  }, [theme]);

  const setTheme = useCallback((t: Theme) => setThemeState(t), []);
  const toggleTheme = useCallback(() => setThemeState((t) => (t === 'dark' ? 'light' : 'dark')), []);

  return <Ctx.Provider value={{ theme, setTheme, toggleTheme }}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
