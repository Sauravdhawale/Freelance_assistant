# Arkentech Freelance Assistant — Netlify edition

**Netlify deployment: start with [NETLIFY_SETUP.md](NETLIFY_SETUP.md).** This edition adds Netlify API/background functions, distributed rate limits and production initialization. The original Docker deployment remains available below.

A freelance operations application: **React + Express + PostgreSQL + n8n**, with OpenAI-assisted matching/drafts, authorized email intake, SMTP/Telegram notifications, and an 8 PM India-time email report.

**This release is source code and deployment configuration, not an already connected live service.** It starts with an empty database. No freelance accounts, mailbox, API key, bot or VPS are connected by the archive. All live provider setup stays in your private environment.

## What this release does

| Area | Implemented behavior |
| --- | --- |
| Discovery | Four platform adapters normalize your authorized JSON/CSV imports and supported notification emails. IMAP polls a dedicated mailbox, verifies allowed senders, and checkpoints progress. It never fetches or scrapes listing pages. |
| Matching | Skill matching, hourly/fixed budget checks, currency, experience and recency filters. OpenAI produces scores when AI is explicitly enabled and a valid API key is configured; otherwise the dashboard labels results as rules-based. |
| Proposals | Customized plans, questions, editable estimates, verified profile/portfolio text, editable templates, explicit review, one proposal/application record per job, daily limits. Partial notification descriptions require your full authorized job description. |
| Submission | Ready-to-submit drafts, original platform links and manual confirmation records. **Automatic submission is not enabled in this build.** Unsupported submission requests are blocked and audited. No Connects, credits or memberships are purchased. |
| Client replies | Received email/import messages, exact link-based application matching, unlinked messages where association is uncertain, six reply categories, drafts that are never sent to clients. |
| Notifications | Durable SMTP and Telegram outbox, duplicate prevention, bounded retries, disconnected/error states and explicit handling of uncertain delivery outcomes. |
| Daily report | n8n schedule at **20:00 Asia/Kolkata**, including zero-activity days. Reports use database records and link to jobs/conversations. Email must be configured and enabled. |
| Fiverr | Incoming inquiries, response drafts and editable suggestions for your own Gig content. No conventional Fiverr job application or automated Gig publication. Live Gig-performance API retrieval is not supported. |
| Dashboard | Overview, All Jobs, Recommended Jobs, Applications, Client Replies, Interviews & Offers, Proposal Templates/Fiverr tools, Integrations, Notifications, Skills & Preferences, Automation Logs. |
| Operations | Persistent sessions, CSRF checks, per-owner authorization, validation, rate limits, migrations, workflow pause/resume, audit records, retention cleanup, encrypted backup/restore scripts and Docker deployment. |

## Platform permissions checked first

The official platform review is in [docs/platform-permissions.md](docs/platform-permissions.md), checked **20 October 2026**.

**Upwork does have approved API and MCP options, including proposal-related operations.** This project does not claim otherwise. However, an approved account/use case and a complete verified write contract were not available during implementation. Its official agent plugin also requires confirmation around writes. This release therefore ships the functioning email/import and reviewed manual-submission path. A checkbox cannot turn an unavailable, unverified connector into a permitted one.

For Fiverr, PeoplePerHour and Guru, this review did not verify a public marketplace application-submission API suitable for this implementation. Received notifications and your own authorized imports are the implemented sources. Read the evidence matrix before connecting or extending a platform adapter.

## Quick start

Requirements: Docker with Compose v2 and Node.js 24 LTS. No platform secrets are needed for the first local launch.

1. Extract the archive. Open a terminal in its `freelance-assistant` folder.
2. Generate private configuration, replacing the example with your email:

   ```bash
   node scripts/generate-env.mjs --email you@example.com
   ```

3. Open the newly generated `.env` in your local editor. Use its `ADMIN_EMAIL` and `ADMIN_PASSWORD` for the dashboard login. Do not paste `.env` into chat.
4. Start the services:

   ```bash
   docker compose up -d --build
   docker compose ps
   node scripts/smoke-check.mjs http://localhost:3000
   ```

