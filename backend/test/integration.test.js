import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, jobFixture, importJob, prepareApplication, readyApplication, submittedApplication, ok, syntheticMailboxEnv, mailboxFixture, mockMailbox } from './helpers.js';

test('secure sessions, CSRF, origin checks and owner-scoped reads protect real database records', async t => {
  const h = await harness(); t.after(() => h.close());
  assert.equal((await h.anonymous().get('/api/overview')).status, 401);
  assert.equal((await h.anonymous().post('/internal/workflows/discovery/run').send({})).status, 401);
  const cookie = h.login.headers['set-cookie'].join(';');
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Strict/i);
  const missingCsrf = await h.client.patch('/api/preferences').send({ min_budget: 120 });
  assert.equal(missingCsrf.status, 403);
  const wrongOrigin = await h.request('patch', '/api/preferences', { min_budget: 120 }, { Origin: 'https://untrusted.example' });
  assert.equal(wrongOrigin.status, 403);
  const hostileLogin = await h.anonymous().post('/api/auth/login').send({ email: "' OR 1=1 --", password: 'not-the-password' });
  assert.equal(hostileLogin.status, 401);
  assert.ok(!JSON.stringify(hostileLogin.body).includes('password_hash'));
  const before = ok(await h.request('get', '/api/overview'));
  assert.ok(Object.values(before.metrics).every(x => x === 0), 'Fresh production database has no fabricated metrics');

  await h.db.query('INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4)', ['foreign-user', 'foreign@example.test', 'Foreign user', 'test-only-unused-hash']);
  await h.db.query(`INSERT INTO jobs(id,user_id,platform,external_id,title,description,url) VALUES($1,$2,$3,$4,$5,$6,$7)`,
    ['foreign-job', 'foreign-user', 'upwork', 'foreign-id', 'Private other tenant listing', 'Private description', 'https://www.upwork.com/jobs/~private-other-user']);
  const list = ok(await h.request('get', '/api/jobs'));
  assert.equal(list.items.length, 0);
  assert.equal((await h.request('post', '/api/jobs/foreign-job/score', {})).status, 404);
  assert.equal((await h.request('patch', '/api/jobs/foreign-job', { description: 'Attempted modification of another user job.' })).status, 404);
  const injectionSearch = ok(await h.request('get', `/api/jobs?q=${encodeURIComponent("' OR 1=1 --")}`));
  assert.equal(injectionSearch.items.length, 0);
  const strictPreferences = await h.request('patch', '/api/preferences', { user_id: 'foreign-user' });
  assert.equal(strictPreferences.status, 400);
  ok(await h.request('post', '/api/auth/logout', {}));
  assert.equal((await h.client.get('/api/auth/me')).status, 401);
});

test('authorized imports deduplicate canonical URLs and remain atomic when a row is invalid', async t => {
  const h = await harness(); t.after(() => h.close());
  const first = jobFixture('canonical', { url: 'https://www.upwork.com/jobs/~canonical?utm_source=email#details' });
  const created = ok(await h.request('post', '/api/import/jobs', { items: [first] }));
  assert.equal(created.inserted, 1);
  const repeated = ok(await h.request('post', '/api/import/jobs', { items: [{ ...first, external_id: 'different-id', url: 'https://www.upwork.com/jobs/~canonical?tracking_id=123' }] }));
  assert.equal(repeated.inserted, 0);
  assert.equal(repeated.duplicates, 1);
  assert.equal(Number((await h.db.query('SELECT count(*) AS count FROM jobs')).rows[0].count), 1);
  const invalidBatch = await h.request('post', '/api/import/jobs', { items: [jobFixture('would-be-valid'), jobFixture('bad-domain', { url: 'https://upwork.com.untrusted.example/jobs/id' })] });
  assert.equal(invalidBatch.status, 400);
  assert.equal(Number((await h.db.query('SELECT count(*) AS count FROM jobs')).rows[0].count), 1, 'Invalid mixed batch must not partially import');
  ok(await h.request('patch', '/api/integrations/upwork', { enabled: false }));
  assert.equal((await h.request('post', '/api/import/jobs', { items: [jobFixture('paused-source')] })).status, 400);
  assert.equal(h.calls.fetch.length, 0, 'Imports do not scrape source URLs');
});

test('matching labels local rules honestly and blocks incomplete, low-budget, currency-mismatched and stale jobs', async t => {
  const h = await harness(); t.after(() => h.close());
  const eligible = await importJob(h, 'eligible');
  const scored = ok(await h.request('post', `/api/jobs/${eligible.id}/score`, {}));
  const job = scored.job || scored;
  assert.equal(job.score_source, 'rules');
  assert.ok(job.score >= 70 && job.score <= 100);
  assert.equal(job.status, 'shortlisted');
  for (const [name, details] of [
    ['partial', { full_description: false }],
    ['cheap', { budget_min: 1, budget_max: 20 }],
    ['currency', { currency: 'EUR' }],
    ['stale', { posted_at: new Date(Date.now() - 40 * 86400_000).toISOString() }],
  ]) {
    const candidate = await importJob(h, name, details);
    const proposal = await h.request('post', `/api/jobs/${candidate.id}/proposal`, {});
    assert.equal(proposal.status, 409, `${name} must be blocked before creating a proposal`);
  }
  assert.equal(Number((await h.db.query('SELECT count(*) AS count FROM proposals')).rows[0].count), 0);
  assert.equal(h.calls.fetch.length, 0);
});

