import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * App-wide light/dark theme.
 *
 * The theme always follows the device's OS `prefers-color-scheme`, tracked
 * live. A user can override it for the current visit (not persisted — a
 * refresh goes back to following the device). The theme is applied by
 * stamping `data-theme` on <html>, which drives the CSS token layer in
 * index.css; a matching inline script in index.html applies the same
 * resolution before first paint so there is never a wrong-theme flash on load.
 */
export type Theme = 'light' | 'dark';

type ThemeCtx = {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
};

const Ctx = createContext<ThemeCtx | null>(null);

/** The device's current preference. Defaults to light where unsupported. */
function deviceTheme(): Theme {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(deviceTheme);
  // Tracks whether the user has made an explicit choice for this visit. While
  // false the theme follows the device live.
  const explicitRef = useRef<boolean>(false);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    // Keep the browser chrome (address bar) in step with the surface behind it.
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#120A0E' : '#FBF6F2');
  }, [theme]);

  // Until the user chooses, mirror the OS as it changes (e.g. sunset auto-dark).
  useEffect(() => {
    let mql: MediaQueryList;
    try {
      mql = window.matchMedia('(prefers-color-scheme: dark)');
    } catch {
      return;
    }
    const onChange = (e: MediaQueryListEvent) => {
      if (!explicitRef.current) setThemeState(e.matches ? 'dark' : 'light');
    };
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  const setTheme = useCallback((t: Theme) => {
    explicitRef.current = true;
    setThemeState(t);
  }, []);

  const toggleTheme = useCallback(() => setTheme(theme === 'dark' ? 'light' : 'dark'), [setTheme, theme]);

  return <Ctx.Provider value={{ theme, setTheme, toggleTheme }}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
