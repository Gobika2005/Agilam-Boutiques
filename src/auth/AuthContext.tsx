import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { Role } from '@/types/database';

type Profile = {
  id: string;
  role: Role;
  full_name: string;
  phone: string | null;
  email: string | null;
  city: string | null;
  status: 'active' | 'blocked';
  deleted_at: string | null;
};

/**
 * An account an admin has blocked or deleted must not be able to use the site,
 * even if its Supabase Auth login still exists (a soft-deleted/archived user, or
 * one whose hard delete fell back to archival because they have orders/chat).
 */
function isDisabled(p: Pick<Profile, 'status' | 'deleted_at'> | null): boolean {
  return !!p && (p.deleted_at != null || p.status === 'blocked');
}

/** Shown when a blocked/deleted account tries to sign in. */
const DISABLED_MESSAGE =
  'Your MangaiMart account has been disabled. Please contact MangaiMart support at support@mangaimart.com for assistance.';

export type PendingSignup = {
  full_name: string;
  role: Role;
  city?: string;
};

type AuthContextValue = {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  signUpWithPassword: (email: string, password: string, pending: PendingSignup) => Promise<{ confirmationRequired: boolean; role: Role }>;
  signInWithPassword: (email: string, password: string, desiredRole?: Role) => Promise<Role>;
  adminSignIn: (email: string, password: string) => Promise<Role>;
  /** Email a password-reset link that returns the user to `redirectTo`. */
  sendPasswordReset: (email: string, redirectTo: string) => Promise<void>;
  /**
   * Set a new password for the user currently in a (recovery) session and
   * return their DB role, so the caller can gate the reset on admin access.
   */
  updatePassword: (password: string) => Promise<Role>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  /** Promote the signed-in user (buyer→seller only) after Google OAuth. Admin is never self-claimable. */
  claimRole: (role: Extract<Role, 'buyer' | 'seller'>) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  // The DB profile row is the single source of truth for a user's role. Routing
  // reads it directly so an account always lands on its own console regardless
  // of which sign-in page was used.
  async function loadProfile(userId: string) {
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
    const prof = data ? (data as Profile) : null;
    // A blocked/deleted account is signed out on the spot — it can't be used to
    // browse, order, sell or reach the admin console. Leave a one-time notice so
    // the page they land on (incl. the Google OAuth callback) can explain why.
    if (isDisabled(prof)) {
      try { sessionStorage.setItem('agx-auth-notice', DISABLED_MESSAGE); } catch { /* storage unavailable */ }
      await supabase.auth.signOut();
      setSession(null);
      setProfile(null);
      return;
    }
    try { sessionStorage.removeItem('agx-auth-notice'); } catch { /* storage unavailable */ }
    setProfile(prof);
  }

  /**
   * Ensure a profile row exists for the user and return its effective role.
   *
   * IMPORTANT: an existing account's role is never rewritten here. `desiredRole`
   * (the role of the sign-in page) only seeds the role for a *brand-new* profile.
   * Re-using the wrong login page must not be able to change an account's role —
   * that previously let admin credentials entered on the seller page silently
   * demote the admin to a seller.
   */
  async function ensureProfile(user: User, desiredRole?: Role): Promise<Role> {
    const { data: existing } = await supabase
      .from('profiles')
      .select('id, role')
      .eq('id', user.id)
      .maybeSingle();

    if (existing) return (existing as { role: Role }).role;

    const meta = (user.user_metadata ?? {}) as Partial<PendingSignup>;
    const role: Role = desiredRole ?? meta.role ?? 'buyer';
    const defaultName = user.is_anonymous ? 'Customer' : 'New user';
    // ignoreDuplicates: an anonymous buyer's identity may be created concurrently
    // by ensureBuyerIdentity() when they open a chat, so tolerate the race.
    await supabase.from('profiles').upsert(
      {
        id: user.id,
        role,
        full_name: meta.full_name ?? defaultName,
        email: user.email,
        city: meta.city ?? null,
      },
      { onConflict: 'id', ignoreDuplicates: true },
    );

    // A seller's boutique row is deliberately NOT created here. The registration
    // wizard creates it (as a draft) on the step right after the account, which
    // keeps one creation path for password signup, Google and a seller who
    // abandoned setup and came back.
    return role;
  }

  /**
   * Populate session + profile synchronously after an auth call and resolve the
   * account's real role. Callers await this before navigating so role-guarded
   * routes see a loaded profile instead of racing the onAuthStateChange listener.
   * The returned role is always the account's DB role (never forced by the page).
   */
  async function hydrate(user: User, newSession: Session | null, desiredRole?: Role): Promise<Role> {
    const ensuredRole = await ensureProfile(user, desiredRole);
    const { data } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
    // Fall back to the ensured role only if the fresh row isn't readable yet
    // (RLS/replication lag right after creation).
    const prof: Profile = data
      ? (data as Profile)
      : { id: user.id, role: ensuredRole, full_name: user.email ?? 'New user', phone: null, email: user.email ?? null, city: null, status: 'active', deleted_at: null };
    // Refuse sign-in for a blocked/deleted account: end the session and surface a
    // clear error the login screens can show.
    if (isDisabled(prof)) {
      await supabase.auth.signOut();
      setSession(null);
      setProfile(null);
      throw new Error(DISABLED_MESSAGE);
    }
    setSession(newSession);
    setProfile(prof);
    return prof.role;
  }

  useEffect(() => {
    let mounted = true;
    supabase.auth
      .getSession()
      .then(async ({ data }) => {
        if (!mounted) return;
        setSession(data.session);
        if (data.session) {
          await ensureProfile(data.session.user);
          await loadProfile(data.session.user.id);
        }
      })
      .catch((e) => console.error('Failed to load Supabase session', e))
      .finally(() => {
        if (mounted) setLoading(false);
      });

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      setSession(newSession);
      if (newSession) {
        await ensureProfile(newSession.user);
        await loadProfile(newSession.user.id);
      } else {
        setProfile(null);
      }
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function signUpWithPassword(email: string, password: string, pending: PendingSignup) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      // Without emailRedirectTo the confirmation link falls back to the project's
      // Site URL, which sends everyone to whichever single host is configured
      // there (prod, or worse, localhost). Send them back to the host they
      // actually signed up on — /auth/callback then routes by role.
      options: { data: pending, emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) throw error;
    // When email confirmation is off, Supabase returns a session immediately —
    // hydrate so the guarded route sees the new profile before we navigate.
    const role = data.session && data.user ? await hydrate(data.user, data.session, pending.role) : pending.role;
    return { confirmationRequired: !data.session, role };
  }

  async function signInWithPassword(email: string, password: string, desiredRole?: Role): Promise<Role> {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data.user ? hydrate(data.user, data.session, desiredRole) : (desiredRole ?? 'buyer');
  }

  async function adminSignIn(email: string, password: string): Promise<Role> {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data.user ? hydrate(data.user, data.session) : 'buyer';
  }

  async function sendPasswordReset(email: string, redirectTo: string): Promise<void> {
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) throw error;
  }

  /**
   * Change the password of the user in the active session (established by the
   * recovery link Supabase opened). Returns the account's DB role so the reset
   * screen can enforce that only admins may finish the admin reset flow.
   */
  async function updatePassword(password: string): Promise<Role> {
    const { data, error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
    const uid = data.user?.id;
    if (!uid) throw new Error('No active session. Please open the reset link from your email again.');
    const { data: prof } = await supabase.from('profiles').select('role').eq('id', uid).maybeSingle();
    await loadProfile(uid);
    return (prof as { role: Role } | null)?.role ?? 'buyer';
  }

  async function signOut() {
    await supabase.auth.signOut();
    setProfile(null);
  }

  async function refreshProfile() {
    if (session) await loadProfile(session.user.id);
  }

  // Google users are created with the default buyer role; when they explicitly
  // signed in as a seller, promote the profile row (self-update RLS) so the
  // seller console renders. This is the one sanctioned role change — and it is
  // deliberately limited to 'seller'. The admin role is never self-claimable
  // (the DB trigger in migration 0010 enforces this server-side too).
  async function claimRole(role: Extract<Role, 'buyer' | 'seller'>) {
    const { data } = await supabase.auth.getSession();
    const uid = data.session?.user?.id;
    if (!uid) return;
    await supabase.from('profiles').update({ role }).eq('id', uid);
    await loadProfile(uid);
  }

  return (
    <AuthContext.Provider
      value={{ session, profile, loading, signUpWithPassword, signInWithPassword, adminSignIn, sendPasswordReset, updatePassword, signOut, refreshProfile, claimRole }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
