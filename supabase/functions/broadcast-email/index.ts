/**
 * Email broadcast — one message from the admin console to every buyer and/or
 * seller, in their inbox rather than the notification bell.
 *
 * WHY THIS IS A SUPABASE EDGE FUNCTION AND NOT `api/`
 * `api/` holds exactly 12 routes, the Vercel Hobby ceiling; a thirteenth fails
 * the deploy. Same escape hatch as payout-advice and the Shiprocket pair. It is
 * also the better home for this particular job: a blast walks a list in chunks
 * with a pause between them, which is a poor fit for a request-scoped serverless
 * function that has to answer a browser inside its timeout.
 *
 * WHO MAY CALL IT
 * Admins only — checked with `is_admin()` against the CALLER'S OWN JWT, never
 * anything in the body. Note this is stricter than the in-app bell broadcast,
 * which 0086 deliberately widened to staff: sending a notification an employee
 * can see the effect of is part of their job, while mailing the entire customer
 * base is unrecallable and goes out under the company's sending domain.
 *
 * CONSENT
 * The three marketing templates skip anyone with `marketing_opt_out` (0089) and
 * carry a working one-click unsubscribe — both a footer link and the
 * `List-Unsubscribe` headers that Gmail and Yahoo require of bulk senders. The
 * `service` template is an operational notice and ignores the flag, which is why
 * it is also the one template that must never be used to sell anything.
 *
 * FAILURE POSTURE
 * Every send is written to `email_broadcasts` BEFORE the first message leaves and
 * updated with the result, so a function that dies halfway still leaves a record
 * pointing at what went out. A provider error is reported to the console as a
 * count, not thrown: with a partial send, "which 40 of 60 got it" is the useful
 * answer and an exception would discard it.
 *
 * DEPLOY
 *   supabase functions deploy broadcast-email
 *   supabase secrets set RESEND_API_KEY=... EMAIL_FROM=... APP_URL=...
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const BRAND = 'MangaiMart';
const APP_URL = (Deno.env.get('APP_URL') ?? 'https://mangaimart.com').replace(/\/$/, '');
const SUPPORT_EMAIL = 'support@mangaimart.com';

/** Resend accepts at most 100 messages per batch call. */
const BATCH_SIZE = 100;
/** Its default rate limit is 2 requests/second; one pause per chunk stays clear. */
const CHUNK_PAUSE_MS = 600;

type Template = 'announcement' | 'arrivals' | 'festival' | 'feature' | 'service';

/**
 * Which templates are marketing. Everything here honours `marketing_opt_out` and
 * carries an unsubscribe link. `service` is deliberately absent — a delivery
 * delay or a policy change is operational, the same footing as an order receipt.
 */
const MARKETING_TEMPLATES: Template[] = ['announcement', 'arrivals', 'festival', 'feature'];

const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const inr = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');

/**
 * Mirrors `imageUrl()` in src/lib/imageUrl.ts. A 2 MB phone photo in an email is
 * worse than on the web — many clients download every image before showing the
 * message, and Gmail clips anything over 102 kB of HTML.
 */
function thumb(src: string | null, width = 480): string {
  const s = String(src ?? '');
  if (!s.includes('/storage/v1/object/public/')) return s;
  return `${s.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/')}?width=${width}&quality=70&resize=contain`;
}

/**
 * Only ever link somewhere a browser will treat as a web page. The CTA URL is
 * admin-typed and lands in an anchor href in thousands of inboxes; `javascript:`
 * and `data:` are refused rather than escaped, because there is no legitimate
 * reason for either and a mail client that honours one is a real problem.
 */
function safeUrl(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith('/')) return APP_URL + s;
  return '';
}

/**
 * Admin-typed plain text → HTML paragraphs and bullets.
 *
 * Escaped first, so nothing typed in the composer can restructure the message.
 * A line beginning `- ` or `• ` becomes a list item; blank lines separate
 * paragraphs. That is the whole grammar — anything richer belongs in a template,
 * not in a text box an operator uses under time pressure.
 */
function richText(body: string, color = '#4B3840'): string {
  const blocks = String(body ?? '').replace(/\r\n/g, '\n').split(/\n{2,}/);
  return blocks
    .map((block) => {
      const lines = block.split('\n').filter((l) => l.trim().length > 0);
      if (!lines.length) return '';
      const isList = lines.every((l) => /^\s*[-•]\s+/.test(l));
      if (isList) {
        const items = lines
          .map(
            (l) =>
              `<li style="margin:0 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:14.5px;line-height:1.7;color:${color};">${esc(
                l.replace(/^\s*[-•]\s+/, ''),
              )}</li>`,
          )
          .join('');
        return `<ul style="margin:0 0 14px;padding-left:20px;">${items}</ul>`;
      }
      return `<p style="margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;font-size:14.5px;line-height:1.75;color:${color};">${esc(
        lines.join(' '),
      ).replace(/\n/g, '<br />')}</p>`;
    })
    .join('');
}

