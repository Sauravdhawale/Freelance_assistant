# Platform capabilities and implementation decisions

Checked: **20 October 2026**. This is an engineering evidence record for an internal freelance assistant. Account-level access has not been tested because no platform credentials or approvals were supplied.

## What the evidence supports

| Platform | Official capability found | Automatic application or reply boundary | Initial integration decision |
| --- | --- | --- | --- |
| Upwork | Reviewed OAuth API access; current GraphQL documentation includes marketplace job search, proposal and messaging operations. | API existence is not approval for a particular account or workflow. The documented `createJobProposal` mutation requires the **Submit Proposal** permission. Upwork's official MCP workflow also requires review and confirmation before final marketplace writes. | Import the user's received job/message notifications and authorized data. Prepare proposals for review. Keep any direct API submission disabled until the exact request schema, granted scope, intended use and cost have been verified. |
| Fiverr | Email/push notification controls and a native Inbox for inquiries, custom offers and orders. | No public seller search, messaging, Gig analytics or submission API was verified in this review. Official standards prohibit unauthorized access, scraping and automated mass messages. | Monitor the user's received notifications, draft responses, track inquiries and prepare suggestions from the user's own Gig content. The user sends responses and changes Gigs in Fiverr. |
| PeoplePerHour | Saved searches with instant or daily email updates; job invitations and configurable system notifications. | No public marketplace search, proposal-submission or messaging API was verified. A job listing offering API development is not documentation for a PeoplePerHour API. | Process received alerts and user-authorized imports; generate proposals and open the original project for user submission. Keep client conversations in WorkStream. |
| Guru | Job Match emails and account/job alerts; received WorkRoom messages are copied to email. | No public job-search, quote-submission or messaging API was verified. Terms restrict account misuse, interference and interception of site data. | Process the user's received emails and imports, draft quotes, and link to the original job or WorkRoom. |

“Not verified” means there was insufficient official evidence to enable a capability. It does **not** mean a private partner API cannot exist. An API permission switch in this application cannot create platform permission.

## Upwork: approved access is a separate prerequisite

