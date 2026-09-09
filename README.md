# The Director's Chair

Confessional-cast filmmaking platform. Netlify + Netlify Database (Postgres) + Netlify Blobs + Stripe.

## What's in this repo

```
index.html                 Home
submitter-profile.html     Writer identity — collected once, carried into Call Sheet via sessionStorage
cast-profile.html          Casting application — posts to /submit-casting
call-sheet.html            The dual-path submission form (Preset / Original)
admin/index.html           Password-gated admin dashboard — every submission + casting applicant

netlify.toml                                Functions directory + admin no-index header
netlify/database/migrations/                 Schema — applied automatically by Netlify on deploy
netlify/functions/
  lib/db.mts                                 Shared DB driver
  lib/auth.mts                               Shared admin-auth check
  submit-story.mts                           Call Sheet submission (both paths)
  submit-casting.mts                         Casting application submission
  create-checkout-session.mts                Starts a real $10 Stripe Checkout for Path B
  stripe-webhook.mts                         Verifies Stripe signature, marks submissions paid
  get-submission.mts                         Minimal public lookup — powers the confirmation
                                              screen after a Stripe redirect wipes page state
  admin-login.mts                            Password check for the dashboard login screen
  admin-list-submissions.mts                 GET — every submission, joined with writer info
  admin-update-submission.mts                POST — Select / Not Selected / Close, with the
                                              exact locked transition rules (Second Look, etc.)
  admin-list-casting.mts                     GET — every casting applicant
  admin-update-casting.mts                   POST — change an applicant's status
  second-look-sweep.mts                      Scheduled (daily) — auto-closes expired Second Look
```

## Required environment variables (Netlify → Site settings → Environment variables)

| Variable | Used by | Notes |
|---|---|---|
| `ADMIN_PASSWORD` | `admin-login`, every `admin-*` function | Pick anything. This is the only gate on `/admin` — treat it like a real password. |
| `STRIPE_SECRET_KEY` | `create-checkout-session`, `stripe-webhook` | From the Stripe dashboard. Use a test key first. |
| `STRIPE_WEBHOOK_SECRET` | `stripe-webhook` | Created when you add the webhook endpoint below — Stripe gives you this value at that point, not before. |

`@netlify/database` needs no connection string of its own — Netlify provisions and wires that up automatically the first time the site deploys with `@netlify/database` in `package.json`.

## One-time Stripe setup

1. In the Stripe dashboard → Developers → Webhooks → **Add endpoint**.
2. Endpoint URL: `https://<your-site>.netlify.app/stripe-webhook`
3. Event to send: `checkout.session.completed`
4. Stripe shows you the signing secret at that point — that's `STRIPE_WEBHOOK_SECRET`.

## First deploy

```bash
npm install
```

Then either:
- **Git-connected deploy** (recommended, matches your other sites): push this repo to GitHub, connect it in the Netlify UI, set the three env vars above, deploy.
- **Manual deploy**: `netlify deploy --prod` from this folder once the Netlify CLI is linked to a site.

On first deploy, Netlify reads `netlify/database/migrations/` and creates the `writers`, `submissions`, and `casting_applicants` tables automatically — nothing to run by hand.

## What's genuinely tested vs. what isn't

**Tested against real execution before you ever see it:**
- Database schema — run against real Postgres (22 checks: inserts, every status transition, the DB-level constraint that a Path A submission can never enter Second Look, the 30-day window math, the daily expiry sweep query).
- Every page's actual user flow — Playwright, real HTTP, real fetch calls (mocked backend responses standing in for the live functions): age/session redirect logic, both Call Sheet paths end to end, the Stripe-redirect edge case where in-memory state is wiped, casting form success and failure states.
- Admin dashboard — login flow (right password / wrong password), both list views with realistic data, filter chips, Second Look countdown, every action button's actual outgoing payload.
- Zero uncaught JS errors on any page.

**Not tested, because it requires live infrastructure this sandbox doesn't have:**
- The functions have never run against a real deployed Netlify Database or real Stripe keys — only against a local Postgres standing in for it, and mocked HTTP responses standing in for the functions themselves. The first real deploy is the first time this code touches the actual Netlify/Stripe runtime.
- Recommend testing the full Path B flow with a real Stripe **test-mode** key before switching to live keys.
