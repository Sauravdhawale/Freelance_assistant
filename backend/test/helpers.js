import { PGlite } from '@electric-sql/pglite';
import supertest from 'supertest';
import assert from 'node:assert/strict';
import { ImapFlow } from 'imapflow';
import { createApplication } from '../src/app.js';
import { loadConfig } from '../src/config.js';

/** Real PostgreSQL engine in WASM; no query emulation or SQL-pattern stubs. */
export async function makeDb() {
  const postgres = new PGlite();
  await postgres.waitReady;
  function adapter(connection) {
    return {
      async query(sql, values = []) {
        if (!values.length) {
          const results = await connection.exec(sql);
          return results.at(-1) || { rows: [], affectedRows: 0 };
        }
        return connection.query(sql, values);
      }
    };
  }
  return {
    ...adapter(postgres),
    transaction: fn => postgres.transaction(tx => fn(adapter(tx))),
    close: () => postgres.close(),
  };
}

export function jobFixture(suffix = 'one', overrides = {}) {
  return {
    platform: 'upwork', external_id: `integration-job-${suffix}`,
    title: `WordPress and SEO website ${suffix}`,
    description: 'Build a responsive WordPress website using HTML, CSS and JavaScript. Configure technical SEO, maintain existing content, test contact forms and prepare a clear handover. The client will provide copy and branding assets.',
    url: `https://www.upwork.com/jobs/~integration-${suffix}`,
    budget_min: 300, budget_max: 500, currency: 'USD', work_type: 'fixed',
    experience_level: 'intermediate', skills: ['WordPress', 'SEO', 'HTML', 'CSS'],
    posted_at: new Date(Date.now() - 60_000).toISOString(), full_description: true,
    ...overrides,
  };
}

export async function harness(options = {}) {
  const db = await makeDb();
  const env = {
    ADMIN_EMAIL: 'owner@example.test', ADMIN_PASSWORD: 'long-test-password-123',
    WORKFLOW_TOKEN: 'a'.repeat(64), APP_ORIGIN: 'http://localhost:3000',
    COOKIE_SECURE: 'false', AI_DAILY_CALL_LIMIT: '5',
    ...options.env,
  };
  const config = loadConfig(env);
  const calls = { fetch: [], email: [] };
  const fetcher = async (url, init = {}) => {
    calls.fetch.push({ url: String(url), init });
    if (!options.fetcher) throw new Error('Unexpected external request in isolated integration test');
    return options.fetcher(url, init);
  };
  const transport = options.transport ? {
    verify: async () => true,
    sendMail: async message => {
      calls.email.push(message);
      return options.transport(message);
    },
  } : undefined;
  let instance;
  try {
    instance = await createApplication({ db, config, dependencies: { fetcher, transport } });
    const client = supertest.agent(instance.app);
    const login = await client.post('/api/auth/login').set('Origin', config.origin)
      .send({ email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD });
    assert.equal(login.status, 200, `Test login failed: ${JSON.stringify(login.body)}`);
    assert.ok(login.body.csrfToken, 'Authenticated API must return a CSRF token');
    const csrf = login.body.csrfToken;
    function request(method, url, body, headers = {}) {
      let req = client[method](url).set('Origin', config.origin).set('X-CSRF-Token', csrf);
      for (const [key, value] of Object.entries(headers)) req = req.set(key, value);
      if (body !== undefined) req = req.send(body);
      return req;
    }
    return {
      ...instance, db, config, env, client, csrf, calls, login, request,
      anonymous: () => supertest(instance.app),
      close: () => db.close(),
    };
  } catch (error) {
    await db.close();
    throw error;
  }
}

export function ok(response) {
  assert.ok(response.status >= 200 && response.status < 300,
    `Expected success, received ${response.status}: ${JSON.stringify(response.body)}`);
  return response.body;
}

export async function importJob(h, suffix = 'one', overrides = {}) {
  const fixture = jobFixture(suffix, overrides);
  const result = ok(await h.request('post', '/api/import/jobs', { items: [fixture] }));
  assert.equal(result.inserted, 1, 'Fixture should produce one actual database row');
  return { id: result.ids[0], fixture };
}

