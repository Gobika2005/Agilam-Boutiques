import { supabase } from '@/lib/supabase';

export type ProfilePatch = Partial<{
  full_name: string;
  phone: string | null;
  city: string | null;
  address: string | null;
  pincode: string | null;
}>;

/** Update the signed-in user's own profile row (self-update RLS). */
export async function updateMyProfile(id: string, patch: ProfilePatch) {
  const { error } = await supabase.from('profiles').update(patch).eq('id', id);
  if (error) throw error;
}