test('proposal generation is unique, reviewable and does not fabricate a work history', async t => {
  const h = await harness(); t.after(() => h.close());
  const prepared = await prepareApplication(h, 'proposal');
  assert.equal(prepared.proposal.generator, 'template');
  assert.equal(prepared.proposal.review_required, true);
  assert.match(prepared.proposal.body, /WordPress and SEO website proposal/);
  assert.doesNotMatch(prepared.proposal.body, /\d+ years|previous clients|certified|I have completed|I delivered/i);
  assert.equal((await h.request('post', `/api/applications/${prepared.application.id}/confirm`, { confirmation: 'Test confirmation before review', spend_amount: 0 })).status, 409);
  const duplicateBody = ok(await h.request('post', `/api/jobs/${prepared.id}/proposal`, {}));
  assert.equal((duplicateBody.proposal || duplicateBody).id, prepared.proposal.id);
  assert.equal(Number((await h.db.query('SELECT count(*) AS count FROM proposals')).rows[0].count), 1);
  assert.equal(Number((await h.db.query('SELECT count(*) AS count FROM applications')).rows[0].count), 1);
  ok(await h.request('patch', `/api/proposals/${prepared.proposal.id}`, {
    body: 'Hello, I propose a WordPress scope review, implementation and acceptance testing. Please confirm your priorities.',
    suggested_price: 450, delivery_days: 9,
  }));
  ok(await h.request('post', `/api/proposals/${prepared.proposal.id}/ready`, {}));
  let stored = (await h.db.query('SELECT * FROM proposals WHERE id=$1', [prepared.proposal.id])).rows[0];
  assert.equal(stored.review_required, false);
  assert.ok(stored.reviewed_at);
  ok(await h.request('patch', `/api/jobs/${prepared.id}`, { description: `${prepared.fixture.description} Add accessibility review.` }));
  stored = (await h.db.query('SELECT * FROM proposals WHERE id=$1', [prepared.proposal.id])).rows[0];
  assert.equal(stored.review_required, true, 'Changing job requirements invalidates old approval');
  assert.equal((await h.db.query('SELECT status FROM applications WHERE id=$1', [prepared.application.id])).rows[0].status, 'draft');
});

test('manual confirmation is exactly once and application/spending limits are enforced transactionally', async t => {
  const h = await harness(); t.after(() => h.close());
  ok(await h.request('patch', '/api/preferences', { max_daily_applications: 1, max_daily_spend: 2 }));
  const first = await readyApplication(h, 'first');
  const tooExpensive = await h.request('post', `/api/applications/${first.application.id}/confirm`, { confirmation: 'Synthetic proof that an external submission occurred', spend_amount: 3 });
  assert.equal(tooExpensive.status, 409);
  assert.equal(tooExpensive.body.code, 'SPEND_LIMIT');
  const confirmation = { confirmation: 'Synthetic confirmation; no real platform submission occurred', spend_amount: 2 };
  ok(await h.request('post', `/api/applications/${first.application.id}/confirm`, confirmation));
  const duplicate = ok(await h.request('post', `/api/applications/${first.application.id}/confirm`, confirmation));
  assert.equal(duplicate.duplicate, true);
  const usage = (await h.db.query('SELECT * FROM daily_usage WHERE user_id=$1', [h.owner.id])).rows[0];
  assert.equal(usage.application_count, 1);
  assert.equal(Number(usage.spend_amount), 2);
  const second = await prepareApplication(h, 'second');
  const limit = await h.request('post', `/api/proposals/${second.proposal.id}/ready`, {});
  assert.equal(limit.status, 409);
  assert.equal(limit.body.code, 'APPLICATION_LIMIT');
  const editSubmitted = await h.request('patch', `/api/proposals/${first.proposal.id}`, { body: 'Attempt to replace the already submitted immutable proposal.', suggested_price: 500, delivery_days: 7 });
  assert.equal(editSubmitted.status, 409);
});

test('automatic submission never makes a platform request and Fiverr inquiries cannot become applications', async t => {
  const h = await harness(); t.after(() => h.close());
  const prepared = await readyApplication(h, 'no-autosubmit');
  const blocked = await h.request('post', `/api/applications/${prepared.application.id}/submit`, {});
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.code, 'MANUAL_SUBMISSION_REQUIRED');
  const fiverr = await importJob(h, 'inquiry', { platform: 'fiverr', url: 'https://www.fiverr.com/inbox/integration-client', title: 'Incoming WordPress inquiry' });
  const record = (await h.db.query('SELECT * FROM jobs WHERE id=$1', [fiverr.id])).rows[0];
  assert.equal(record.kind, 'inquiry');
  const inquiry = await h.request('post', `/api/jobs/${fiverr.id}/proposal`, {});
  assert.equal(inquiry.status, 409);
  assert.equal(inquiry.body.code, 'INQUIRY_ONLY');
  assert.equal(h.calls.fetch.length, 0);
  const audit = await h.db.query("SELECT action FROM audit_log WHERE action='automatic_submission_blocked' AND user_id=$1", [h.owner.id]);
  assert.equal(audit.rows.length, 1);
});

