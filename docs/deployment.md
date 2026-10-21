# Run the Freelance Assistant

This project contains the actual application source and six n8n workflows. It starts with an empty database. A successful local installation does not mean that OpenAI, your mailbox, Telegram or any freelance account is connected. The Integrations screen and Automation Logs show the state observed by the application.

## 1. What you need

- Docker Engine or Docker Desktop, including Docker Compose v2.
- Node.js 24 LTS on the machine where you generate your configuration or develop the project.
- Your own email address for the application login.
- Optional: an OpenAI API key, a dedicated mailbox or mailbox folder for permitted platform notifications, outgoing SMTP access and a Telegram bot.

The included deployment runs three services: the application, PostgreSQL and n8n. The initial ports bind only to `127.0.0.1`. The database is not published on any host port. These defaults are suitable for a local installation or an SSH tunnel to a VPS.

Pinned image versions in the supplied configuration were checked on **20 October 2026**: Node.js 24.22.0 LTS, PostgreSQL 17.11, n8n 2.44.4 stable and optional Caddy 2.11.7. These are reproducible version tags, not a guarantee that no newer patch is available when you deploy. Review the official release notes before later upgrades:

- [Node.js download and LTS](https://nodejs.org/en/download)
- [PostgreSQL 17.11 release notes](https://www.postgresql.org/docs/release/17.11/)
- [n8n 2.44.4 release](https://github.com/n8n-io/n8n/releases/tag/n8n%402.44.4)
- [Caddy 2.11.7 release](https://github.com/caddyserver/caddy/releases/tag/v2.11.7)

## 2. Create the configuration

Extract the archive and open a terminal in the `freelance-assistant` folder. Replace the example email in this command with your actual address:

```bash
node scripts/generate-env.mjs --email you@example.com
```

This creates `.env` with a random administrator password, independent database passwords, a workflow token and an n8n encryption key. It does not print those secrets and refuses to overwrite an existing `.env`.

Open `.env` in your local text editor. Your initial dashboard credentials are `ADMIN_EMAIL` and `ADMIN_PASSWORD`. Keep `.env` private. Put service secrets directly into that file or your deployment secret manager; do not send them in chat. Preserve the `N8N_ENCRYPTION_KEY`: n8n needs the same key to decrypt its saved credentials after a restore.

The default configuration uses `http://localhost:3000`. Use exactly that URL for the initial login. The allowed origin and cookie settings must agree with the URL you use. To use another origin, set `APP_ORIGIN` accordingly and recreate the application container.

## 3. Start the application

```bash
docker compose up -d --build
docker compose ps
node scripts/smoke-check.mjs http://localhost:3000
```

The first build downloads dependencies and images. PostgreSQL creates separate application and n8n databases and separate non-superuser accounts. The application runs its migrations before the HTTP server starts. Later starts preserve the database through Docker volumes.

Open:

- **Dashboard:** `http://localhost:3000`
- **n8n editor:** `http://localhost:5678`

Log in to the dashboard with the generated administrator credentials. n8n has its own first-run owner setup; its login is separate from the dashboard. Create that owner in n8n before configuring workflow credentials.

`smoke-check.mjs` checks database readiness and verifies that anonymous callers cannot read the dashboard or execute workflows. It does not call billable services, send messages or submit proposals.

The configuration generator has a separate, credential-free regression check:

```bash
node --test scripts/config.test.mjs
```

If a service does not start:

```bash
docker compose logs --tail 100 app
docker compose logs --tail 100 postgres
docker compose logs --tail 100 n8n
```

Avoid sharing unredacted logs or the rendered output of `docker compose config`: the latter includes resolved environment values.

## 4. Configure skills and authorized data sources

In **Skills & Preferences**, review the supplied skill list, minimum budget, accepted work types, experience levels, relevance threshold, proposal limits and verified profile. Enter only experience and portfolio items you can substantiate. The application uses that information when composing drafts.

In **All Jobs**, import your own authorized CSV or JSON job records. Platform notification emails provide a second source after IMAP is configured. A partial notification is not a substitute for the full job description: review the original listing and supply the complete authorized text before treating a proposal as ready.

The current platform adapters do not scrape authenticated marketplace pages. An enabled import adapter is not evidence of an approved official API connection. Read [platform-permissions.md](platform-permissions.md) for the platform-by-platform boundaries. Automatic marketplace submission remains unavailable when the official method and your access have not been verified; use the ready-to-submit draft and original opportunity link.

## 5. Connect services

### OpenAI

Set `OPENAI_API_KEY` in `.env`. `OPENAI_MODEL` is editable and defaults to `gpt-4.1-mini`; use a model available to your API account that supports structured outputs through the Responses API. Set `AI_DAILY_CALL_LIMIT` to bound calls, then enable AI in the dashboard. Calls use your API account and may incur charges. A call count is not a monetary billing ceiling; set a separate budget or usage controls in your OpenAI project as needed.

Restart after editing environment values:

```bash
docker compose up -d --force-recreate app
```

Validate with one imported test opportunity. Check the proposal generator/score source and logs to distinguish a genuine model response from a local rules-based fallback. Do not describe the live AI connection as tested until an authenticated request succeeds. See [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

### Permitted incoming platform email notifications

Use a dedicated mailbox or a narrowly scoped folder/label containing notifications that you are permitted to process. Required settings:

| Setting | What to enter |
| --- | --- |
| `IMAP_HOST` | Your provider's IMAP server, such as Gmail's `imap.gmail.com` |
| `IMAP_PORT` | TLS port, normally `993` |
| `IMAP_TLS` | Keep `true`; the backend requires TLS |
| `IMAP_USER` | Mailbox login address |
| `IMAP_PASS` | Supported application-specific credential; not the normal account password where an app password is required |
| `IMAP_MAILBOX` | Dedicated folder name; default is `INBOX` |
| `IMAP_ALLOWED_SENDERS` | Comma-separated exact notification sender addresses you have verified in actual messages |
| `IMAP_AUTH_SERVERS` | Trusted authentication-result server identifiers from your mailbox provider, default `mx.google.com` |
| `IMAP_LOOKBACK_DAYS` | Initial scan window, default `7` |

The sender allowlist and trusted authentication results reduce spoofed imports. They are not a general email security product. Use messages delivered directly by the platforms to your mailbox; forwarding can change authentication results and may cause messages to be rejected. Sender addresses vary, so the project does not claim that a guessed address is official.

Gmail app passwords depend on your account's eligibility and security settings. If your organization disallows app passwords, use an authorized supported mailbox integration or import data manually. Do not disable account protections to work around that policy. Official provider guidance: [Gmail IMAP configuration](https://support.google.com/mail/answer/7126229) and [Google app passwords](https://support.google.com/accounts/answer/185833).

### Outgoing email

Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` and `NOTIFICATION_EMAIL`. For port `587`, `SMTP_SECURE=false` means a STARTTLS connection; it does not mean that credentials should be sent over an unencrypted session. Port `465` commonly uses `SMTP_SECURE=true` for TLS from the start.

In **Notifications**, confirm your recipient address, enable email and send a test to yourself. The 8 PM report is addressed to that configured recipient. Outgoing notifications are separate from incoming mailbox polling.

### Telegram

Create a Telegram bot through Telegram's official BotFather flow, start a private conversation with your bot and obtain your own chat ID through an authorized Bot API request. Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` locally. In **Notifications**, verify the destination, enable Telegram and send a test to yourself.

This integration sends user notifications. It does not send replies to freelance clients. Official documentation: [Telegram Bot API](https://core.telegram.org/bots/api).

## 6. Enable n8n schedules

Import the six workflow files from `n8n/`, select the shared Header Auth credential in each HTTP Request node, run one manual check and then **save and publish**. Full instructions are in [workflows.md](workflows.md).

The daily workflow uses `0 20 * * *` with the workflow timezone set to `Asia/Kolkata`. A workflow must be published and n8n must be running for the schedule to execute. Clicking the manual execution button alone does not enable future runs. Official n8n behavior: [Schedule Trigger](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.scheduletrigger/).

Dashboard pause switches gate the corresponding backend actions. They do not edit the published n8n workflow. A paused backend workflow can still receive its n8n trigger and report that it is paused. Resume it in the dashboard to process the next scheduled run.

## 7. Deploy on your VPS

Choose an adequately sized VPS for the application, database and n8n. A starting planning estimate is 2 virtual CPUs and 4 GB RAM for a small single-user installation; actual needs depend on message volume and workflow concurrency. This is not a measured capacity benchmark or a hosting-price quote.

Copy the project to the VPS, create `.env` there and run the same Docker Compose commands. The loopback port bindings prevent the initial dashboard and n8n editor from being directly exposed to the internet. From your own machine you can use an SSH tunnel:

```bash
ssh -L 3000:127.0.0.1:3000 -L 5678:127.0.0.1:5678 your-user@your-vps
```

Then use `http://localhost:3000` and `http://localhost:5678` on your computer. Keep `APP_ORIGIN=http://localhost:3000` for this tunnel-only setup.

### Optional public HTTPS dashboard

Point a domain's DNS to the VPS and permit incoming TCP ports 80 and 443. The included Caddy profile terminates HTTPS and blocks the internal workflow endpoint from the public domain. Keep n8n private through the SSH tunnel.

Set the following locally in `.env`, replacing the example domain and email:

```dotenv
APP_DOMAIN=freelance.example.com
TLS_EMAIL=you@example.com
APP_ORIGIN=https://freelance.example.com
COOKIE_SECURE=true
TRUST_PROXY=1
```

Then start the reverse proxy:

```bash
docker compose --profile https up -d --build
node scripts/smoke-check.mjs https://freelance.example.com
```

Only use `TRUST_PROXY=1` with the supplied single reverse proxy and loopback host binding. Do not publish the app port to all interfaces and then trust arbitrary forwarded headers. The database and n8n editor stay private. The dashboard must remain behind its login; avoid exposing an unfinished installation before administrator setup.

## 8. Back up and recover

The named Docker volumes preserve state across restarts. They do not replace backups. The project supplies an encrypted backup script that streams PostgreSQL custom-format dumps through `age`, and encrypts `.env` because it contains the n8n credential-decryption key. Backups retain the application database and n8n database; they do not include unrelated files on your VPS.

Install [age](https://github.com/FiloSottile/age) and generate a backup key on a trusted machine. Keep the private key off the VPS where practical. Put only the public recipient on the server. Run:

```bash
AGE_RECIPIENT=age1your_public_recipient bash scripts/backup.sh
```

Use your real public recipient in place of the example. The script saves encrypted files under `backups/<UTC timestamp>/`, refuses to run without an encryption recipient and leaves older backups in place. Copy completed backups to a separate location and apply an appropriate retention policy there. Schedule this command with your server's scheduler if daily backups are required; that schedule is a deployment step, not automatically installed by the project.

### Restore to a replacement or recovery environment

1. Preserve a current backup before any restore. Stop using the dashboard during recovery.
2. Bring up the database service on the target environment. The database roles must exist from first-run initialization.
3. Review the encrypted `.env` backup locally and preserve the original `N8N_ENCRYPTION_KEY`. Keep target database passwords consistent with the target's already-created roles. Replacing `.env` alone does not change passwords stored inside an existing PostgreSQL volume.
4. Use the supplied restore script. It first proves that both encrypted dump files can be decrypted, then stops the application and n8n and replaces their database objects. The following command is intentionally an explicit restore operation:

```bash
AGE_IDENTITY=/private/backup-key.txt bash scripts/restore.sh --confirm-restore /path/to/backup-directory
```

5. The script leaves the application and n8n stopped. Review credentials and workflow activation before restarting. If n8n is restarted with previously published workflows, their schedules resume.
6. Start the app, verify login and inspect counts; then start n8n and verify one low-impact workflow. Test a restore in a recovery environment before relying on the backups.

Database dumps are separate snapshots. For a perfectly synchronized pair, stop app and n8n before backing up, then restart them after completion. The application's workflow data and outbox remain in its own transactional database; SMTP/Telegram delivery cannot be rolled back by restoring a database.

## 9. Updates and operational limits

- Before updating images or dependencies, create an encrypted backup, read release notes, build and test in a separate environment, then update the deployed service. Do not delete volumes during routine upgrades.
- `docker compose restart` restarts existing containers; it does not apply changed environment values. Use `docker compose up -d --force-recreate app` after environment edits.
- Initial PostgreSQL setup scripts run only for a new empty volume. Rotating a database password requires changing the database role password and the corresponding environment value together.
- Keep the original n8n encryption key across updates. Changing it makes previously stored credentials unreadable.
- Successful n8n execution payloads and manual execution data are disabled in this configuration. Error executions are pruned after seven days. The backend's retention policy is controlled separately in the dashboard.
- Workflow JSON structure and local application behavior can be tested without platform accounts. Docker startup, n8n import/publication, actual mailbox parsing and actual email/Telegram/OpenAI delivery must still be verified on the connected target installation.