[Upwork's API key requirements](https://support.upwork.com/hc/en-us/articles/115015857647-How-to-request-an-API-key-from-Upwork) currently require verified identity/payment information, an account in good standing, at least $25,000 in lifetime earnings and/or spend, and a Job Success Score of at least 90% for freelancers/agencies. The page describes personal/internal use, a daily ceiling of 40,000 API requests, and no developer sandbox or test accounts. These are current published requirements, not a claim that this user qualifies.

[Upwork's automation policy](https://support.upwork.com/hc/en-us/articles/43342677368467-Use-bots-and-other-automation-properly) requires an approved API use case. It explicitly warns about unauthorized watchers, browser scripts, page polling, exported session tokens, scraping and proposal spam. An approved key must only be used within its granted scope. This project therefore must never substitute website automation when an API fails.

[The official GraphQL reference](https://www.upwork.com/developer/documentation/graphql/api/docs/index.html) documents `marketplaceJobPostingsSearch`, requiring **Read marketplace Job Postings**, and `createJobProposal(input: CreateJobProposalInput!)`, requiring **Submit Proposal**, returning `newProposalId`, `status` and `error`. It also documents freelancer proposal lists and messaging. Search uses the `USER_JOBS_SEARCH` context; the old saved-feed/RSS contexts are marked unsupported. Direct reference-page retrieval returned HTTP 403 during this review, while indexed official text exposed these definitions. The complete current submission input object and its cost behavior were not verified. Do not infer them from third-party code or turn an untested mutation into an enabled integration.

[Upwork's official Agent Plugin](https://github.com/upwork/upwork-agent-plugin) offers another route through its OAuth MCP service. Its proposal workflow covers review, Connects and attachments. Its README requires confirmation before writes and another confirmation for the final action in a draft-based workflow. If added later, retain those confirmation semantics and discover the live tool schemas after authorization. Do not treat a general auto-apply toggle as permission to skip that workflow.

## Fiverr: inquiries and Gig support

[Fiverr's community standards](https://help.fiverr.com/hc/en-us/articles/37554441398929-Our-Community-Standards) prohibit platform scraping, unauthorized methods and automated mass messaging. They also require truthful profiles and prohibit copying other sellers' Gig content. Consequently, Gig optimization should use the user's own supplied content and verified capabilities, produce editable drafts and require the user to publish changes through Fiverr.

[Account settings documentation](https://help.fiverr.com/hc/en-us/articles/360011329498-Managing-your-account-settings) describes notification controls under **Account Settings → Notifications**, including email/push delivery and notification-type selection. [Inbox documentation](https://help.fiverr.com/hc/en-us/articles/37552118241809-Using-your-inbox-effectively) distinguishes inquiries, custom offers and order-related messages. These events must not inflate “job applications submitted” metrics.

The current notice on the [former Briefs help page](https://help.fiverr.com/hc/en-us/articles/4415608857745-Personalized-offers-Briefs-for-freelancers) says **Mira AI Headhunter has replaced Briefs**. Some older instructions remain below that notice. Use incoming-opportunity terminology and the original supplied conversation link; do not promise a deprecated Briefs polling integration.

No direct seller analytics API was established. This release does not retrieve or persist Gig-performance analytics. Its Gig tool uses the owner's supplied title, description, keywords and packages to prepare editable suggestions; it is not a live Fiverr feed.

## PeoplePerHour: native saved-search alerts

[Saved Searches](https://support.peopleperhour.com/hc/en-us/articles/205217987-Saved-Searches) officially supports stored keyword/filter searches with instant or daily email notifications. The documented setup is to search jobs, save the search and select the email frequency. Account availability and actual receipt must still be checked during connection.

[Notification settings](https://support.peopleperhour.com/hc/en-us/articles/205218527-Unsubscribe-from-emails) describes saved-search, job-invitation and job-recommendation emails, as well as system notification settings. These are suitable inputs to a user-authorized mailbox workflow. Only content actually received may be extracted; missing descriptions or budgets remain unknown until the user supplies them.

[PeoplePerHour's communication policy](https://support.peopleperhour.com/hc/en-us/articles/17825988320785-Can-I-take-communication-off-the-site) requires discussion and project agreements to stay in WorkStream. Email/Telegram alerts from this assistant are notifications **to the account owner**, not an alternative channel for client negotiation.

The [main terms](https://www.peopleperhour.com/static/terms) were available through indexed official text, last modified 20 March 2026. The linked [website-use terms](https://www.peopleperhour.com/static/terms-of-website-use) presented a robot-verification page, so their complete current text could not be verified. This is an unresolved source limitation; it is not permission to scrape or automate submissions.

## Guru: Job Matches and WorkRoom notifications

[Guru's email settings help](https://www.guru.com/help/freelancer/email-settings-freelancer/) states that verified email receives job, account and payment notifications and that Job Match email preferences can be managed in the account. A secondary email can also receive alerts.

[Guru's WorkRoom messages help](https://www.guru.com/help/freelancer/managing-your-job/messages-freelancer/) describes email copies of received messages and native reply-by-email behavior. The assistant only reads the received copy, stores the necessary excerpt and produces a response draft. Reply-by-email capability must not silently enable client replies.

[Guru's terms](https://www.guru.com/terms-of-service/) prohibit unauthorized account access, damaging/interfering automation and interception of system/data/personal information. The reviewed terms do not establish a general public quote-submission API. Some direct Guru page fetches returned 403 or redirects; the evidence above was available as indexed official page text.

## Engineering gates and test boundaries

1. Keep separate states for **configured**, **connected**, **tested**, **permission granted** and **enabled**. A token merely being present proves none of the other states.
2. For an unsupported or unverified submission route, preserve the proposal and job URL in the review queue. Never report success merely because a draft exists.
3. Require the user to supply a confirmation/reference when recording a manually submitted application. Label it as user-reported, not API-verified.
4. Treat imported descriptions and messages as untrusted data. They cannot change tool permissions, request secrets or instruct the AI to invent credentials or send messages.
5. Do not fetch arbitrary links from emails. Validate platform hostnames and retain the original authorized link. A shortened/tracking link is not authority to follow redirects into arbitrary sites.
6. Check mailbox origin and deduplicate provider message IDs. Match replies using an exact known job/application/conversation identifier; ambiguous messages belong in an unmatched queue for review.
7. A generated proposal with price/timeline suggestions is a draft. No platform credits, Connects, memberships or paid boosts are purchased by this system.
8. Test ingestion, parsing, matching, persistence, notifications and status transitions using clearly labelled fixtures and local authorized test transports. Do not invent platform test accounts or submit “test” proposals to unrelated live jobs.
9. Email delivery is subject to the platform sending a notification and the mail provider delivering it. “Immediate” processing starts when the alert reaches the configured integration; it cannot guarantee immediate visibility of every in-platform message.

Recheck the exact official documentation and granted permissions before enabling a new platform write capability or upgrading its adapter. Record the date and evidence with that change.