test('client replies match exact jobs, update application state, avoid duplicate alerts and preserve newer decisions', async t => {
  const h = await harness({ env: { NOTIFICATION_EMAIL: 'owner@example.test' } }); t.after(() => h.close());
  const application = await submittedApplication(h, 'reply-link');
  const now = Date.now();
  const message = {
    platform: 'upwork', external_id: 'message-interview', body: 'We would like to schedule an interview call with you.',
    received_at: new Date(now - 20_000).toISOString(), client_name: 'Test Client',
    conversation_url: 'https://www.upwork.com/ab/messages/rooms/integration-room',
    job_url: application.fixture.url,
  };
  const first = ok(await h.request('post', '/api/import/messages', { items: [message] }));
  assert.equal(first.inserted, 1);
  const stored = (await h.db.query('SELECT * FROM applications WHERE id=$1', [application.application.id])).rows[0];
  assert.equal(stored.status, 'interview');
  const notificationsBefore = Number((await h.db.query('SELECT count(*) AS n FROM notification_logs')).rows[0].n);
  const repeat = ok(await h.request('post', '/api/import/messages', { items: [message] }));
  assert.equal(repeat.duplicates, 1);
  assert.equal(Number((await h.db.query('SELECT count(*) AS n FROM notification_logs')).rows[0].n), notificationsBefore);
  ok(await h.request('post', '/api/import/messages', { items: [{ ...message, external_id: 'message-offer', body: 'We sent you an offer for this project.', received_at: new Date(now - 5_000).toISOString() }] }));
  ok(await h.request('post', '/api/import/messages', { items: [{ ...message, external_id: 'message-older-negotiation', body: 'Can you lower your price for this budget?', received_at: new Date(now - 60_000).toISOString() }] }));
  assert.equal((await h.db.query('SELECT status FROM applications WHERE id=$1', [application.application.id])).rows[0].status, 'offer');
  const messages = ok(await h.request('get', '/api/messages'));
  assert.equal(messages.items.length, 3);
  assert.ok(messages.items.every(item => item.application_id === application.application.id));
  const payload = (await h.db.query('SELECT payload FROM notification_logs LIMIT 1')).rows[0].payload;
  assert.match(payload.subject, /New Client Reply/);
  assert.ok(!payload.email_text.includes(message.body), 'Message excerpts default off');
});

test('unlinked replies stay unlinked and conflicting conversation associations are rejected', async t => {
  const h = await harness(); t.after(() => h.close());
  const first = await submittedApplication(h, 'first-match');
  const second = await submittedApplication(h, 'second-match');
  const common = { platform: 'upwork', body: 'Please share more details.', received_at: new Date(Date.now() - 1000).toISOString(), client_name: 'Same Client' };
  const unlinked = ok(await h.request('post', '/api/import/messages', { items: [{ ...common, external_id: 'unlinked', conversation_url: 'https://www.upwork.com/ab/messages/rooms/unlinked-room' }] }));
  assert.equal(unlinked.unmatched, 1);
  const msg = { ...common, external_id: 'linked', conversation_url: 'https://www.upwork.com/ab/messages/rooms/shared-room', job_url: first.fixture.url };
  ok(await h.request('post', '/api/import/messages', { items: [msg] }));
  const conflicting = await h.request('post', '/api/import/messages', { items: [{ ...msg, external_id: 'conflicting', job_url: second.fixture.url }] });
  assert.equal(conflicting.status, 409);
  assert.equal(conflicting.body.code, 'AMBIGUOUS_MATCH');
  assert.equal((await h.db.query('SELECT application_id FROM conversations WHERE url=$1', ['https://www.upwork.com/ab/messages/rooms/unlinked-room'])).rows[0].application_id, null);
  assert.equal(Number((await h.db.query('SELECT count(*) AS n FROM client_messages')).rows[0].n), 2);
});

