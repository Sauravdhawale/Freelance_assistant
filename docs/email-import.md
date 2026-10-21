# Connect platform notification emails

The mailbox adapter reads messages that the platforms have already sent to an email account you control. It does not open or scrape freelance websites. It never sends a client reply, marks a message as read, deletes a message or downloads anything from a link in the email.

## Recommended setup

Use a dedicated mailbox or a dedicated IMAP folder containing only your freelance alerts. This reduces unrelated personal data processing and keeps the queue manageable. Enable the appropriate notifications in each freelance account. The official sources are listed in [Platform permissions](platform-permissions.md).

Set these values privately in the server `.env` file:

| Variable | Value |
| --- | --- |
| `IMAP_HOST` | Your mail provider's documented IMAP server. |
| `IMAP_PORT` | The provider's implicit TLS port, usually `993`. |
| `IMAP_TLS` | `true`. Unencrypted IMAP is rejected. |
| `IMAP_USER` | The email account used for alerts. |
| `IMAP_PASS` | A provider-supported app password or IMAP credential. Do not use or share this in chat. |
| `IMAP_MAILBOX` | The exact IMAP mailbox/folder name; default `INBOX`. |
| `IMAP_ALLOWED_SENDERS` | Comma-separated exact sender email addresses taken from genuine notifications you have received. Wildcards and display names are not accepted. |
| `IMAP_AUTH_SERVERS` | Your receiving provider's trusted `Authentication-Results` server identifiers; default `mx.google.com`. |
| `IMAP_LOOKBACK_DAYS` | First-connection lookback, between 1 and 30 days; default 7. |

Gmail users should follow Google's current account requirements for app passwords; availability depends on account security and organizational policies. If your provider disallows password-based IMAP, this built-in connector cannot authenticate that account. Use a provider-supported n8n/OAuth integration to collect the necessary data for the authenticated import interface, or import your own data manually. Do not weaken your organization's authentication settings.

## Verify the sender settings

Inspect a genuine platform email with your mail application's **Show original** or equivalent command. Copy only its exact `From` address into `IMAP_ALLOWED_SENDERS`. Do not copy passwords, cookies or full email headers into chat.

The parser requires all of the following:

1. Exactly one `From` header and one parsed sender.
2. An exact match to your sender allowlist.
3. A sender domain equal to, or a subdomain of, `upwork.com`, `fiverr.com`, `peopleperhour.com` or `guru.com`.
4. The **first** `Authentication-Results` header must be from a configured trusted receiving server.
5. That receiver must report `dmarc=pass` for the same From domain.

This verification relies on your trusted email provider adding its own authentication result before untrusted headers and removing/sanitizing forged results for its identifier. Configure the identifier of your **receiving provider**, not an arbitrary string found in the email body. Forwarded messages and external email vendors that do not preserve these properties are rejected. The application does not treat a display name, a matching text link, an SPF result alone or a later forged authentication header as proof of origin.

The workflow result reports `unverified`, `oversized`, `ignored` and `duplicates` counts. Skipped-message content is not stored. Review your dedicated mailbox when those counts rise; use manual import for unsupported or ambiguous notifications. If you change the allowlist after a message was skipped, move/copy the genuine message into the monitored folder again so it receives a new IMAP UID, or import its permitted content manually.

## What is extracted

Supported original links must use HTTPS, an allowed platform hostname, no embedded credentials and no custom port. Tracking redirects are not followed. Recognized listing paths currently cover Upwork job links, PeoplePerHour project links and Guru job links. Recognized conversation paths are deliberately narrow; live platform emails may use another format.

An email with a recognizable job-alert subject and a recognized listing URL becomes an opportunity. An email with a recognizable client-message subject and an original conversation/listing URL becomes a reply notification. Newsletters, support tickets, security codes, invoices and unrecognized formats are ignored.

| Field | Email behavior |
| --- | --- |
| Title | Original link text where available; otherwise a clearly generic email-notice title. |
| Description | Received email excerpt for a single listing; partial per-link notice for digests. |
| Budget and work type | Unknown unless you supply them using the normal import/edit form. An unrelated number in an email is not treated as a budget. |
| Posting date | Unknown. Email receipt is never substituted for the job's posting date. |
| Full description | Always `false`; open the listing and supply the full text before creating a proposal. |
| Message timestamp | Mail provider's received/internal date, with the parsed email date as a fallback. |
| Client name | Extracted only when the message subject explicitly identifies it; otherwise blank. |
| Conversation/job association | Original known links only. No guessed association from a similar title. |

Fiverr events are handled as incoming messages/inquiries, not conventional applications. User imports on the Fiverr platform are marked `kind: inquiry`.

Notification templates are not a stable platform API. This parser intentionally reports an unsupported format instead of inventing a job, price, sender or client message. A live email integration is only verified after receiving and correctly processing an actual authorized message from your account.

## Reliability and retention

Polling reads at most 100 messages per run and limits each message to 1 MiB before fetching the full MIME source. Processing stops after approximately 45 seconds before starting another message; the next poll resumes. The mailbox is opened read-only using ImapFlow.

Each recognized event and its UID checkpoint are committed in the same database transaction. Database or network failures do not advance beyond the failed message. Already committed messages stay committed. `Message-ID` deduplication prevents a normal replay creating another event; UIDVALIDITY and a mailbox-configuration fingerprint protect against using a checkpoint for the wrong mailbox.

A UIDVALIDITY reset rescans the initial lookback. Messages without a `Message-ID` use UIDVALIDITY and UID, so replay protection for those messages cannot span a server UID reset. Raw MIME and attachments are held temporarily in memory for parsing and are not written to the database. Only normalized content is persisted.

Discovery and reply monitoring can each poll the shared mailbox. A database lease allows only one poll at a time, protecting the shared UID checkpoint. Either poll queues supported job and reply events; discovery processes job events, and reply monitoring processes reply events. Pausing reply monitoring therefore leaves job discovery available. Pausing discovery leaves reply monitoring available. Events for a paused processor wait in its queue until it resumes, subject to the configured retention period.

## Manual opportunity import

Use the dashboard import form or its authenticated API for data you are permitted to use. A minimal complete opportunity object is:

```json
{
  "platform": "upwork",
  "external_id": "YOUR_REAL_JOB_ID",
  "title": "The original job title",
  "description": "The actual description you are authorized to process.",
  "url": "https://www.upwork.com/jobs/~YOUR_REAL_JOB_ID",
  "budget_min": 250,
  "budget_max": 500,
  "currency": "USD",
  "work_type": "fixed",
  "experience_level": "intermediate",
  "skills": ["WordPress", "CSS"],
  "posted_at": null,
  "full_description": true
}
```

Replace the illustrative title, text, URL and budget with the real listing. If you only have an excerpt, use `full_description: false`. CSV skills may be separated by commas or semicolons. Budgets must be plain nonnegative numbers, without currency symbols; dates must be ISO timestamps with an explicit timezone. The application does not fetch the supplied URL.

## Technical references

- [ImapFlow: fetching messages](https://imapflow.com/docs/guides/fetching-messages/)
- [ImapFlow: mailbox management and read-only locks](https://imapflow.com/docs/guides/mailbox-management/)
- [ImapFlow: search result and failure behavior](https://imapflow.com/docs/guides/searching/)
- [Nodemailer MailParser](https://nodemailer.com/extras/mailparser)

Local tests use synthetic MIME messages, a fake IMAP transport and transaction rollback checks. They validate application behavior without contacting freelance accounts; they are not evidence of live platform or mailbox access.