export async function prepareApplication(h, suffix = 'one', overrides = {}) {
  const imported = await importJob(h, suffix, overrides);
  const body = ok(await h.request('post', `/api/jobs/${imported.id}/proposal`, {}));
  const proposal = body.proposal || body;
  assert.ok(proposal.id);
  const stored = await h.db.query('SELECT * FROM applications WHERE job_id=$1', [imported.id]);
  assert.equal(stored.rows.length, 1);
  return { ...imported, proposal, application: stored.rows[0] };
}

export async function readyApplication(h, suffix = 'one', overrides = {}) {
  const prepared = await prepareApplication(h, suffix, overrides);
  ok(await h.request('post', `/api/proposals/${prepared.proposal.id}/ready`, {}));
  return prepared;
}

export async function submittedApplication(h, suffix = 'one', overrides = {}) {
  const prepared = await readyApplication(h, suffix, overrides);
  ok(await h.request('post', `/api/applications/${prepared.application.id}/confirm`, {
    confirmation: `Synthetic integration test confirmation ${suffix}; no real submission occurred.`,
    spend_amount: 0,
  }));
  return prepared;
}

export const syntheticMailboxEnv = {
  IMAP_HOST: 'imap.example.test', IMAP_USER: 'alerts@example.test',
  IMAP_PASS: 'synthetic-mailbox-password', IMAP_TLS: 'true',
  IMAP_ALLOWED_SENDERS: 'notifications@upwork.com', IMAP_AUTH_SERVERS: 'mx.google.com',
};

export function mailboxFixture(uid, { subject = 'New jobs matching your skills', body } = {}) {
  const internalDate = new Date(Date.now() - 60_000);
  return { uid, internalDate, source: Buffer.from([
    'Authentication-Results: mx.google.com; dmarc=pass header.from=upwork.com',
    'From: Upwork <notifications@upwork.com>',
    `Message-ID: <workflow-mail-${uid}@upwork.com>`,
    `Date: ${internalDate.toUTCString()}`, `Subject: ${subject}`,
    'Content-Type: text/plain; charset=utf-8', '',
    body || `WordPress and SEO website\nhttps://www.upwork.com/jobs/~abc${uid}`,
  ].join('\r\n')) };
}

/** Replace only the IMAP transport methods; real parsing, leases and SQL still run. */
export function mockMailbox(t, { messages = [], beforeConnect = async () => {} } = {}) {
  const calls = { connections: 0, active: 0, maxActive: 0, searches: [], releases: 0 };
  const clients = new Set();
  t.mock.method(ImapFlow.prototype, 'connect', async function () {
    const ordinal = ++calls.connections;
    clients.add(this);
    calls.active++;
    calls.maxActive = Math.max(calls.maxActive, calls.active);
    this.mailbox = { uidValidity: 100n, uidNext: Math.max(0, ...messages.map(message => message.uid)) + 1 };
    await beforeConnect(ordinal);
  });
  t.mock.method(ImapFlow.prototype, 'getMailboxLock', async function (path, options) {
    assert.equal(path, 'INBOX');
    assert.equal(options.readOnly, true);
    return { release: () => { calls.releases++; } };
  });
  t.mock.method(ImapFlow.prototype, 'search', async function (criteria, options) {
    assert.equal(options.uid, true);
    calls.searches.push(criteria);
    const after = criteria.uid ? Number(criteria.uid.split(':')[0]) : 0;
    return messages.filter(message => message.uid >= after && (!criteria.since || message.internalDate >= criteria.since)).map(message => message.uid);
  });
  t.mock.method(ImapFlow.prototype, 'fetchOne', async function (id, query, options) {
    assert.equal(options.uid, true);
    const message = messages.find(item => item.uid === Number(id));
    if (!message) return false;
    return query.source ? { source: message.source } : {
      size: message.source.length, internalDate: message.internalDate,
      envelope: { from: [{ address: 'notifications@upwork.com' }] },
    };
  });
  t.mock.method(ImapFlow.prototype, 'logout', async function () {
    if (clients.delete(this)) calls.active--;
    this.close();
  });
  t.after(() => { for (const client of clients) client.close(); });
  return calls;
}
