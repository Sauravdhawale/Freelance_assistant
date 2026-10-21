# Netlify edition validation — 21 October 2026

45 existing backend tests passed, plus 4 new Netlify-specific tests: real login/session/CSRF through the Fetch-to-Express adapter, trusted client-IP handling, shared database-backed rate limiting, and background authorization rejection. The production React build passed. Netlify’s function bundler verified API routing and background invocation mode. Live Netlify deployment, live PostgreSQL, mailbox, AI and notification integrations have not been tested for this edition.

The prior release validation record follows; it is historical and does not establish live connectivity for this edition.

# Verification record

This record describes checks performed on the delivered source on **20 October 2026**. A passing local test is evidence for the tested behavior, not a claim that your external accounts or VPS have been connected.

## Automated checks

**47 tests passed:** 18 adapter/mailbox tests, 4 AI/filter/timezone safeguards, 23 API/database integration tests and 2 deployment-configuration tests. No tests were skipped in these passing runs. The final integration suite, including the shared mailbox intake regressions, completed in approximately 34 seconds.

The automated suites use Node's built-in test runner. The API integration harness runs the real Express application, authentication, migrations, SQL queries and service code against **PGlite's PostgreSQL engine in WASM**. It substitutes deterministic test implementations at external provider boundaries. Test fixtures use fictional listings and received messages and are never loaded automatically into a production database.

| Suite | Verified behavior |
| --- | --- |
| `backend/test/adapters.test.js` | 18 tests for allowed platform URLs, canonical deduplication, validated normalized fields, distinct platform email shapes, Fiverr inquiry handling, exact sender and receiver authentication, read-only IMAP, bounded message sizes/batches, transactional checkpoints, retry after failure, UID validity changes and an arrival/checkpoint race. |
| `backend/test/safety.test.js` | 4 tests for unsupported AI personal claims across generated fields, word-boundary skill matching, hourly versus fixed pricing/currency filters and India-local day boundaries. |
| `backend/test/integration.test.js` | 23 database and HTTP tests covering sessions, CSRF, origins, owner scope, SQL input handling, atomic imports, scoring, complete-scope gates, unique proposals, human review, manual confirmations, limits, blocked platform writes, exact reply matching, classifications, durable outbox behavior, mocked OpenAI output and daily usage limits. Includes concurrency, stale-result and disconnected-provider regressions. |
| `scripts/config.test.mjs` | 2 tests for independently generated private secrets, consistent database configuration, no printed credentials, overwrite protection and input-injection rejection. |
| `scripts/validate-workflows.mjs` | All 6 n8n exports passed checks for inactive import defaults, explicit timezone, the 20:00 cron, authenticated internal destinations, idempotency headers, bounded transport retries and absence of embedded secrets or pinned data. |

The integration regressions specifically cover editing a job while AI scoring is pending, simultaneous first messages in a conversation, an older negotiation racing a newer interview, manual confirmation racing a scope edit, paused notifications, SMTP connection closure after possible acceptance, and disconnected delivery nested within another workflow result. Shared-mailbox tests prove that discovery can ingest jobs with replies paused, overlapping discovery/reply runs do not open competing active polls, and an expired poll cannot release its successor's lease. These tests use real MIME parsing with a mocked IMAP transport.

Notification tests prove the application's source-level deduplication and its policy for uncertain delivery. They do not imply that SMTP or Telegram supports a distributed exactly-once transaction with PostgreSQL. Once a provider may have accepted a message, an ambiguous result is retained as `unknown` and is not automatically resent.

## Build and configuration checks

- The React production build completed successfully with Vite.
- The locked production dependency graph returned **zero reported vulnerabilities** from `npm audit --omit=dev` at the time of this check. This is a point-in-time registry result, not a promise about future advisories.
- Docker Compose YAML parsed successfully. Configuration assertions checked separate application/n8n database roles, private service bindings and the deployment secret generator.
- Deployment, database initialization, backup and restore shell scripts passed shell syntax checks. Encrypted backup/restore has not been executed against a live deployment.

## Browser validation

The built frontend was served by the real Express application with a temporary PGlite database and a synthetic local owner. Outbound provider calls were disabled. Headless Chromium 153 rendered all **11 dashboard sections** at **1440 px desktop** and **390 px mobile** widths without uncaught page errors or horizontal page overflow. Screenshots were inspected for layout. Form helper text was separated from accessible labels during this review.

These browser checks do not contact freelance platforms or prove external mail delivery. The temporary owner and database are not included in the deliverable.

The completed browser journey passed **14 checkpoints**, comprising **22 section/viewport checks** and **3 additional populated mobile views**. It recorded **zero uncaught JavaScript page errors and zero external browser requests**. All core actions below used the actual dashboard controls; the isolated database and owner were the only test setup.

