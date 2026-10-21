# Arkentech Freelance Assistant — Netlify setup

This package contains the React dashboard, its Express API adapted to Netlify Functions, a background worker, PostgreSQL migrations, and six n8n workflows. The production dashboard is deployed at https://freelancebooxgen.netlify.app. Its dedicated Neon PostgreSQL database is `freelance_assistant` in the `freelance-assistant` project. Production environment settings must be applied through a new Netlify deployment before the service can connect. Automatic marketplace submission is disabled; proposals are reviewed and submitted manually.

## 1. Where each component runs

| Component | Location |
| --- | --- |
| Dashboard and sign-in | Netlify static hosting |
| Authenticated API | Netlify Function `api` |
| Longer automation runs | Netlify background Function `workflow-worker` |
| Jobs, sessions, proposals, messages, audit history | Separate hosted PostgreSQL database |
| Schedules and workflow triggers | Your existing n8n installation, or another separately hosted n8n |
| AI, email and Telegram | Your configured external providers |

Netlify does not run the included Docker Compose stack or a persistent n8n server. Use the `n8n-netlify/` workflows for this deployment, not the Docker URLs in `n8n/`. The database and n8n must be reachable from their respective hosting services. Use a dedicated database with a TLS-enabled pooled connection string suitable for serverless workloads. Each warm API/worker instance uses at most two database connections; configure your provider's pool and connection limits accordingly. Do not use a database belonging to another production application.

## 2. Install the source

Extract the ZIP, open a terminal in `freelance-assistant`, and install Node.js 24 LTS. Then:

```bash
npm ci
npm run build
```

Do not drag only `frontend/dist` into Netlify: it contains the interface, but not the API or background worker. Deploy the full source through Git or the Netlify CLI.

## 3. Create and configure your Netlify project

Recommended: put this source into a private GitHub repository and import that repository into Netlify. Use the folder containing `netlify.toml` as the repository/base directory. The configuration supplies:

- Build command: `npm run build`
- Publish directory: `frontend/dist`
- Functions directory: `netlify/functions`
- Node version: 24

Choose the final HTTPS site URL. In Netlify's environment-variable settings, configure the following for **Functions** and the production deployment context. Set the same values in a local `.env` file for the one-time setup. Never commit `.env`, `.netlify`, passwords, tokens or database credentials. `.netlify` is ignored because linking a Netlify project writes local project metadata there.

| Variable | Required value |
| --- | --- |
| `DATABASE_URL` | Dedicated hosted PostgreSQL connection string; use provider-recommended TLS and pooling settings |
| `ADMIN_EMAIL` | Your administrator email |
| `ADMIN_NAME` | Your display name, for example Arkentech |
| `APP_ORIGIN` | Exact HTTPS Netlify/custom domain origin, with no path, query or fragment |
| `COOKIE_SECURE` | `true` |
| `WORKFLOW_TOKEN` | A random secret of at least 32 characters; use the same secret in n8n Header Auth |
| `ADMIN_PASSWORD` | Local `.env` only, for account creation; at least 12 characters |

Generate a workflow token locally:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

The setup helper only needs the required application variables; Docker-specific `POSTGRES_PASSWORD`, `APP_DB_PASSWORD`, and n8n database variables are not used by Netlify. Start from `.env.netlify.example` rather than the Docker `.env.example`.

## 4. Initialize the database once

With the intended production `DATABASE_URL` and administrator details in the local `.env`:

```bash
npm run setup:netlify
```

This applies migrations and creates the administrator with a salted password hash. Subsequent function invocations do not perform migrations or create accounts. Keep `ADMIN_EMAIL` stable after setup. `ADMIN_PASSWORD` is not needed in Netlify and should be removed from the local file after successful initialization. Existing-user passwords are not overwritten by rerunning setup; the included password-reset utility can reset them intentionally.

For later releases, back up the database and run `npm run setup:netlify` to apply new migrations before deploying the compatible app version. Run this command from one terminal at a time. Never put production migrations in the Netlify build command: preview builds must not mutate production data.

## 5. Deploy and verify

Deploy through the connected Git repository. Alternatively, from the project folder:

```bash
npx netlify-cli login
npx netlify-cli init
npm run build
npx netlify-cli deploy --prod
```

During `init`, select your intended team and project, or create a new project. Do not select an unrelated existing website. Set production function environment variables before the deployment. A later Git push replaces a manual CLI deployment if the project also has continuous deployment enabled.