function ctaButton(label: string, href: string): string {
  if (!href) return '';
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 4px;"><tr><td style="border-radius:10px;background:#B02454;">
    <a href="${esc(href)}" style="display:inline-block;padding:13px 26px;font-family:Arial,Helvetica,sans-serif;font-size:14.5px;font-weight:700;color:#FFFFFF;text-decoration:none;">${esc(label || 'Shop now')}</a>
  </td></tr></table>`;
}

type Product = {
  id: string;
  title: string;
  price: number;
  mrp: number | null;
  image_url: string | null;
  slug: string | null;
};

/**
 * The product grid for the "new arrivals" template — a two-column table, because
 * flexbox and CSS grid do not exist in Outlook and never will.
 */
function productGrid(products: Product[]): string {
  if (!products.length) return '';
  const cell = (p: Product) => {
    const href = `${APP_URL}/products/${encodeURIComponent(p.slug || p.id)}`;
    const off = p.mrp && Number(p.mrp) > Number(p.price)
      ? `<span style="font-size:12px;color:#836B74;text-decoration:line-through;margin-left:6px;">${inr(Number(p.mrp))}</span>`
      : '';
    return `<td width="50%" style="padding:8px;vertical-align:top;">
      <a href="${esc(href)}" style="text-decoration:none;color:inherit;display:block;">
        <img src="${esc(thumb(p.image_url))}" width="240" alt="${esc(p.title)}" style="width:100%;max-width:240px;height:auto;border-radius:12px;border:1px solid #EFDCE4;display:block;" />
        <div style="margin-top:8px;font-family:Arial,Helvetica,sans-serif;font-size:13.5px;line-height:1.45;color:#241019;font-weight:600;">${esc(p.title)}</div>
        <div style="margin-top:3px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#B02454;font-weight:700;">${inr(Number(p.price))}${off}</div>
      </a>
    </td>`;
  };

  const rows: string[] = [];
  for (let i = 0; i < products.length; i += 2) {
    const pair = products.slice(i, i + 2);
    rows.push(`<tr>${pair.map(cell).join('')}${pair.length === 1 ? '<td width="50%"></td>' : ''}</tr>`);
  }
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 10px;">${rows.join('')}</table>`;
}

type ShellArgs = {
  template: Template;
  preheader: string;
  heading: string;
  bodyHtml: string;
  unsubscribeUrl: string;
};

/**
 * The brand shell.
 *
 * Kept deliberately identical to `layout()` in api/_email.js and payout-advice —
 * a person who gets an order receipt and a sale announcement should not feel they
 * came from two companies. If the shell changes, change all three.
 *
 * Colours are literal hex, the one place the `--ag-*` token rule does not apply:
 * a mail client has never seen our stylesheet and cannot resolve a CSS variable.
 */