5. Open **http://localhost:3000** for the dashboard and **http://localhost:5678** for n8n. n8n has a separate first-run owner setup.
6. Add your verified profile and portfolio, review your skills/preferences, and import your own authorized jobs. Rule-based scoring and clearly labelled template drafts work before OpenAI is connected.
7. Follow [docs/deployment.md](docs/deployment.md) to connect services and deploy on a VPS. Follow [docs/workflows.md](docs/workflows.md) to import and publish the six schedules.

The default ports are reachable locally or through an SSH tunnel. The optional Caddy profile provides HTTPS for a public dashboard and blocks the internal workflow endpoint from that public domain.

## What you must connect

| Feature | Private setup |
| --- | --- |
| AI matching and generation | `OPENAI_API_KEY`, optional `OPENAI_MODEL`; enable AI in Skills & Preferences. The default is `gpt-4.1-mini`, provided your account has access. |
| Received notifications | TLS IMAP mailbox/app credential, exact actual sender addresses, trusted mail-server authentication IDs. See [docs/email-import.md](docs/email-import.md). |
| Email alerts/report | SMTP settings plus your recipient address, then enable email and run the test in Notifications. |
| Telegram alerts | Your bot token and chat ID, then enable Telegram and run the test. Start a private chat with your bot first. |
| Scheduled execution | Import/publish the six n8n workflows and select the encrypted Header Auth credential containing the backend workflow token. |
| Hosting | Your local Docker machine or your own VPS/domain. Hosting purchase and live deployment are not performed by this archive. |

Use an approved app password or supported application credential when the provider requires it. If your organization does not allow that authentication method, use authorized imports rather than weakening account protections. Never paste passwords, browser cookies, API secrets or session tokens into chat.

## Daily use

1. **All Jobs:** import JSON/CSV, or let connected notification intake add supported opportunities. The source adapters preserve uncertainty: an unknown posting date stays unknown, and a notification excerpt does not become a complete job description.
2. **Job details:** add the full authorized scope, budget and work type. Confirm the full-description checkbox, save, then score the job.
3. **Proposal:** generate a draft, edit it and its estimate, and select **Mark ready** after review. Personal experience and portfolio references come from the information you provided in settings. AI-generated content still needs review.
4. **Original platform:** open the job, submit the reviewed proposal using the platform's native permitted process, then record the confirmation in the application. The stored status is explicitly based on your confirmation, not a fabricated API receipt.
5. **Client Replies:** read linked or unlinked messages, review their classifications and generate a response draft if useful. Copy a reviewed reply into the original platform yourself.
6. **Automation Logs:** inspect workflow summaries, failed imports, notifications and audit records. Retry eligible failures after fixing their cause. Delivery marked `unknown` is not blindly resent.

Workflow pause switches prevent new backend executions; they do not delete or unpublish n8n schedules. Pausing notifications also holds delivery triggered by reply intake. Already running operations finish their current action. Saved work remains in PostgreSQL.

## File map