Open the site, sign in with your administrator account, and check `/api/health` returns `{"ok":true}`. A setup screen means the function is reachable but the database/settings still need attention. The API is same-origin: no separate API hostname or browser-visible service secret is required. Change environment variables and redeploy to apply them. Use a separate database and credentials for deploy previews; do not give unreviewed preview code production secrets.

## 6. Connect optional services

- AI: set `OPENAI_API_KEY`, optionally `OPENAI_MODEL` (default `gpt-4.1-mini`) and `AI_DAILY_CALL_LIMIT`, then enable AI in Skills & Preferences. The model must be accessible to your account and support the configured Responses API structured outputs. Without AI enabled, results are explicitly labelled rule/template based.
- Email: configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`. Set your destination in Notification Settings and send a test. Use TLS port 587 or 465 according to the provider.
- Telegram: configure `TELEGRAM_BOT_TOKEN`; start a conversation with your bot, enter your own chat ID in Notification Settings, and send a test.
- Received job/reply notifications: configure the `IMAP_*` variables described in `docs/email-import.md`. Use a dedicated folder, exact verified sender addresses and trusted authentication-result IDs. Notifications may contain only partial descriptions or message excerpts. Complete job descriptions must be imported before generating proposals.
- Integration secrets remain in Netlify's environment settings, not the dashboard or frontend bundle. No freelance platform passwords or browser cookies are required.

## 7. Configure n8n scheduling

Regenerate the six inactive workflows with your actual site URL:

```bash
node scripts/build-workflows.mjs https://freelancebooxgen.netlify.app
```

Import the files from `n8n-netlify/` into your n8n instance. Create a saved **Header Auth** credential named **Freelance Assistant API**:

- Header name: `Authorization`
- Header value: `Bearer ` followed by your `WORKFLOW_TOKEN`

Select it in every HTTP Request node. Keep the token out of workflow JSON. These nodes POST to `https://your-site.netlify.app/internal/workflows/<name>/run`.

Enable the corresponding workflow in the dashboard, manually test the n8n workflow, and check Automation Logs. Then publish/activate the n8n schedule. A successful HTTP response with `status: queued` means Netlify accepted the background invocation; it does **not** mean the task completed. Refresh the dashboard to see `completed`, `needs_setup`, or `failed`. The audit records dispatches separately; if no run appears, inspect Netlify's worker logs and retry the same execution idempotency key. Do not call the worker URL directly from n8n: the authenticated API validates requests first.

| Workflow | n8n schedule, Asia/Kolkata |
| --- | --- |
| Discovery | Every 15 minutes |
| Proposal preparation | Every 10 minutes |
| Reply monitoring | Every minute |
| Notification delivery | Every minute |
| Daily report | Every day at 8:00 PM |
| Retention cleanup | Every day at 3:15 AM |

Schedules run in n8n, not in ChatGPT. They remain inactive until configured and published. Both n8n and the app's workflow setting must be enabled. Daily reports need working email delivery. Polling frequency is not a guarantee of immediate platform replies; email arrival and provider latency still apply. Adjust frequency to your hosting budget.

## 8. Test the actual services before relying on them

Import one authorized opportunity, score it, review the draft, open its original link, and confirm submission only after actually submitting. Send test notifications to yourself. Use an actual permitted platform notification to verify parsing and conversation matching. Check one scheduled execution and the daily report.

Run local automated verification with:

```bash
npm test
npm run test:netlify
npm run check:netlify
```

Tests use an isolated PostgreSQL-compatible WASM engine and simulated external services. They do not prove live account access, actual message delivery or production deployment. Back up the hosted database using the provider's backup mechanism; Docker backup scripts require adaptation for an external database.

## Known boundaries

- Approved official marketplace API adapters and automatic application submission are not implemented in this release. All four platforms currently use permitted notifications/imports, with manual submission where applicable. Fiverr is inquiry-oriented.
- No platform scraping, browser automation, automatic client replies or paid credit purchases.
- Background invocations are bounded by Netlify's execution limits. The current workflows process small batches; interrupted work is recorded/recoverable through workflow locks and retry controls. An interrupted workflow lock expires after 30 minutes.
- Individual interactive AI actions have one bounded provider call; a bulk import of many messages with AI enabled can exceed a synchronous request limit. Use small manual batches, or the background email workflow for repeated intake. Never interpret a timeout as proof the operation did not save.
- n8n, PostgreSQL, Netlify and AI providers can have usage charges. This package does not include or purchase those services, and no fully free hosting promise is made.