function shell({ template, preheader, heading, bodyHtml, unsubscribeUrl }: ShellArgs): string {
  const isService = template === 'service';
  const accentBar = template === 'festival'
    ? 'background:linear-gradient(135deg,#7F173D 0%,#B02454 55%,#D85B83 100%);'
    : 'background:#B02454;';

  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${esc(heading)}</title></head>
<body style="margin:0;padding:0;background:#FBF6F2;">
<!-- Preview text: what the inbox list shows next to the subject. The spacer
     stops the client filling the rest of the preview with the header markup. -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">&#847;&zwnj;&nbsp;&#8199;&shy;${'&#847;&zwnj;&nbsp;&#8199;&shy;'.repeat(40)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FBF6F2;padding:24px 12px;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:16px;overflow:hidden;border:1px solid #EFDCE4;">
    <tr><td style="${accentBar}padding:18px 24px;">
      <span style="color:#FFFFFF;font-family:Georgia,'Times New Roman',serif;font-size:20px;font-weight:700;letter-spacing:.02em;">${BRAND}</span>
    </td></tr>
    ${isService ? `<tr><td style="padding:16px 24px 0;">
      <span style="display:inline-block;padding:5px 11px;border-radius:999px;background:#FFF4E0;color:#8A6D00;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;">Service update</span>
    </td></tr>` : ''}
    <tr><td style="padding:26px 24px 6px;">
      <h1 style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:23px;line-height:1.28;color:#241019;font-weight:700;">${esc(heading)}</h1>
    </td></tr>
    <tr><td style="padding:14px 24px 6px;">${bodyHtml}</td></tr>
    <tr><td style="padding:18px 24px 26px;border-top:1px solid #F4E7ED;">
      <p style="margin:0 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:11.5px;line-height:1.6;color:#836B74;">
        ${BRAND} — ethnic wear from verified independent boutiques.<br />
        Questions? Write to <a href="mailto:${SUPPORT_EMAIL}" style="color:#B02454;text-decoration:none;">${SUPPORT_EMAIL}</a>.
      </p>
      ${unsubscribeUrl ? `<p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11.5px;line-height:1.6;color:#836B74;">
        You are receiving this because you have a ${BRAND} account.
        <a href="${esc(unsubscribeUrl)}" style="color:#836B74;text-decoration:underline;">Unsubscribe from marketing email</a>.
        You will still get order and account messages.
      </p>` : `<p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11.5px;line-height:1.6;color:#836B74;">
        This is a service message about your ${BRAND} account, not marketing.
      </p>`}
    </td></tr>
  </table>
</td></tr>
</table>
</body></html>`;
}

type Payload = {
  template: Template;
  heading: string;
  body: string;
  preheader: string;
  ctaLabel: string;
  ctaUrl: string;
  products: Product[];
};

/**
 * The five templates. Each one decides what sits between the heading and the
 * footer; the shell and the consent rules are shared so a new template cannot
 * accidentally ship without an unsubscribe link.
 */
function renderBody(p: Payload, greetingName: string): string {
  const hello = greetingName
    ? `<p style="margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;font-size:14.5px;line-height:1.75;color:#4B3840;">Hello ${esc(greetingName)},</p>`
    : '';
  const cta = ctaButton(p.ctaLabel, p.ctaUrl);

  switch (p.template) {
    case 'arrivals':
      return hello + richText(p.body) + productGrid(p.products) + cta;

    case 'festival':
      // Centred, no hard sell, generous spacing — a greeting that opens with a
      // discount code reads as an ad wearing a greeting's clothes.
      return `<div style="text-align:center;">
        ${richText(p.body)}
        <div style="margin:18px auto;width:64px;height:2px;background:#EFDCE4;"></div>
        ${cta}
      </div>`;

    case 'feature':
      return (
        hello +
        richText(p.body) +
        `<div style="margin:16px 0;padding:14px 16px;background:#FBF6F2;border:1px solid #EFDCE4;border-radius:12px;">
          <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.6;color:#775D66;">
            Already in the app — open ${BRAND} and you will see it. Nothing to install.
          </p>
        </div>` +
        cta
      );

    case 'service':
      // No greeting, no flourish. Someone skims this for one fact.
      return richText(p.body) + cta;

    case 'announcement':
    default:
      return hello + richText(p.body) + cta;
  }
}

type Recipient = { id: string; email: string; full_name: string | null; unsubscribe_token: string };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);

  const asCaller = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
  );

  // Admin, not staff. See the header comment.
  const { data: isAdmin, error: adminErr } = await asCaller.rpc('is_admin');
  if (adminErr || isAdmin !== true) return json({ error: 'Admin only' }, 403);

  let raw: Record<string, unknown>;
  try {
    raw = (await req.json()) ?? {};
  } catch {
    return json({ error: 'Invalid body' }, 400);
  }

  const template = String(raw.template ?? 'announcement') as Template;
  const audience = String(raw.audience ?? 'all');
  const subject = String(raw.subject ?? '').trim();
  const heading = String(raw.heading ?? '').trim() || subject;
  const bodyText = String(raw.body ?? '').trim();
  const preheader = String(raw.preheader ?? '').trim();
  const ctaLabel = String(raw.ctaLabel ?? '').trim();
  const ctaUrl = safeUrl(raw.ctaUrl);
  const productIds = Array.isArray(raw.productIds) ? raw.productIds.slice(0, 6).map(String) : [];
  // Hand-picked recipients (audience = 'selected'). Capped: this is the "email
  // these four sellers" path, and anything longer is a role blast wearing a
  // disguise — which would skip the reach count and the confirm step that go
  // with one.
  const recipientIds = Array.isArray(raw.recipientIds) ? raw.recipientIds.slice(0, 50).map(String) : [];
  const alsoNotify = raw.alsoNotify === true;
  const isTest = raw.test === true;

  if (!(['announcement', 'arrivals', 'festival', 'feature', 'service'] as string[]).includes(template)) {
    return json({ error: `Unknown template: ${template}` }, 400);
  }
  // Same allow-list as broadcast_notification (0050/0088), plus 'selected'. An
  // unrecognised audience there silently matched nobody and reported a
  // successful send.
  if (!['all', 'buyer', 'seller', 'selected'].includes(audience)) {
    return json({ error: `Unknown audience: ${audience}` }, 400);
  }
  if (audience === 'selected' && !recipientIds.length && !isTest) {
    return json({ error: 'Pick at least one person to email' }, 400);
  }
  if (!subject) return json({ error: 'A subject line is required' }, 400);
  if (!bodyText) return json({ error: 'A message body is required' }, 400);
  if (raw.ctaUrl && !ctaUrl) {
    return json({ error: 'The button link must be a full http(s) URL or start with /' }, 400);
  }

  const db = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  );

  const { data: caller } = await asCaller.auth.getUser();
  const actorId = caller?.user?.id ?? null;

  // ── Resolve the audience ───────────────────────────────────────────────────
  let recipients: Recipient[] = [];
  let skippedOptOut = 0;

  if (isTest) {
    // A test goes to the admin who pressed the button and nobody else — the one
    // address we know they are entitled to mail.
    const { data: me } = await db
      .from('profiles')
      .select('id, email, full_name, unsubscribe_token')
      .eq('id', actorId ?? '')
      .maybeSingle();
    if (!me?.email) return json({ ok: false, error: 'Your own account has no email address on file' }, 200);
    recipients = [me as Recipient];
  } else {
    // Two ways to resolve an audience. A role blast is an allow-list of buyer and
    // seller (0050: the audience is the marketplace, never the people running
    // it). A hand-picked list is exactly the ids the admin chose — including a
    // colleague, which is legitimate when you are emailing four named people and
    // never is when you are emailing "everyone".
    const base = db
      .from('profiles')
      .select('id, email, full_name, unsubscribe_token, marketing_opt_out')
      .is('deleted_at', null)
      // A blocked account is not an audience — they cannot even sign in.
      .eq('status', 'active')
      .not('email', 'is', null);

    const { data: rows, error: rowsErr } = await (audience === 'selected'
      ? base.in('id', recipientIds)
      : base.in('role', audience === 'all' ? ['buyer', 'seller'] : [audience]));
    if (rowsErr) {
      const missing = /marketing_opt_out|unsubscribe_token/.test(rowsErr.message ?? '');
      return json(
        { ok: false, error: missing ? 'Email broadcasts are not enabled yet — apply migration 0089.' : rowsErr.message },
        200,
      );
    }

    const all = (rows ?? []) as (Recipient & { marketing_opt_out: boolean })[];
    const marketing = MARKETING_TEMPLATES.includes(template);
    // The opt-out is per person and holds however they were selected — picking
    // someone by name does not un-unsubscribe them. The console reports the skip
    // so the admin knows the mail did not go, rather than assuming it did.
    const kept = marketing ? all.filter((r) => !r.marketing_opt_out) : all;
    skippedOptOut = all.length - kept.length;
    recipients = kept.filter((r) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(r.email ?? '')));
  }

  if (!recipients.length) {
    return json({ ok: false, error: 'Nobody in this audience has an email address we can send to.' }, 200);
  }

  // ── Products, for the arrivals template ────────────────────────────────────
  let products: Product[] = [];
  if (template === 'arrivals' && productIds.length) {
    const { data: rows } = await db
      .from('products')
      .select('id, title, price, mrp, image_url, slug')
      .in('id', productIds);
    // Preserve the order the admin picked them in — `in` does not.
    const byId = new Map((rows ?? []).map((r) => [String(r.id), r as Product]));
    products = productIds.map((id) => byId.get(id)).filter(Boolean) as Product[];
  }

  // ── Record the send before anything leaves ─────────────────────────────────
  let broadcastId: string | null = null;
  if (!isTest) {
    const { data: logRow } = await db
      .from('email_broadcasts')
      .insert({
        actor_id: actorId,
        actor_name: caller?.user?.email ?? null,
        audience,
        template,
        subject,
        preheader,
        heading,
        body: bodyText,
        cta_label: ctaLabel || null,
        cta_url: ctaUrl || null,
        product_ids: products.map((p) => p.id),
        recipient_ids: audience === 'selected' ? recipients.map((r) => r.id) : [],
        recipients: recipients.length,
        skipped_opt_out: skippedOptOut,
        status: 'sending',
      })
      .select('id')
      .maybeSingle();
    broadcastId = logRow?.id ? String(logRow.id) : null;
  }

  const resendApiKey = Deno.env.get('RESEND_API_KEY');
  if (!resendApiKey) {
    // Inert rather than broken — the same posture api/_email.js takes.
    console.log('[broadcast-email skipped — RESEND_API_KEY unset]', { subject, recipients: recipients.length });
    if (broadcastId) {
      await db.from('email_broadcasts').update({ status: 'failed', error: 'RESEND_API_KEY unset' }).eq('id', broadcastId);
    }
    return json({ ok: false, error: 'Email provider is not configured on this Supabase project' }, 200);
  }

  const from = Deno.env.get('EMAIL_FROM') ?? `${BRAND} <noreply@mangaimart.com>`;
  const marketing = MARKETING_TEMPLATES.includes(template);

  // Both the footer link and the List-Unsubscribe header point at the public
  // `unsubscribe` function, not at the storefront route. It is the only one of
  // the two that can honour RFC 8058's POST — see that function's header — and a
  // human clicking it is redirected on to the pretty page anyway, so one URL
  // serves both readers.
  const unsubscribeBase = `${(Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '')}/functions/v1/unsubscribe`;

  const messageFor = (r: Recipient) => {
    const unsubscribeUrl = marketing ? `${unsubscribeBase}?t=${encodeURIComponent(r.unsubscribe_token)}` : '';
    const firstName = String(r.full_name ?? '').trim().split(/\s+/)[0] ?? '';
    const html = shell({
      template,
      preheader: preheader || bodyText.slice(0, 140),
      heading,
      bodyHtml: renderBody({ template, heading, body: bodyText, preheader, ctaLabel, ctaUrl, products }, firstName),
      unsubscribeUrl,
    });
    return {
      from,
      to: [r.email],
      subject: isTest ? `[TEST] ${subject}` : subject,
      html,
      reply_to: SUPPORT_EMAIL,
      // Gmail and Yahoo require one-click unsubscribe from bulk senders; without
      // these headers a marketing blast is far likelier to land in Promotions or
      // Spam, which would drag the transactional mail down with it.
      ...(unsubscribeUrl
        ? {
            headers: {
              'List-Unsubscribe': `<${unsubscribeUrl}>`,
              'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
            },
          }
        : {}),
    };
  };

  let sent = 0;
  let failed = 0;
  let lastError = '';

  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    const chunk = recipients.slice(i, i + BATCH_SIZE);
    try {
      const res = await fetch('https://api.resend.com/emails/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendApiKey}` },
        body: JSON.stringify(chunk.map(messageFor)),
        signal: AbortSignal.timeout(20000),
      });
      if (res.ok) {
        sent += chunk.length;
      } else {
        failed += chunk.length;
        const detail = await res.json().catch(() => null);
        lastError = detail?.message ?? detail?.error?.message ?? `HTTP ${res.status}`;
        console.error('[broadcast-email chunk failed]', lastError);
      }
    } catch (e) {
      failed += chunk.length;
      lastError = e instanceof Error ? e.message : String(e);
      console.error('[broadcast-email chunk threw]', lastError);
    }
    if (i + BATCH_SIZE < recipients.length) {
      await new Promise((r) => setTimeout(r, CHUNK_PAUSE_MS));
    }
  }

  // ── Mirror into the notification bell, if asked ────────────────────────────
  //
  // Called with the CALLER'S token, not the service role: broadcast_notification
  // is SECURITY DEFINER and gates on is_staff(), which is false under the service
  // role because auth.uid() is null there.
  //
  // Skipped for a hand-picked send: broadcast_notification fans out by ROLE and
  // has no notion of "these four people", so mirroring a selected send would put
  // the message in front of an entire audience the admin did not choose. It
  // raises 'unknown audience: selected' rather than doing that, and the console
  // hides the checkbox to match.
  let alsoNotified = false;
  if (alsoNotify && !isTest && audience !== 'selected') {
    const { error: notifyErr } = await asCaller.rpc('broadcast_notification', {
      p_audience: audience,
      p_title: heading.slice(0, 80),
      p_body: bodyText.slice(0, 280),
    });
    alsoNotified = !notifyErr;
    if (notifyErr) console.error('[broadcast-email bell mirror failed]', notifyErr.message);
  }

  if (broadcastId) {
    await db
      .from('email_broadcasts')
      .update({
        sent,
        failed,
        also_notified: alsoNotified,
        status: failed === 0 ? 'sent' : sent === 0 ? 'failed' : 'partial',
        error: lastError || null,
      })
      .eq('id', broadcastId);
  }

  return json({
    ok: sent > 0,
    broadcastId,
    recipients: recipients.length,
    sent,
    failed,
    skippedOptOut,
    alsoNotified,
    test: isTest,
    error: sent === 0 ? lastError || 'Nothing was sent' : failed > 0 ? `${failed} message(s) failed: ${lastError}` : '',
  });
});
