import crypto from 'node:crypto';
import { serviceClient } from './_supabase.js';
import { loginPathForRole, sendAccessEmail } from './_accessEmail.js';
import { esc, layout } from './_email.js';

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

  // Credentials, next steps and the shared brand shell. This used to be ~100
  // lines of bespoke gradient HTML that looked like a different company from
  // every other message we send; it now goes through layout() in _email.js, so
  // the centred wordmark, heading and button follow the rest of the mail
  // automatically and there is one design to maintain instead of two.
  const credentials = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #EFDCE4;border-radius:14px;background:#FFFAFC;">
      <tr><td style="padding:16px 18px;">
        <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#9D556F;font-weight:700;margin-bottom:10px;">Your sign-in details</div>
        <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#775D66;margin-bottom:3px;">Email</div>
        <div style="font-family:Arial,Helvetica,sans-serif;font-size:14.5px;color:#241019;font-weight:700;word-break:break-word;margin-bottom:12px;">${esc(email)}</div>
        <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#775D66;margin-bottom:5px;">Temporary password</div>
        <div style="display:inline-block;padding:10px 14px;border-radius:10px;background:#FFFFFF;border:1px solid #EDD5DF;font-family:'Courier New',Courier,monospace;font-size:17px;letter-spacing:.1em;color:#651B36;font-weight:700;">${esc(tempPassword)}</div>
      </td></tr>
    </table>`;

  const steps = ['Open your account with the button below.', 'Sign in with the temporary password above.', 'Change it to something only you know, and finish your profile.']
    .map(
      (step, i) =>
        `<tr>
          <td width="30" valign="top" style="padding:0 0 10px;">
            <div style="width:22px;height:22px;border-radius:999px;background:#B02454;color:#FFFFFF;text-align:center;line-height:22px;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:700;">${i + 1}</div>
          </td>
          <td style="padding:1px 0 10px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#4B3840;">${esc(step)}</td>
        </tr>`,
    )
    .join('');

  return {
    to: email,
    subject: `Welcome to MangaiMart — your ${roleLabel.toLowerCase()} is ready`,
    html: layout({
      heading: `Welcome, ${fullName}`,
      intro: `Your ${roleLabel} has been created by the MangaiMart team. ${roleDetail}`,
      bodyHtml:
        credentials +
        `<div style="margin:22px 0 10px;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:700;color:#241019;">Next steps</div>` +
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${steps}</table>`,
      ctaLabel: 'Access your account',
      ctaHref: loginUrl,
      footerNote:
        'The temporary password is single-use in spirit — please change it the first time you sign in. If you were not expecting this invitation, contact support@mangaimart.com before signing in.',
      tagline: 'This is a message about your MangaiMart account, not marketing.',
    }),
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
