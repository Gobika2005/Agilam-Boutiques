import crypto from 'node:crypto';
import { serviceClient } from './_supabase.js';
import { loginPathForRole, sendAccessEmail } from './_accessEmail.js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const resendApiKey = process.env.RESEND_API_KEY || process.env.VITE_RESEND_API_KEY;
const fromEmail = process.env.EMAIL_FROM || process.env.VITE_EMAIL_FROM || 'noreply@mangaimart.com';
const appUrl = (process.env.APP_URL || process.env.VITE_APP_URL || 'http://localhost:5173').replace(/\/$/, '');

// Built lazily (null when env is missing) so a misconfigured deploy returns a
// clean 500 from the handler instead of throwing at import time, which crashes
// the whole function on cold start with no diagnosable response.
const supabaseAdmin = serviceClient(supabaseUrl, supabaseServiceKey);

/**
 * Turn a Postgres write failure into something the admin can act on.
 *
 * The one that actually happens: assigning a role the database has never heard
 * of. `profiles.role` carries a CHECK constraint listing the legal values, and
 * every new role arrives in a numbered migration the owner applies by hand — so
 * between deploying the code and running the SQL, the console offers a role the
 * database will refuse. "Failed to update the user" gave no hint that the fix
 * was a migration rather than a bug.
 */
