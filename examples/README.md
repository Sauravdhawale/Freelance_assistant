# Fictional import examples

Every record in this directory is explicitly fictional. These files demonstrate the JSON/CSV format; they are not real opportunities or client messages, and their links must never be used for live submissions.

The job JSON and CSV can be loaded through All Jobs → Import. The message JSON can be loaded through Client Replies → Import. Set the sample `received_at` to an appropriate past/current ISO timestamp if needed. Unknown job posting dates remain `null` rather than being fabricated from import time.

Use an isolated local database and disable external notifications before manually importing fictional examples. The automated tests create isolated databases and replace all outbound provider calls, so running `npm test` does not send example client activity to anyone.

Do not use exported third-party scraped records as an “authorized import” merely because they fit this file format. Only import records you are entitled to process.