test('notification outbox delivers mocked email and Telegram once per event and does not send client replies', async t => {
  const h = await harness({
    env: { SMTP_FROM: 'assistant@example.test', NOTIFICATION_EMAIL: 'owner@example.test', TELEGRAM_BOT_TOKEN: 'synthetic-token', TELEGRAM_CHAT_ID: '123456789' },
    transport: async () => ({ messageId: 'mock-email-id', accepted: ['owner@example.test'], rejected: [] }),
    fetcher: async url => {
      assert.equal(String(url), 'https://api.telegram.org/botsynthetic-token/sendMessage');
      return new Response(JSON.stringify({ ok: true, result: { message_id: 42 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  }); t.after(() => h.close());
  const message = { platform: 'fiverr', external_id: 'fiverr-notification', body: 'Could you share more information about your WordPress service?', received_at: new Date(Date.now() - 1000).toISOString(), conversation_url: 'https://www.fiverr.com/inbox/client-test' };
  ok(await h.request('post', '/api/import/messages', { items: [message] }));
  await h.notifications.drain(h.owner.id);
  await h.notifications.drain(h.owner.id);
  assert.equal(h.calls.email.length, 1);
  assert.equal(h.calls.fetch.length, 1);
  assert.equal(h.calls.email[0].to, 'owner@example.test');
  const telegram = JSON.parse(h.calls.fetch[0].init.body);
  assert.equal(telegram.chat_id, '123456789');
  assert.match(telegram.text, /fiverr/i);
  const messages = ok(await h.request('get', '/api/messages'));
  const draft = ok(await h.request('post', `/api/messages/${messages.items[0].id}/draft`, {}));
  assert.ok(draft.draft_response);
  assert.equal(h.calls.email.length, 1, 'Creating a reply draft never sends a reply');
  assert.equal(h.calls.fetch.length, 1, 'Only the notification Bot API endpoint was called');
  const states = (await h.db.query('SELECT status FROM notification_logs')).rows;
  assert.equal(states.length, 2);
  assert.ok(states.every(row => row.status === 'sent'));
});

test('ambiguous provider delivery outcomes are retained as unknown and never retried automatically', async t => {
  const h = await harness({
    env: { SMTP_FROM: 'assistant@example.test', NOTIFICATION_EMAIL: 'owner@example.test' },
    transport: async () => { const error = new Error('Provider accepted possibly; response lost'); error.code = 'ETIMEDOUT'; throw error; },
  }); t.after(() => h.close());
  const imported = ok(await h.request('post', '/api/import/messages', { items: [{ platform: 'guru', external_id: 'ambiguous-delivery', body: 'Please share more information.', received_at: new Date(Date.now() - 1000).toISOString(), conversation_url: 'https://www.guru.com/messages/integration-test' }] }));
  assert.equal(imported.delivery.unknown, 1);
  await h.notifications.drain(h.owner.id);
  assert.equal(h.calls.email.length, 1);
  const entry = (await h.db.query('SELECT * FROM notification_logs')).rows[0];
  assert.equal(entry.status, 'unknown');
  assert.match(entry.last_error, /Check the destination/i);
});

test('daily report is produced for zero-activity days and one date produces only one email', async t => {
  const h = await harness({
    env: { SMTP_FROM: 'assistant@example.test', NOTIFICATION_EMAIL: 'owner@example.test' },
    transport: async () => ({ messageId: 'mock-daily-report', rejected: [] }),
  }); t.after(() => h.close());
  const first = await h.workflows.run(h.owner.id, 'daily_report', 'daily-first-execution');
  assert.equal(first.status, 'completed');
  assert.equal(h.calls.email.length, 1);
  assert.match(h.calls.email[0].text, /New jobs discovered today: 0/);
  assert.match(h.calls.email[0].text, /No new opportunities or client replies/);
  assert.match(h.calls.email[0].text, /Asia\/Kolkata/);
  assert.match(h.calls.email[0].text, /not yet connected|not_connected/);
  await h.workflows.run(h.owner.id, 'daily_report', 'daily-second-execution');
  assert.equal(h.calls.email.length, 1);
  assert.equal(Number((await h.db.query("SELECT count(*) AS n FROM notification_logs WHERE event_key LIKE 'daily:%'")).rows[0].n), 1);
});

test('workflow pause gates processing, idempotency survives repeats and parallel executions do not duplicate work', async t => {
  const h = await harness(); t.after(() => h.close());
  const imported = await importJob(h, 'scheduled');
  ok(await h.request('patch', '/api/workflows/discovery', { enabled: false }));
  const paused = await h.workflows.run(h.owner.id, 'discovery', 'paused-check');
  assert.equal(paused.status, 'skipped');
  assert.equal((await h.db.query('SELECT score FROM jobs WHERE id=$1', [imported.id])).rows[0].score, null);
  ok(await h.request('patch', '/api/workflows/discovery', { enabled: true }));
  const [first, second] = await Promise.all([
    h.workflows.run(h.owner.id, 'discovery', 'concurrent-execution'),
    h.workflows.run(h.owner.id, 'discovery', 'concurrent-execution'),
  ]);
  assert.ok([first, second].some(x => x.status === 'completed'));
  const replay = await h.workflows.run(h.owner.id, 'discovery', 'concurrent-execution');
  assert.equal(replay.replayed, true);
  assert.equal(Number((await h.db.query('SELECT count(*) AS n FROM workflow_runs WHERE idempotency_key=$1', ['concurrent-execution'])).rows[0].n), 1);
  assert.ok((await h.db.query('SELECT score FROM jobs WHERE id=$1', [imported.id])).rows[0].score >= 70);
  const internal = await h.anonymous().post('/internal/workflows/discovery/run').set('Authorization', `Bearer ${h.config.workflowToken}`).set('X-Idempotency-Key', 'internal-idem').send({});
  ok(internal);
  const internalRepeat = await h.anonymous().post('/internal/workflows/discovery/run').set('Authorization', `Bearer ${h.config.workflowToken}`).set('X-Idempotency-Key', 'internal-idem').send({});
  ok(internalRepeat);
  assert.equal(Number((await h.db.query('SELECT count(*) AS n FROM workflow_runs WHERE idempotency_key=$1', ['internal-idem'])).rows[0].n), 1);
});

test('OpenAI structured responses drive scores and proposals while the daily call limit prevents excess requests', async t => {
  const h = await harness({
    env: { OPENAI_API_KEY: 'synthetic-test-key-never-sent', AI_DAILY_CALL_LIMIT: '2' },
    fetcher: async (url, init) => {
      assert.equal(String(url), 'https://api.openai.com/v1/responses');
      const payload = JSON.parse(init.body);
      assert.equal(payload.store, false);
      assert.equal(payload.text.format.strict, true);
      assert.match(payload.instructions, /untrusted data/);
      assert.ok(!payload.input.includes('synthetic-test-key'));
      const value = payload.text.format.name === 'job_match'
        ? { score: 92, reason: 'WordPress and technical SEO requirements match the configured skills.' }
        : { steps: ['Confirm the WordPress page inventory and acceptance criteria.', 'Implement responsive templates and run technical SEO checks.'], questions: ['Which launch date should the milestones support?'], estimated_hours: 14, delivery_days: 6 };
      return new Response(JSON.stringify({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(value) }] }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  }); t.after(() => h.close());
  ok(await h.request('patch', '/api/preferences', { ai_enabled: true }));
  const prepared = await prepareApplication(h, 'ai-boundary');
  assert.equal(prepared.proposal.generator, 'openai');
  assert.match(prepared.proposal.body, /Implement responsive templates/);
  const job = ok(await h.request('get', `/api/jobs/${prepared.id}`));
  assert.equal(job.score_source, 'openai');
  assert.equal(job.score, 92);
  assert.equal(h.calls.fetch.length, 2);
  const another = await importJob(h, 'ai-budget-exhausted');
  const limited = await h.request('post', `/api/jobs/${another.id}/score`, {});
  assert.equal(limited.status, 429);
  assert.equal(limited.body.code, 'AI_LIMIT');
  assert.equal(h.calls.fetch.length, 2, 'An exhausted budget must stop the network request itself');
  assert.equal((await h.db.query('SELECT score FROM jobs WHERE id=$1', [another.id])).rows[0].score, null);
});

test('known pre-acceptance notification failures back off and can recover without duplicate delivery', async t => {
  let attempts = 0;
  const h = await harness({
    env: { SMTP_FROM: 'assistant@example.test', NOTIFICATION_EMAIL: 'owner@example.test' },
    transport: async () => {
      attempts++;
      if (attempts === 1) { const error = new Error('Synthetic SMTP authentication failure'); error.code = 'EAUTH'; throw error; }
      return { messageId: 'retry-confirmed', rejected: [] };
    },
  }); t.after(() => h.close());
  const imported = ok(await h.request('post', '/api/import/messages', { items: [{ platform: 'guru', external_id: 'recoverable-delivery', body: 'Please share more information.', received_at: new Date(Date.now() - 1000).toISOString(), conversation_url: 'https://www.guru.com/messages/recoverable-test' }] }));
  assert.equal(imported.delivery.failed, 1);
  let entry = (await h.db.query('SELECT * FROM notification_logs')).rows[0];
  assert.equal(entry.status, 'failed');
  assert.ok(new Date(entry.next_attempt_at).getTime() > Date.now());
  await h.notifications.drain(h.owner.id);
  assert.equal(attempts, 1, 'Backoff prevents immediate repeat attempts');
  await h.db.query("UPDATE notification_logs SET next_attempt_at=now()-interval '1 second' WHERE id=$1", [entry.id]);
  await h.notifications.drain(h.owner.id);
  await h.notifications.drain(h.owner.id);
  assert.equal(attempts, 2);
  entry = (await h.db.query('SELECT * FROM notification_logs WHERE id=$1', [entry.id])).rows[0];
  assert.equal(entry.status, 'sent');
  assert.equal(entry.attempts, 2);
});

test('editing a job while AI scoring is pending cannot overwrite its revised requirements with a stale score', { timeout: 20_000 }, async t => {
  let signalStarted;
  let release;
  const started = new Promise(resolve => { signalStarted = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const h = await harness({
    env: { OPENAI_API_KEY: 'synthetic-concurrency-test-key' },
    fetcher: async () => {
      signalStarted();
      await gate;
      return new Response(JSON.stringify({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ score: 95, reason: 'Matches the original requirements.' }) }] }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  }); t.after(() => h.close());
  ok(await h.request('patch', '/api/preferences', { ai_enabled: true }));
  const imported = await importJob(h, 'revision-race');
  const pendingScore = h.request('post', `/api/jobs/${imported.id}/score`, {}).then(result => result);
  try {
    await started;
    ok(await h.request('patch', `/api/jobs/${imported.id}`, { description: 'Updated project requirements: perform SQL data analysis and build Power BI reports; this replaces the earlier website scope.' }));
  } finally {
    release();
  }
  const stale = await pendingScore;
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'JOB_CHANGED');
  const stored = ok(await h.request('get', `/api/jobs/${imported.id}`));
  assert.equal(stored.score, null);
  assert.match(stored.description, /SQL data analysis/);
});

test('pausing notifications preserves queued alerts until the workflow is resumed', async t => {
  const h = await harness({
    env: { SMTP_FROM: 'assistant@example.test', NOTIFICATION_EMAIL: 'owner@example.test' },
    transport: async () => ({ messageId: 'resumed-alert', rejected: [] }),
  }); t.after(() => h.close());
  ok(await h.request('patch', '/api/workflows/notifications', { enabled: false }));
  ok(await h.request('post', '/api/import/messages', { items: [{ platform: 'fiverr', external_id: 'paused-notification', body: 'Can you share your WordPress service details?', received_at: new Date(Date.now() - 1000).toISOString(), conversation_url: 'https://www.fiverr.com/inbox/paused-alert-client' }] }));
  assert.equal(h.calls.email.length, 0, 'Immediate import delivery must honor the workflow pause');
  assert.equal((await h.db.query('SELECT status FROM notification_logs')).rows[0].status, 'pending');
  ok(await h.request('patch', '/api/workflows/notifications', { enabled: true }));
  await h.notifications.drain(h.owner.id);
  assert.equal(h.calls.email.length, 1);
});

test('an SMTP connection closure after possible acceptance is unknown and is not sent again', async t => {
  const h = await harness({
    env: { SMTP_FROM: 'assistant@example.test', NOTIFICATION_EMAIL: 'owner@example.test' },
    transport: async () => { throw Object.assign(new Error('socket closed after acceptance'), { code: 'ECONNECTION' }); },
  }); t.after(() => h.close());
  const imported = ok(await h.request('post', '/api/import/messages', { items: [{
    platform: 'upwork', external_id: 'connection-closed-after-acceptance', body: 'Please share more project information.',
    received_at: new Date(Date.now() - 1000).toISOString(), conversation_url: 'https://www.upwork.com/ab/messages/rooms/connection-closure',
  }] }));
  assert.equal(imported.delivery.unknown, 1);
  const entry = (await h.db.query('SELECT * FROM notification_logs')).rows[0];
  assert.equal(entry.status, 'unknown');
  assert.equal(entry.attempts, 1);
  await h.db.query("UPDATE notification_logs SET next_attempt_at=now()-interval '1 minute' WHERE id=$1", [entry.id]);
  await h.notifications.drain(h.owner.id);
  await h.notifications.drain(h.owner.id);
  assert.equal(h.calls.email.length, 1, 'A due timestamp must not make an ambiguous send eligible');
});

test('concurrent first messages share one conversation and the newer interview wins over an older negotiation', async t => {
  const h = await harness(); t.after(() => h.close());
  const application = await submittedApplication(h, 'concurrent-messages');
  const now = Date.now();
  const common = {
    platform: 'upwork', client_name: 'Concurrent Test Client', job_url: application.fixture.url,
    conversation_url: 'https://www.upwork.com/ab/messages/rooms/first-concurrent-conversation',
  };
  const newer = { ...common, external_id: 'newer-interview', body: 'We invite you to an interview call.', received_at: new Date(now - 1000).toISOString() };
  const older = { ...common, external_id: 'older-negotiation', body: 'Can you lower your price for this budget?', received_at: new Date(now - 60_000).toISOString() };
  const results = await Promise.all([
    h.request('post', '/api/import/messages', { items: [newer] }),
    h.request('post', '/api/import/messages', { items: [older] }),
  ]);
  results.forEach(result => assert.equal(ok(result).inserted, 1));
  const conversations = (await h.db.query('SELECT * FROM conversations WHERE user_id=$1', [h.owner.id])).rows;
  assert.equal(conversations.length, 1);
  assert.equal(conversations[0].application_id, application.application.id);
  const messages = (await h.db.query('SELECT conversation_id FROM client_messages WHERE user_id=$1', [h.owner.id])).rows;
  assert.equal(messages.length, 2);
  assert.ok(messages.every(message => message.conversation_id === conversations[0].id));
  const stored = (await h.db.query('SELECT status,last_reply_at FROM applications WHERE id=$1', [application.application.id])).rows[0];
  assert.equal(stored.status, 'interview');
  assert.equal(new Date(stored.last_reply_at).toISOString(), newer.received_at);
});

test('a racing manual confirmation and job edit cannot mutate the scope of a confirmed submission', async t => {
  const h = await harness(); t.after(() => h.close());
  const prepared = await readyApplication(h, 'confirm-edit-race');
  const changedDescription = `${prepared.fixture.description} The revised scope also includes SQL reporting.`;
  const [confirmation, edit] = await Promise.all([
    h.request('post', `/api/applications/${prepared.application.id}/confirm`, { confirmation: 'Synthetic race-test confirmation; no real submission occurred.', spend_amount: 0 }),
    h.request('patch', `/api/jobs/${prepared.id}`, { description: changedDescription }),
  ]);
  const confirmSucceeded = confirmation.status >= 200 && confirmation.status < 300;
  const editSucceeded = edit.status >= 200 && edit.status < 300;
  assert.notEqual(confirmSucceeded, editSucceeded, 'Exactly one of the conflicting operations may succeed');
  const application = (await h.db.query('SELECT * FROM applications WHERE id=$1', [prepared.application.id])).rows[0];
  const job = (await h.db.query('SELECT description FROM jobs WHERE id=$1', [prepared.id])).rows[0];
  const proposal = (await h.db.query('SELECT review_required FROM proposals WHERE id=$1', [prepared.proposal.id])).rows[0];
  if (confirmSucceeded) {
    assert.equal(edit.status, 409);
    assert.equal(application.status, 'submitted');
    assert.ok(application.submitted_at);
    assert.equal(job.description, prepared.fixture.description);
    assert.equal(proposal.review_required, false);
  } else {
    assert.equal(confirmation.status, 409);
    assert.equal(application.status, 'draft');
    assert.equal(application.submitted_at, null);
    assert.equal(job.description, changedDescription);
    assert.equal(proposal.review_required, true);
  }
});

test('a reply run with disconnected alert delivery is recorded as needs_setup even when mailbox processing succeeds', async t => {
  const h = await harness(); t.after(() => h.close());
  // Isolate the orchestration boundary without making an actual IMAP connection.
  h.workflows.perform = async (user, name) => {
    assert.equal(user, h.owner.id);
    assert.equal(name, 'replies');
    return { mailbox: { connected: true }, processed: 1, inserted: 1, duplicates: 0, failed: 0,
      delivery: { sent: 0, failed: 0, disconnected: 1, unknown: 0, cancelled: 0 } };
  };
  const run = await h.workflows.run(h.owner.id, 'replies', 'nested-disconnected-alert');
  assert.equal(run.status, 'needs_setup');
  assert.equal(run.retryable, true);
  assert.equal(run.summary.delivery.disconnected, 1);
  assert.ok(run.error);
  const saved = (await h.db.query('SELECT status,retryable FROM workflow_runs WHERE id=$1', [run.id])).rows[0];
  assert.equal(saved.status, 'needs_setup');
  assert.equal(saved.retryable, true);
});

test('discovery ingests permitted mailbox jobs while replies are paused and retains reply events for resume', { timeout: 20_000 }, async t => {
  const h = await harness({ env: syntheticMailboxEnv }); t.after(() => h.close());
  const mailbox = mockMailbox(t, { messages: [
    mailboxFixture(1),
    mailboxFixture(2, { subject: 'New message from Jamie', body: 'Could we arrange an interview? https://www.upwork.com/ab/messages/rooms/paused-replies-room' }),
  ] });
  ok(await h.request('patch', '/api/workflows/replies', { enabled: false }));
  const paused = await h.workflows.run(h.owner.id, 'replies', 'paused-mailbox-replies');
  assert.equal(paused.status, 'skipped');
  assert.equal(mailbox.connections, 0);

  const discovery = await h.workflows.run(h.owner.id, 'discovery', 'discovery-independent-intake');
  assert.equal(discovery.status, 'completed');
  assert.equal(discovery.summary.mailbox.connected, true);
  assert.equal(discovery.summary.mailbox.queued, 2);
  assert.equal(discovery.summary.inserted, 1);
  assert.equal(mailbox.connections, 1, 'Discovery must perform its own authorized mailbox poll');
  const jobs = (await h.db.query('SELECT url,source,full_description,status FROM jobs WHERE user_id=$1', [h.owner.id])).rows;
  assert.deepEqual(jobs, [{ url: 'https://www.upwork.com/jobs/~abc1', source: 'email', full_description: false, status: 'needs_details' }]);
  const staged = (await h.db.query('SELECT kind,status FROM email_events WHERE user_id=$1 ORDER BY kind', [h.owner.id])).rows;
  assert.deepEqual(staged, [{ kind: 'job', status: 'processed' }, { kind: 'reply', status: 'pending' }]);
  assert.equal(Number((await h.db.query('SELECT count(*) AS n FROM client_messages')).rows[0].n), 0);

  ok(await h.request('patch', '/api/workflows/replies', { enabled: true }));
  const resumed = await h.workflows.run(h.owner.id, 'replies', 'resumed-mailbox-replies');
  assert.equal(resumed.status, 'completed');
  assert.equal(resumed.summary.inserted, 1);
  assert.equal(resumed.summary.mailbox.queued, 0, 'The saved UID checkpoint prevents another ingestion');
  assert.equal(Number((await h.db.query('SELECT count(*) AS n FROM client_messages')).rows[0].n), 1);
  assert.equal(Number((await h.db.query('SELECT count(*) AS n FROM email_events')).rows[0].n), 2);
  assert.equal(h.calls.fetch.length, 0);
});

test('overlapping discovery and replies serialize mailbox intake and resume from the durable UID checkpoint', { timeout: 20_000 }, async t => {
  const h = await harness({ env: syntheticMailboxEnv }); t.after(() => h.close());
  const started = Promise.withResolvers();
  const gate = Promise.withResolvers();
  const mailbox = mockMailbox(t, {
    messages: [mailboxFixture(1)],
    beforeConnect: async ordinal => { if (ordinal === 1) { started.resolve(); await gate.promise; } },
  });
  const pendingDiscovery = h.workflows.run(h.owner.id, 'discovery', 'overlapping-discovery');
  try {
    await started.promise;
    const lease = (await h.db.query('SELECT poll_lock_token,poll_lock_until FROM mailbox_state WHERE user_id=$1', [h.owner.id])).rows[0];
    assert.ok(lease.poll_lock_token);
    assert.ok(new Date(lease.poll_lock_until).getTime() > Date.now());
    const replies = await h.workflows.run(h.owner.id, 'replies', 'overlapping-replies');
    assert.equal(replies.status, 'completed');
    assert.equal(replies.summary.mailbox.busy, true);
    assert.equal(replies.summary.mailbox.connected, null);
    assert.equal(mailbox.connections, 1, 'A competing workflow must not open a second mailbox session');
    assert.equal(mailbox.maxActive, 1);
    const held = (await h.db.query('SELECT poll_lock_token FROM mailbox_state WHERE user_id=$1', [h.owner.id])).rows[0];
    assert.equal(held.poll_lock_token, lease.poll_lock_token, 'The skipped contender must preserve the active lease');
  } finally {
    gate.resolve();
    await pendingDiscovery;
  }
  const discovery = await pendingDiscovery;
  assert.equal(discovery.status, 'completed');
  assert.equal(discovery.summary.inserted, 1);
  const resumed = await h.workflows.run(h.owner.id, 'replies', 'post-discovery-replies');
  assert.equal(resumed.status, 'completed');
  assert.equal(resumed.summary.mailbox.connected, true);
  assert.equal(resumed.summary.mailbox.queued, 0);
  assert.equal(mailbox.connections, 2);
  assert.equal(mailbox.maxActive, 1);
  assert.deepEqual(mailbox.searches[1], { uid: '2:*' });
  const state = (await h.db.query('SELECT last_uid,poll_lock_token,poll_lock_until FROM mailbox_state WHERE user_id=$1', [h.owner.id])).rows[0];
  assert.equal(Number(state.last_uid), 1);
  assert.equal(state.poll_lock_token, null);
  assert.equal(state.poll_lock_until, null);
  assert.equal(Number((await h.db.query('SELECT count(*) AS n FROM email_events')).rows[0].n), 1);
});

test('a mailbox poll finishing after lease expiry cannot release the replacement poll owner', { timeout: 20_000 }, async t => {
  const h = await harness({ env: syntheticMailboxEnv }); t.after(() => h.close());
  const started = [Promise.withResolvers(), Promise.withResolvers()];
  const gates = [Promise.withResolvers(), Promise.withResolvers()];
  const mailbox = mockMailbox(t, {
    beforeConnect: async ordinal => {
      if (ordinal <= 2) { started[ordinal - 1].resolve(); await gates[ordinal - 1].promise; }
    },
  });
  const first = h.workflows.intake(h.owner.id);
  let replacement;
  try {
    await started[0].promise;
    const original = (await h.db.query('SELECT poll_lock_token FROM mailbox_state WHERE user_id=$1', [h.owner.id])).rows[0];
    // Simulate expiry without a wall-clock wait, then let the real claim acquire a new owner.
    await h.db.query("UPDATE mailbox_state SET poll_lock_until=now()-interval '1 second' WHERE user_id=$1", [h.owner.id]);
    replacement = h.workflows.intake(h.owner.id);
    await started[1].promise;
    const newer = (await h.db.query('SELECT poll_lock_token,poll_lock_until FROM mailbox_state WHERE user_id=$1', [h.owner.id])).rows[0];
    assert.ok(newer.poll_lock_token);
    assert.notEqual(newer.poll_lock_token, original.poll_lock_token);
    gates[0].resolve();
    assert.equal((await first).connected, true);
    const stillOwned = (await h.db.query('SELECT poll_lock_token,poll_lock_until FROM mailbox_state WHERE user_id=$1', [h.owner.id])).rows[0];
    assert.deepEqual(stillOwned, newer, 'An expired owner must leave its successor lease untouched');
    assert.equal((await h.workflows.intake(h.owner.id)).busy, true);
    assert.equal(mailbox.connections, 2);
  } finally {
    gates.forEach(gate => gate.resolve());
    await Promise.allSettled([first, replacement].filter(Boolean));
  }
  assert.equal((await replacement).connected, true);
  const released = (await h.db.query('SELECT poll_lock_token,poll_lock_until FROM mailbox_state WHERE user_id=$1', [h.owner.id])).rows[0];
  assert.deepEqual(released, { poll_lock_token: null, poll_lock_until: null });
  assert.equal((await h.workflows.intake(h.owner.id)).connected, true);
  assert.equal(mailbox.connections, 3, 'New intake can proceed after the current owner finishes');
});
