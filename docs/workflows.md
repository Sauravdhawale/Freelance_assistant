# n8n workflows

The `n8n/` folder contains six real importable workflow definitions. Each file has a schedule trigger, a manual trigger and one authenticated HTTP Request to the backend. The backend holds the application logic and durable state; n8n controls when each workflow runs.

## Included schedules

All schedules explicitly use `Asia/Kolkata`.

| File | Backend workflow | Default schedule | Purpose |
| --- | --- | --- | --- |
| `01-discovery.json` | `discovery` | Every 15 minutes | Normalize, deduplicate and process permitted opportunity sources |
| `02-proposals.json` | `proposals` | Every 10 minutes | Match eligible jobs and prepare unique drafts |
| `03-replies.json` | `replies` | Every minute | Read permitted notification emails and identify client responses |
| `04-notifications.json` | `notifications` | Every minute | Deliver due email/Telegram outbox entries |
| `05-daily-report.json` | `daily_report` | 8:00 PM every day | Produce the daily report, including days with no activity |
| `06-retention.json` | `retention` | 3:15 AM every day | Apply the selected data-retention policy |

The periodic intervals are polling schedules. Once a provider makes a notification email available, the next successful polling/delivery runs process it; this does not guarantee real-time delivery or complete visibility into every platform event.

### Shared mailbox intake

Discovery and replies can each poll the configured mailbox. A shared database lease permits one active poll at a time, and verified opportunity and reply emails are staged in separate durable queues. Discovery consumes the opportunity queue; replies consumes the client-message queue. An overlapping workflow skips the busy mailbox poll and can still process events already in its own queue. The next successful poll continues from the saved IMAP UID checkpoint.

Pausing **replies** therefore leaves scheduled job discovery working. Discovery may stage reply emails while replies are paused; those events wait for replies to resume. To stop scheduled mailbox access, pause both **discovery** and **replies**, or unpublish both n8n schedules. If an interrupted poll leaves a lease behind, the lease can expire after five minutes. A finishing older poll cannot clear a lease already acquired by another run.

## Connect the workflows once

1. Start the Docker Compose services described in [deployment.md](deployment.md).
2. Open `http://localhost:5678` and complete n8n's owner setup.
3. In n8n, create a **Header Auth** credential named **Freelance Assistant API**. Set its header **Name** to `Authorization`. Set its **Value** to `Bearer ` followed by the generated `WORKFLOW_TOKEN` from your local `.env`. Include the space after `Bearer`. Store the credential only in n8n's credential editor.
4. Create a workflow and choose **Import from File**. Import `n8n/01-discovery.json`. Repeat for the other five files.
5. Open **Run authorized backend workflow** in each imported workflow. Under the generic Header Auth credential selector, choose **Freelance Assistant API**. The files deliberately contain no actual credential ID or token.
6. Check the URL. Inside the included Compose network it is `http://app:3000/internal/workflows/<name>/run`.
7. Run one manual check. If required sources are missing, an explicit disconnected/skipped result is expected; it is not evidence of a live integration.
8. Set the desired workflow to enabled in the dashboard. Save and **publish** the n8n workflow. Keep n8n running.

The export starts with `active: false`, so importing files cannot begin background processing. There is no need to keep clicking **Execute workflow** after successful publication. If the schedule still does not run, check publication state, the workflow timezone, Docker service health and backend pause settings.

Official references: [n8n workflow export/import](https://docs.n8n.io/workflows/export-import/), [HTTP Request credentials](https://docs.n8n.io/integrations/builtin/credentials/httprequest/) and [Schedule Trigger publication and timezone](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.scheduletrigger/).

## Using an existing n8n instance

You can import the same files into an existing n8n instance. Use the existing instance's credential storage and create/select the Header Auth credential there. A separate instance cannot resolve the Compose-only hostname `app` unless it shares that private Docker network.

For an n8n instance on the same VPS, join it to a controlled private network that can reach the backend, or use a trusted authenticated private connection. For a separate host, use an encrypted private network or a properly secured HTTPS reverse proxy for the internal workflow route. The supplied public Caddy configuration intentionally blocks `/internal/*`; do not simply remove that rule to make a connection work. Limit access to your known n8n service and preserve the bearer-token requirement.

Change the HTTP URL in all six workflows to the verified backend route reachable from that instance. The API token is an application workflow token, not an n8n API key. The exports use standard Schedule Trigger, Manual Trigger, Sticky Note and HTTP Request nodes; no community node is required.

The supplied n8n service enables SSRF protection and permits the single internal hostname `app`. If you change the backend hostname on a different private deployment, update that narrow hostname allowlist to match your intended service. Keep other internal destinations protected. See [n8n SSRF environment settings](https://docs.n8n.io/hosting/configuration/environment-variables/ssrf-protection/).

No connected n8n management tools were exposed during this build. The supplied files were generated and validated locally; they were not imported into or published on your existing n8n server.

## Reliability and duplicate prevention

Each HTTP request includes:

```text
X-Idempotency-Key: <workflow ID>:<execution ID>
```

The key is derived in n8n from `$workflow.id` and `$execution.id`. A transport retry of the same execution sends the same key. The backend also prevents duplicate jobs, applications, imported messages and queued notifications using database constraints and state checks. These controls protect against repeated polls and ordinary repeated requests; they do not make a third-party email or Telegram service transactional with PostgreSQL.

HTTP transport retries are bounded to three attempts with five seconds between attempts. The backend notification queue controls longer exponential backoff, due times and exhausted retries. The normal HTTP timeout is 120 seconds; the report uses 300 seconds. Back-end logs remain the application-level record of work and failures.

If n8n or the VPS is offline at the scheduled time, a daily trigger may be missed. The supplied stable-version configuration does not claim an untested catch-up mechanism. Inspect the latest report in logs after recovery and run the daily report manually when needed. The backend's report deduplication prevents an ordinary duplicate report for a date already recorded; inspect failed delivery separately from report creation.

## Pause, resume and retry

Use dashboard workflow switches to pause the corresponding backend work. This gives a consistent gate for both manual dashboard runs and n8n triggers. Publishing or unpublishing the n8n workflow controls the schedule itself.

Use **Automation Logs** to inspect failures and retry eligible operations after correcting their cause. If the source credential is expired, reconnect it before retrying. Do not repeatedly republish workflows to work around an invalid token or missing email configuration.

There is no outbound client-reply node. Fiverr response drafts and proposal drafts require the user to open the platform and send them. Unsupported automatic application submissions stay blocked in the backend even if a workflow trigger is enabled.

## Regenerate and validate exports

The readable generator lives at `scripts/build-workflows.mjs`. It can recreate the six JSON files without needing account secrets:

```bash
node scripts/build-workflows.mjs
node scripts/validate-workflows.mjs
```

Validation checks activation defaults, all required workflows, timezone, the 8 PM cron, credential-backed authentication, private endpoint destinations, stable idempotency headers, no pinned user data and bounded retries. This is structural and contract validation; the deployment operator must still prove import, execution and publication on their n8n instance.
