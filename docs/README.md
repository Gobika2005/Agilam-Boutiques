# Agilam Boutique — documentation

The repo root holds only `README.md` (how to run the app) and `CLAUDE.md` (the
working rules). Everything else lives here, in four groups:

| Folder | What it is | Still true? |
|---|---|---|
| `setup/` | Dashboard/console steps you follow to configure a service | Yes — keep current |
| `architecture/` | How a shipped subsystem actually works | Yes — describes live code |
| `plans/` | Designed but **not built** | Pending |
| `archive/` | Dated one-off reports, finished when written | Historical — do not update |

New QA reports and audits go in `archive/<YYYY-MM>/`.

---

## setup/ — you do these in a dashboard, not in code

| Doc | Covers |
|---|---|
| [ENVIRONMENTS.md](setup/ENVIRONMENTS.md) | The test → production split, promoted by a git merge |
| [AUTH_EMAIL_SETUP.md](setup/AUTH_EMAIL_SETUP.md) | Resend SMTP behind Supabase Auth email |
| [WHATSAPP_SETUP_2026-08-18.md](setup/WHATSAPP_SETUP_2026-08-18.md) | Meta Cloud API credentials, templates, build log |

## architecture/ — how the shipped systems work

| Doc | Covers |
|---|---|
| [COURIER_TRACKING_PLAN.md](architecture/COURIER_TRACKING_PLAN.md) | Courier + AWB capture, buyer tracking, payout gating |
| [SHIPROCKET_INTEGRATION_2026-08-10.md](architecture/SHIPROCKET_INTEGRATION_2026-08-10.md) | Courier booking and scan-based delivery, as Edge Functions |
| [WHATSAPP_AUTOMATION_PLAN.md](architecture/WHATSAPP_AUTOMATION_PLAN.md) | The outbox + triggers design the setup sheet implements |
| [STAFF_ROLE_2026-08-14.md](architecture/STAFF_ROLE_2026-08-14.md) | The restricted employee console login (migration 0086) |
| [ASK_MY_PEOPLE_2026-08-12.md](architecture/ASK_MY_PEOPLE_2026-08-12.md) | Shareable shortlist boards; the token is the credential |
| [SELLER_SITE_2026-08-14.md](architecture/SELLER_SITE_2026-08-14.md) | The public `/sell` recruitment site |
| [GLOBAL_SEARCH_2026-08-13.md](architecture/GLOBAL_SEARCH_2026-08-13.md) | One search engine across all three consoles |
| [COD_REMOVAL_2026-08-14.md](architecture/COD_REMOVAL_2026-08-14.md) | Why cash on delivery is gone and why its columns stayed |
| [PAYOUT_DELIVERY_GATE_2026-08-12.md](architecture/PAYOUT_DELIVERY_GATE_2026-08-12.md) | Delivered-only payouts on an 8-hour clock |
| [SEO_COMPLETION_REPORT.md](architecture/SEO_COMPLETION_REPORT.md) | The finished SEO layer — meta, JSON-LD, sitemaps, feed |

## plans/ — not built

| Doc | Covers |
|---|---|
| [SMS_OTP_PLAN_2026-08-15.md](plans/SMS_OTP_PLAN_2026-08-15.md) | Phone OTP sign-in + seller SMS alerts. Nothing built, no migration written. |

## archive/ — finished reports, kept for the record

**2026-07** — [ADMIN_GAP_ANALYSIS](archive/2026-07/ADMIN_GAP_ANALYSIS.md) ·
[ADMIN_IMPLEMENTATION_REPORT](archive/2026-07/ADMIN_IMPLEMENTATION_REPORT.md)

**2026-08, console tests** — [ADMIN_CONSOLE_QA_REPORT](archive/2026-08/ADMIN_CONSOLE_QA_REPORT.md) ·
[SELLER_CONSOLE_QA_REPORT](archive/2026-08/SELLER_CONSOLE_QA_REPORT.md) ·
[MANGAIMART_FULL_QA_REPORT](archive/2026-08/MANGAIMART_FULL_QA_REPORT.md) ·
[MANGAIMART_QA_REPORT_PASS2](archive/2026-08/MANGAIMART_QA_REPORT_PASS2.md) ·
[MANGAIMART_FUNCTIONAL_TEST_2026-08-11](archive/2026-08/MANGAIMART_FUNCTIONAL_TEST_2026-08-11.md) ·
[MANGAIMART_UI_UX_AUDIT](archive/2026-08/MANGAIMART_UI_UX_AUDIT.md) ·
[REAL_WORLD_TEST_PLAN](archive/2026-08/REAL_WORLD_TEST_PLAN.md) ·
[QA_TEST_ARTIFACTS](archive/2026-08/QA_TEST_ARTIFACTS.md)

**2026-08, security** — [SECURITY_AUDIT_2026-08-11](archive/2026-08/SECURITY_AUDIT_2026-08-11.md)

**2026-08, SEO** — [SEO_AUDIT_REPORT](archive/2026-08/SEO_AUDIT_REPORT.md) ·
[SEO_IMPLEMENTATION_REPORT](archive/2026-08/SEO_IMPLEMENTATION_REPORT.md) ·
[SEO_AUDIT_2026-08-11](archive/2026-08/SEO_AUDIT_2026-08-11.md) ·
[SEO_INDEXING_FIX_2026-08-11](archive/2026-08/SEO_INDEXING_FIX_2026-08-11.md) ·
[SEO_INDEXING_FIX_2026-08-12](archive/2026-08/SEO_INDEXING_FIX_2026-08-12.md) ·
[SEO_SEARCH_VISIBILITY_PLAN_2026-08-10](archive/2026-08/SEO_SEARCH_VISIBILITY_PLAN_2026-08-10.md)

**2026-08, performance** — [PAGESPEED_LCP_FIX](archive/2026-08/PAGESPEED_LCP_FIX.md) ·
[PERFORMANCE_AUDIT_2026-08-10](archive/2026-08/PERFORMANCE_AUDIT_2026-08-10.md) ·
[PERFORMANCE_FIXES_2026-08-10](archive/2026-08/PERFORMANCE_FIXES_2026-08-10.md)

---

[qa-test-prompt.md](qa-test-prompt.md) — the full-application test brief a QA
pass is run from (was `supabase/testingagent`, which had no extension and sat  among the SQL).
