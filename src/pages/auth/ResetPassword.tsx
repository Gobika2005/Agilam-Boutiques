import { useNavigate } from 'react-router-dom';
import { homeFor } from '@/auth/RequireRole';
import { useToast } from '@/components/ui/Toast';
import { ResetPasswordCard } from '@/components/auth/ResetPasswordCard';

/**
 * Lands here from the buyer/seller password-reset email link. Any account role
 * may reset here; after the change the user is routed to their own workspace.
 */
export function ResetPassword() {
  const navigate = useNavigate();
  const toast = useToast();

  return (
    <ResetPasswordCard
      heading="Set a new password"
      sub="Choose a new password for your account."
      backTo="/auth/signin/buyer"
      onComplete={(role) => {
        toast('Password updated. You are signed in.');
        navigate(homeFor(role), { replace: true });
      }}
    />
  );
}