| Location | Purpose |
| --- | --- |
| `backend/src/app.js` | Authenticated Express HTTP API and static dashboard serving. |
| `backend/src/auth.js` | Administrator bootstrap, password hashing, persistent sessions, CSRF and internal workflow authorization. |
| `backend/src/adapters/` | Upwork, Fiverr, PeoplePerHour and Guru source metadata, normalized imports and notification extraction. |
| `backend/src/mailbox.js` | Read-only TLS IMAP intake, sender authentication and durable UID checkpoints. |
| `backend/src/ai.js` | OpenAI Responses API, structured output validation, rules/template fallback and usage limits. |
| `backend/src/jobs.js` | Job import, filtering/scoring integration, proposals, review and submission recording. |
| `backend/src/messages.js` | Reply import, exact-link matching, classification and draft generation. |
| `backend/src/notifications.js` | Persistent SMTP/Telegram delivery queue. |
| `backend/src/workflows.js` | Idempotent workflow execution, pause gates, bounded batches, retries and retention. |
| `backend/src/reporting.js` | Database-backed overview, integration states and daily email content. |
| `backend/migrations/` | Versioned PostgreSQL schema. |
| `backend/test/` | Automated adapter, database, API and provider-boundary tests. |
| `frontend/src/` | React dashboard components, accessible controls and responsive styles. |
| `n8n/` | Six importable workflow JSON files; inactive until configured and published. |
| `deploy/` | Docker entrypoint, separate database role initialization and optional HTTPS proxy. |
| `scripts/` | Configuration generation, validation, smoke checking and encrypted backup/restore. |
| `examples/` | Clearly labelled fictional import examples. Never submit these to real platforms. |
| `docs/` | Platform evidence, architecture, deployment, email setup, workflow and testing documentation. |
| `.env.example` | Configuration reference; no real credentials. |
| `package-lock.json` | Locked dependency graph for reproducible installs. |

## Development and tests

```bash
npm ci
npm test
node scripts/config.test.mjs
node scripts/validate-workflows.mjs
npm run build
```

The integration suite runs the PostgreSQL engine through PGlite (WASM), with real SQL/schema behavior. It replaces only external provider boundaries with deterministic test implementations; it does not contact clients or submit applications. See [docs/testing.md](docs/testing.md) for the verification record and remaining live checks.

To develop against your own local PostgreSQL instance, point `DATABASE_URL` at it, run `npm run migrate`, then `npm run dev:api`. In another terminal run `npm run dev:web`. Set `APP_ORIGIN=http://localhost:5173` for Vite development. Return it to your served application's exact origin for production. Docker's internal database hostname `postgres` is only reachable inside its Docker network; do not use that hostname for a host-run development API.

## Important operational details

- This is a **single-owner installation**, not a hosted multi-tenant product. Records are still owner-scoped and sessions expire after eight hours.
- The initial administrator is created once. Changing `ADMIN_PASSWORD` later does not silently reset the stored account. To deliberately reset it after editing your private environment, run `docker compose exec app node backend/src/reset-password.js` after recreating the app with that environment. All existing sessions are revoked.
- Defaults: fixed minimum **USD 100**, hourly minimum **USD 15/hour**, minimum relevance **70**, recent-job window **14 days**, at most **5 applications/day**, platform spend ceiling **0**, AI disabled, automatic draft generation disabled. Change these in the dashboard. Unknown budgets require an explicit preference, and no exchange rates are assumed.
- The AI call limit is a call-count control, not a monetary provider billing cap. Set your provider's project controls as appropriate. No platform spending or purchase is initiated by this build.
- Reply classifications and estimates are suggestions. A message classified as an offer is not an accepted contract. Generic messages do not downgrade an existing application status, and older messages do not replace newer status updates.
- Notification outbox keys prevent repeated source processing from creating repeated alerts. SMTP/Telegram cannot provide a universal exactly-once guarantee across crashes: ambiguous delivery becomes `unknown` and requires checking the destination before a deliberate new send.
- Retention removes old received message bodies, notification payloads, raw-normalized email events and old workflow runs. Application/proposal records and audit history remain for tracking. The default message retention is 90 days.
- Encrypted backup instructions include both database state and the keys needed to restore n8n credentials. Keep backups and their decryption key separately. See the deployment guide before restoring over existing data.

## Extending official submission later

Do not replace the blocked submission route with browser automation or an invented endpoint. Add an adapter only after verifying the exact current official contract, the account's scopes and permitted use, required user confirmations, platform spending and idempotency semantics. Add provider-boundary tests, then test an authorized live action with a real confirmation. Preserve the manual path when access is unavailable.

No integration is described as live-tested merely because its configuration fields are filled in. The UI distinguishes import readiness, observed mailbox connectivity, provider test results and actual stored confirmations.
