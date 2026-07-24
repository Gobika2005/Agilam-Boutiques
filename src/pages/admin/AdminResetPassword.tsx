import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { ResetPasswordCard } from '@/components/auth/ResetPasswordCard';

/**
 * Lands here from the admin password-reset email link. The change is only
 * accepted for admin accounts — a non-admin who somehow reaches this flow is
 * signed out, matching the rule that only those with admin access may use the
 * admin console.
 */
export function AdminResetPassword() {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  return (
    <ResetPasswordCard
      heading="Set a new password"
      sub="Choose a new password for your admin account."
      backTo="/admin/login"
      onComplete={async (role) => {
        if (role !== 'admin') {
          await signOut();
          toast('This account does not have admin access.');
          navigate('/admin/login', { replace: true });
          return;
        }
        toast('Password updated. You are signed in.');
        navigate('/admin/overview', { replace: true });
      }}
    />
  );
}