function writeErrorMessage(error, fallback) {
  const code = error?.code;
  const detail = `${error?.message ?? ''} ${error?.details ?? ''}`;
  if (code === '23514' && /profiles_role_check|role/i.test(detail)) {
    return 'This role does not exist in the database yet. Apply the migration that adds it (0086 for "staff"), then try again.';
  }
  // A trigger refusing the change — e.g. the privilege guard in 0010/0086 —
  // raises with a message written to be read, so pass it straight through.
  if (code === 'P0001' && error?.message) return error.message;
  return fallback;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * The one-time password a newly created account signs in with — including an
 * ADMIN account, which is why this is a CSPRNG.
 *
 * `Math.random()` is not one. V8 implements it as xorshift128+, seeded once per
 * isolate and never reseeded, so a handful of observed outputs is enough to
 * recover the generator's internal state and predict the rest — and a warm
 * serverless instance serves many requests from a single isolate. Someone who
 * can trigger any Math.random()-derived value from that same instance could
 * therefore derive the next admin's temporary password without ever seeing the
 * email that carried it.
 *
 * `randomInt` also avoids the modulo bias that `bytes[i] % chars.length` would
 * introduce (52 does not divide 256), which is what keeps the real entropy at
 * the full 12 × log2(52) ≈ 68 bits rather than something quietly lower.
 */
function generateTempPassword() {
  const chars = 'ABCDEFGHJKMNPQRSTVWXYZabcdefghjkmnpqrstvwxyz23456789';
  let password = '';
  for (let i = 0; i < 12; i += 1) {
    password += chars.charAt(crypto.randomInt(chars.length));
  }
  return password;
}

function buildLoginUrl(role, email) {
  const path = loginPathForRole(role);
  return `${appUrl}${path}?email=${encodeURIComponent(email)}`;
}

function buildAccountCreationEmail({ email, fullName, role, tempPassword, loginUrl }) {
  const roleLabel = {
    buyer: 'Buyer Account',
    seller: 'Boutique Seller',
    admin: 'Admin Panel',
    staff: 'Staff Console',
  }[role];

  const roleDetail = {
    buyer: 'Curated fashion discovery, wishlists, and seamless checkout.',
    seller: 'Boutique tools for catalog management, orders, and growth.',
    admin: 'Operational visibility, approvals, and platform controls.',
    staff: 'Orders, deliveries, approvals and moderation. Payouts, refunds and platform settings stay with the owner.',
  }[role];

  return {
    to: email,
    subject: `Welcome to MangaiMart - ${roleLabel} Account Created`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin:0;padding:0;background:#f6efe8;font-family:Georgia,'Times New Roman',serif;color:#24161d;">
        <div style="background:
          radial-gradient(circle at top left, rgba(214,51,108,0.18), transparent 30%),
          radial-gradient(circle at top right, rgba(176,36,84,0.12), transparent 28%),
          linear-gradient(180deg,#f8f1eb 0%,#f3e7df 100%);
          padding:32px 16px;">
          <div style="max-width:640px;margin:0 auto;">
            <div style="text-align:center;margin-bottom:14px;">
              <div style="display:inline-block;padding:8px 14px;border:1px solid rgba(176,36,84,0.18);border-radius:999px;background:rgba(255,255,255,0.72);font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:#9b4762;">
                MangaiMart Welcome Suite
              </div>
            </div>
            <div style="background:#fff;border:1px solid rgba(176,36,84,0.10);border-radius:28px;overflow:hidden;box-shadow:0 28px 80px -40px rgba(83,24,43,0.55);">
              <div style="padding:44px 40px 30px;background:
                radial-gradient(circle at 20% 20%, rgba(255,255,255,0.30), transparent 26%),
                linear-gradient(135deg,#7f173d 0%,#b02454 42%,#d85b83 100%);
                color:#fff;">
                <div style="font-size:34px;line-height:1;font-weight:700;letter-spacing:0.04em;">MangaiMart</div>
                <div style="width:72px;height:1px;background:rgba(255,255,255,0.6);margin:18px 0;"></div>
                <div style="font-size:13px;letter-spacing:0.18em;text-transform:uppercase;opacity:0.86;margin-bottom:14px;">Your account is ready</div>
                <div style="font-size:32px;line-height:1.2;font-weight:700;max-width:430px;">Welcome, ${fullName}</div>
                <p style="margin:16px 0 0;font-size:15px;line-height:1.8;max-width:470px;color:rgba(255,255,255,0.9);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
                  Your ${roleLabel} has been prepared by the MangaiMart team with access tailored for a premium boutique experience.
                </p>
              </div>

              <div style="padding:34px 40px 22px;background:#fff;">
                <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:24px;">
                  <div style="flex:1 1 220px;padding:18px 20px;border-radius:20px;background:linear-gradient(180deg,#fff8fb 0%,#f9eef3 100%);border:1px solid #f2d7e1;">
                    <div style="font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:#a05a72;margin-bottom:10px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">Access Level</div>
                    <div style="font-size:22px;font-weight:700;color:#651b36;margin-bottom:8px;">${roleLabel}</div>
                    <div style="font-size:13px;line-height:1.7;color:#6d5460;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">${roleDetail}</div>
                  </div>
                  <div style="flex:1 1 220px;padding:18px 20px;border-radius:20px;background:linear-gradient(180deg,#fffdfa 0%,#f6eee7 100%);border:1px solid #efe1d5;">
                    <div style="font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:#9c7155;margin-bottom:10px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">Security Reminder</div>
                    <div style="font-size:22px;font-weight:700;color:#5e3320;margin-bottom:8px;">Temporary Sign-In</div>
                    <div style="font-size:13px;line-height:1.7;color:#6d5a4f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">Use the one-time password below, then update it after your first login for account security.</div>
                  </div>
                </div>

                <div style="border:1px solid #ecd6df;border-radius:24px;overflow:hidden;margin-bottom:24px;">
                  <div style="padding:14px 20px;background:#fcf4f7;border-bottom:1px solid #f3dfe7;font-size:12px;letter-spacing:0.16em;text-transform:uppercase;color:#9d556f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
                    Login Credentials
                  </div>
                  <div style="padding:22px 20px;background:#fffafc;">
                    <div style="margin-bottom:14px;">
                      <div style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#a17386;margin-bottom:6px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">Email</div>
                      <div style="font-size:15px;color:#311d25;font-weight:600;font-family:'Segoe UI',sans-serif;word-break:break-word;">${email}</div>
                    </div>
                    <div>
                      <div style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#a17386;margin-bottom:6px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">Temporary Password</div>
                      <div style="display:inline-block;padding:12px 16px;border-radius:14px;background:#ffffff;border:1px solid #edd5df;font-size:18px;letter-spacing:0.12em;color:#651b36;font-weight:700;font-family:'Courier New',monospace;">
                        ${tempPassword}
                      </div>
                    </div>
                  </div>
                </div>

                <div style="padding:24px;border-radius:24px;background:linear-gradient(180deg,#fff 0%,#fbf5f1 100%);border:1px solid #efe3da;margin-bottom:28px;">
                  <div style="font-size:13px;letter-spacing:0.16em;text-transform:uppercase;color:#9b6f57;margin-bottom:14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">Next Steps</div>
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                    <tr><td style="width:40px;vertical-align:top;padding:0 0 14px;"><div style="width:28px;height:28px;border-radius:999px;background:#7f173d;color:#fff;text-align:center;line-height:28px;font-size:13px;font-weight:700;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">1</div></td><td style="padding:0 0 14px;font-size:14px;line-height:1.7;color:#5f4c55;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">Open your MangaiMart account using the secure button below.</td></tr>
                    <tr><td style="width:40px;vertical-align:top;padding:0 0 14px;"><div style="width:28px;height:28px;border-radius:999px;background:#7f173d;color:#fff;text-align:center;line-height:28px;font-size:13px;font-weight:700;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">2</div></td><td style="padding:0 0 14px;font-size:14px;line-height:1.7;color:#5f4c55;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">Sign in with your email and temporary password.</td></tr>
                    <tr><td style="width:40px;vertical-align:top;padding:0 0 14px;"><div style="width:28px;height:28px;border-radius:999px;background:#7f173d;color:#fff;text-align:center;line-height:28px;font-size:13px;font-weight:700;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">3</div></td><td style="padding:0 0 14px;font-size:14px;line-height:1.7;color:#5f4c55;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">Choose a new password and complete your profile details.</td></tr>
                  </table>
                </div>

                <div style="text-align:center;margin-bottom:28px;">
                  <a href="${loginUrl}" style="display:inline-block;padding:16px 34px;border-radius:999px;background:linear-gradient(135deg,#7f173d 0%,#b02454 55%,#d85b83 100%);color:#fff;text-decoration:none;font-size:14px;font-weight:700;letter-spacing:0.04em;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;box-shadow:0 18px 34px -20px rgba(127,23,61,0.9);">
                    Access Your Account
                  </a>
                </div>

                <div style="padding:18px 20px;border-radius:18px;background:#faf4ef;border:1px solid #efe0d4;font-size:13px;line-height:1.8;color:#6b5b55;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
                  If you did not expect this invitation, please contact
                  <a href="mailto:support@mangaimart.com" style="color:#8d2348;text-decoration:none;font-weight:600;">support@mangaimart.com</a>
                  before signing in.
                </div>
              </div>

              <div style="padding:20px 24px;background:#f8f1ec;border-top:1px solid #eee2d8;text-align:center;font-size:11px;line-height:1.8;letter-spacing:0.08em;text-transform:uppercase;color:#987567;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
                MangaiMart • Curated Marketplace Experience
              </div>
            </div>
          </div>
        </div>
      </body>
      </html>
    `,
    text: [
      `Welcome to MangaiMart, ${fullName}!`,
      '',
      `Your ${roleLabel} has been created.`,
      roleDetail,
      '',
      'LOGIN CREDENTIALS',
      `Email: ${email}`,
      `Temporary Password: ${tempPassword}`,
      '',
      'NEXT STEPS',
      '1. Open your account using the login link below.',
      '2. Sign in with your temporary password.',
      '3. Change your password and complete your profile.',
      '',
      `Log in at ${loginUrl}`,
    ].join('\n'),
  };
}

async function sendEmail({ to, subject, html, text }) {
  if (!resendApiKey) {
    if (process.env.NODE_ENV === 'production') {
      return { success: false, error: 'Email provider is not configured' };
    }
    console.log('[DEV EMAIL]', { to, subject });
    return { success: true };
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${resendApiKey}`,
      },
      body: JSON.stringify({
        from: fromEmail,
        to,
        subject,
        html,
        text,
        reply_to: 'support@mangaimart.com',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || 'Email send failed');
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown email error' };
  }
}

async function authenticateAdmin(req) {
  const authHeader = req.headers?.authorization || req.headers?.Authorization;
  const token = typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : '';

  if (!token) {
    return { ok: false, status: 401, error: 'Missing admin session' };
  }

  // Validate the caller's access token with the SAME service-role client that
  // reads the profile below, so the token check and the admin lookup always hit
  // one project. (Using a separate anon-key client made this fail with "Invalid
  // admin session" whenever the anon key / URL resolved to a different project
  // than the service role — the frontend's token then didn't validate.)
  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !authData?.user) {
    return { ok: false, status: 401, error: 'Invalid admin session' };
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('id, role, status, deleted_at')
    .eq('id', authData.user.id)
    .maybeSingle();

  if (profileError) {
    return { ok: false, status: 500, error: 'Could not verify admin access' };
  }

  if (!profile || profile.role !== 'admin' || profile.status !== 'active' || profile.deleted_at) {
    return { ok: false, status: 403, error: 'Admin access required' };
  }

  return { ok: true, adminId: authData.user.id };
}

/**
 * Admin edit of an existing profile — name, contact, city, address and role.
 *
 * This was a direct browser→Postgres UPDATE in src/data/adminUsers.ts. It moved
 * behind the service role for one reason: a role change IS an access change, the
 * person is entitled to be told, and only the server holds the mail key. The
 * move has a second benefit — the write is now gated by the explicit is_admin
 * check in authenticateAdmin() rather than by an RLS policy alone.
 *
 * The email goes out ONLY when the role actually changed. An admin fixing a
 * typo in someone's city should not send them a security notice.
 */
async function handleUpdate(req, res, adminId) {
  const { userId, fullName, phone, city, address, role } = req.body || {};

  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ error: 'A userId is required' });
  }
  if (!fullName || fullName.trim().length < 2) {
    return res.status(400).json({ error: 'Full name required (minimum 2 characters)' });
  }
  if (!['buyer', 'seller', 'admin', 'staff'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  const { data: existing, error: readError } = await supabaseAdmin
    .from('profiles')
    .select('id, email, full_name, role')
    .eq('id', userId)
    .maybeSingle();

  if (readError) {
    console.error('[PROFILE_READ_ERROR]', readError);
    return res.status(500).json({ error: 'Could not load the user' });
  }
  if (!existing) return res.status(404).json({ error: 'User not found' });

  // Same reasoning as the delete route's self-delete guard: demoting your own
  // admin account logs you straight out of the console you are standing in, and
  // if you were the last admin nobody can put it back.
  if (userId === adminId && existing.role === 'admin' && role !== 'admin') {
    return res.status(400).json({ error: 'You cannot remove your own admin access. Ask another admin to do it.' });
  }

  const { error: updateError } = await supabaseAdmin
    .from('profiles')
    .update({
      full_name: fullName.trim(),
      phone: phone?.trim() || null,
      city: city?.trim() || null,
      address: address?.trim() || null,
      role,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId);

  if (updateError) {
    console.error('[PROFILE_UPDATE_ERROR]', updateError);
    return res.status(500).json({ error: writeErrorMessage(updateError, 'Failed to update the user') });
  }

  const roleChanged = existing.role !== role;
  // The profile row is already updated. A failed email is reported, never fatal.
  const emailResult = roleChanged
    ? await sendAccessEmail('roleChanged', {
        to: existing.email,
        fullName: fullName.trim() || existing.full_name,
        role,
        previousRole: existing.role,
      })
    : { ok: false };

  return res.status(200).json({
    success: true,
    userId,
    roleChanged,
    previousRole: existing.role,
    emailSent: roleChanged ? emailResult.ok : false,
    message: !roleChanged
      ? 'User updated.'
      : emailResult.ok
        ? `Role changed to ${role} — ${existing.email} has been notified by email.`
        : `Role changed to ${role}, but the notification email could not be sent. Tell them directly.`,
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!supabaseAdmin) return res.status(500).json({ error: 'User management is not configured on the server. Set SUPABASE_SERVICE_ROLE_KEY in the deployment environment and redeploy.' });

  const auth = await authenticateAdmin(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error });
  }

  try {
    // The admin console's Edit drawer posts here too — same admin gate, same
    // service-role client, different shape (a userId, not a new email).
    if ((req.body || {}).action === 'update') {
      return await handleUpdate(req, res, auth.adminId);
    }

    const { email, fullName, phone, city, role } = req.body || {};

    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }
    if (!fullName || fullName.trim().length < 2) {
      return res.status(400).json({ error: 'Full name required (minimum 2 characters)' });
    }
    if (!['buyer', 'seller', 'admin', 'staff'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const normalizedName = fullName.trim();
    const normalizedPhone = phone?.trim() || null;
    const normalizedCity = city?.trim() || null;

    const { data: existing } = await supabaseAdmin
      .from('profiles')
      .select('id, role, full_name, phone, city')
      .eq('email', normalizedEmail)
      .maybeSingle();

    // If the account already exists, don't error — assign the requested role to
    // it (so an admin can promote an existing user, e.g. to admin). We only set
    // the role and fill in any profile fields that were blank; we never reset
    // their password or clobber details they already have.
    //
    // We DO email them when the role actually moved. This path used to be
    // silent, which meant the single highest-privilege action in the console —
    // promoting an existing account to admin — was also the one nobody was told
    // about. No temp password is involved here: they keep their own credentials,
    // so the mail is a notice, not an invitation.
    if (existing) {
      const patch = { role, updated_at: new Date().toISOString() };
      if (!existing.full_name && normalizedName) patch.full_name = normalizedName;
      if (!existing.phone && normalizedPhone) patch.phone = normalizedPhone;
      if (!existing.city && normalizedCity) patch.city = normalizedCity;

      const { error: updateError } = await supabaseAdmin
        .from('profiles')
        .update(patch)
        .eq('id', existing.id);

      if (updateError) {
        console.error('[PROFILE_UPDATE_ERROR]', updateError);
        return res.status(500).json({ error: writeErrorMessage(updateError, 'Failed to update the existing user') });
      }

      const promoted = existing.role !== role;
      const noticeResult = promoted
        ? await sendAccessEmail('roleChanged', {
            to: normalizedEmail,
            fullName: existing.full_name || normalizedName,
            role,
            previousRole: existing.role,
          })
        : { ok: false };

      return res.status(200).json({
        success: true,
        userId: existing.id,
        updated: true,
        emailSent: promoted ? noticeResult.ok : false,
        message: !promoted
          ? `${normalizedEmail} already exists with the ${role} role — no change needed.`
          : noticeResult.ok
            ? `${normalizedEmail} already exists — role changed from ${existing.role} to ${role}, and they have been notified by email.`
            : `${normalizedEmail} already exists — role changed from ${existing.role} to ${role}, but the notification email could not be sent.`,
      });
    }

    const tempPassword = generateTempPassword();
    const loginUrl = buildLoginUrl(role, normalizedEmail);
    const emailData = buildAccountCreationEmail({
      email: normalizedEmail,
      fullName: normalizedName,
      role,
      tempPassword,
      loginUrl,
    });

    const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: normalizedEmail,
      password: tempPassword,
      email_confirm: true,
      user_metadata: {
        full_name: normalizedName,
        phone: normalizedPhone,
        city: normalizedCity,
        role,
      },
    });

    if (authError || !authUser.user) {
      console.error('[AUTH_ERROR]', authError);
      const message = authError?.message?.toLowerCase().includes('already')
        ? 'User already exists with this email'
        : 'Failed to create auth user';
      return res.status(message.includes('already') ? 409 : 500).json({ error: message });
    }

    const { error: profileError } = await supabaseAdmin.from('profiles').upsert({
      id: authUser.user.id,
      email: normalizedEmail,
      full_name: normalizedName,
      phone: normalizedPhone,
      city: normalizedCity,
      role,
      status: 'active',
      deleted_at: null,
      updated_at: new Date().toISOString(),
    });

    if (profileError) {
      console.error('[PROFILE_ERROR]', profileError);
      await supabaseAdmin.auth.admin.deleteUser(authUser.user.id);
      return res.status(500).json({ error: 'Failed to create user profile' });
    }

    // The account already exists in auth + profiles at this point. The welcome
    // email is a convenience (it carries the temp password), NOT a precondition
    // for the user existing — so a missing/failing email provider must not roll
    // back a good account. We report whether the mail went out and always return
    // the temp password so the admin can relay the credentials by hand.
    const emailResult = await sendEmail(emailData);
    if (!emailResult.success) {
      console.error('[EMAIL_ERROR]', emailResult.error);
    }

    return res.status(201).json({
      success: true,
      userId: authUser.user.id,
      emailSent: emailResult.success,
      tempPassword,
      message: emailResult.success
        ? `User created and welcome email sent to ${normalizedEmail}`
        : `User created, but the welcome email could not be sent. Share the temporary password manually.`,
    });
  } catch (error) {
    console.error('[API_ERROR]', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
}