| Checkpoint | Completed action and observed result |
| --- | --- |
| 1. Login | Signed in with the real email/password form and reached the authenticated overview. |
| 2. Desktop sections | Opened all eleven sections at 1440 × 1000; verified empty states, finite metrics, no page errors and no horizontal page overflow. |
| 3. Mobile sections | Opened all eleven sections at 390 × 844; verified contained layouts and used the mobile menu to navigate to All Jobs. |
| 4. JSON import | Imported the explicitly fictional WordPress/SEO record from `examples/jobs.json` through the import dialog. |
| 5. CSV import and deduplication | Uploaded `examples/jobs.csv`, then replayed the same file; the distinct SQL/Power BI record appeared once. |
| 6. Scoring and proposal preparation | Scored the WordPress fixture using the real rules service and prepared a proposal from its complete description through the UI. |
| 7. Human review | Edited the draft, checked the review acknowledgment, marked it ready and found the record awaiting manual submission. No platform submission occurred. |
| 8. Manual record | Recorded an explicitly synthetic test confirmation in the isolated database, then reopened the submitted proposal and verified its text was readonly. The acknowledgment was exercised solely as a local test; no real application was submitted. |
| 9. Reply matching | Imported `examples/messages.json`; its exact job URL linked it to the application and its fictional interview invitation received the Interview classification. |
| 10. Response draft | Prepared a response draft, verified text was present and no send action was offered, then found the reply in Interviews & Offers. |
| 11. Connection diagnostics | Ran Check connections; all four provider checks appeared with honest missing-configuration results. |
| 12. Workflow controls and outcomes | Paused and resumed Replies through the visible switch, verified the Run now button changed availability, and ran the workflow. The real response was `needs_setup`; the UI showed that outcome and expandable mailbox diagnostics. Action audit included the synthetic confirmation. |
| 13. Populated mobile views | Reopened jobs, applications and replies at 390 px after the journey; all three remained within the page width. |
| 14. Browser isolation | Confirmed no uncaught page errors and no requests outside the isolated loopback application origin during the journey. |

The review also improved accessible form labeling and made nested workflow errors visible in expandable run summaries. The final production build includes both fixes. Screenshots were retained only for internal layout review.

An optional replay script is provided at `frontend/test/browser-smoke.mjs`, with installation requirements in `frontend/test/README.md`. It creates its own temporary PGlite-backed application, uses a random synthetic owner, ignores provider credentials and blocks outbound browser requests. Playwright and Chromium are optional tools and are not added to the locked app dependencies. The script assembles the completed journey above into a reusable isolated harness; this packaged wrapper was syntax-checked, with no additional browser run counted here.

## Reproduce the automated checks

From the project root, with Node.js 24 and npm installed:

```bash
npm ci
npm test
node scripts/config.test.mjs
node scripts/validate-workflows.mjs
npm run build
```

The integration test harness binds temporary local HTTP ports. Run it in an environment that permits loopback connections. It requires neither a separately installed PostgreSQL server nor any provider credential. The adapter and provider fixtures explicitly avoid real network actions.

After starting Docker Compose, verify the actual deployment's readiness and anonymous-access protection:

```bash
node scripts/smoke-check.mjs http://localhost:3000
```

This checks application/database readiness and rejection of anonymous dashboard/workflow access. It does not send notifications, invoke AI or submit applications.

## Checks still required on your deployment

| Connection or environment | How to establish it is working |
| --- | --- |
| Native PostgreSQL and Docker | Build/start the supplied services, confirm readiness, restart once and confirm saved records remain. The build environment had no Docker daemon or native PostgreSQL service. PGlite tests do not replace native multi-connection load testing. |
| n8n | Import all six files, select the Header Auth credential, run a manual check, then publish the schedules. Verify a recorded scheduled run and the daily report. The exports were structurally validated; they were not executed inside a live n8n instance here. |
| OpenAI | Configure an authorized key/model and enable AI. Score one genuine authorized job and check that the stored source says OpenAI. The automated suite used schema-valid mocked responses, not your API account. |
| Received emails | Configure the dedicated TLS mailbox and exact sender/authentication settings. Receive one genuine supported platform notification and verify its normalized contents and link. Synthetic MIME/IMAP tests do not prove compatibility with every live notification template. |
| Outgoing email and Telegram | Save your private credentials and destinations, enable each desired channel, then use the explicit notification test and check the receiving destination. Local tests used mocked provider acceptance/failure. |
| Daily report | Keep the report and notification workflows enabled and publish the n8n schedule in `Asia/Kolkata`. Confirm actual email receipt, including a zero-activity report. |
| Backup/restore | Create an encrypted backup and prove restoration in a separate disposable deployment before relying on it for recovery. Preserve the n8n encryption key and the backup decryption key. |
| Marketplace submissions | This release records reviewed manual submissions only. No automatic platform write or live submission was performed or represented as successful. Add an account-approved official adapter only after verifying its full contract, permissions and confirmation requirements. |

The release targets one owner and a small workload. It has not received a third-party penetration test, a high-volume load test or a full accessibility audit. The specific functional and security checks above describe its verified scope.
