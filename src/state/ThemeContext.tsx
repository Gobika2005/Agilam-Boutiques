import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

/**
 * App-wide light/dark theme.
 *
 * The buyer picks a *preference* — Light, Dark, or System — which is saved
 * (`localStorage`, see `PREF_KEY`) and wins on every future visit. "System"
 * isn't just the unset default: it's a real, persisted choice that keeps
 * tracking the OS live (e.g. sunset auto-dark), same as picking Light or Dark
 * explicitly opts out of that tracking. `theme` is always the *resolved*
 * light/dark value the screens render with; `preference` is what's actually
 * stored, for the three-way switch on the Profile page to show the right one
 * selected. Applied by stamping `data-theme` on <html>, which drives the CSS
 * token layer in index.css; a matching inline script in index.html resolves
 * the same preference before first paint so there is never a wrong-theme
 * flash on load — keep that script in step with the logic here.
 */
export type Theme = 'light' | 'dark';
export type ThemePreference = Theme | 'system';

const PREF_KEY = 'ag-theme-pref';

type ThemeCtx = {
  /** The resolved value to render with. */
  theme: Theme;
  /** The buyer's actual stored choice — drives which segment shows selected. */
  preference: ThemePreference;
  setTheme: (t: ThemePreference) => void;
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

function readStoredPreference(): ThemePreference {
  try {
    const v = localStorage.getItem(PREF_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    /* storage unavailable (private mode, SSR) — fall through to system */
  }
  return 'system';
}

function resolve(pref: ThemePreference): Theme {
  return pref === 'system' ? deviceTheme() : pref;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readStoredPreference);
  const [theme, setThemeState] = useState<Theme>(() => resolve(readStoredPreference()));

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    // Keep the browser chrome (address bar) in step with the surface behind it.
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#120A0E' : '#FBF6F2');
  }, [theme]);

  // While the preference is "system" (the default, or chosen explicitly),
  // mirror the OS as it changes live.
  useEffect(() => {
    if (preference !== 'system') return;
    let mql: MediaQueryList;
    try {
      mql = window.matchMedia('(prefers-color-scheme: dark)');
    } catch {
      return;
    }
    const onChange = (e: MediaQueryListEvent) => setThemeState(e.matches ? 'dark' : 'light');
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [preference]);

  const setTheme = useCallback((pref: ThemePreference) => {
    setPreferenceState(pref);
    setThemeState(resolve(pref));
    try {
      localStorage.setItem(PREF_KEY, pref);
    } catch {
      /* storage unavailable — the choice still applies for this visit */
    }
  }, []);

  const toggleTheme = useCallback(() => setTheme(theme === 'dark' ? 'light' : 'dark'), [setTheme, theme]);

  return <Ctx.Provider value={{ theme, preference, setTheme, toggleTheme }}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
