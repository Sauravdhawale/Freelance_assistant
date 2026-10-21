#!/usr/bin/env node
import assert from 'node:assert/strict';
const base = process.argv[2] || 'http://localhost:3000';
const origin = new URL(base);
assert.ok(['http:', 'https:'].includes(origin.protocol), 'Use an HTTP(S) base URL');
assert.equal(origin.username, '', 'Do not place credentials in a URL');
assert.equal(origin.password, '', 'Do not place credentials in a URL');
const health = await fetch(new URL('/api/health', origin), {signal: AbortSignal.timeout(10_000)});
assert.equal(health.status, 200, 'Application and database must be healthy');
const unauthorized = await fetch(new URL('/api/overview', origin), {signal: AbortSignal.timeout(10_000)});
assert.equal(unauthorized.status, 401, 'Unauthenticated dashboard access must be rejected');
const internal = await fetch(new URL('/internal/workflows/discovery/run', origin), {method: 'POST', signal: AbortSignal.timeout(10_000)});
assert.ok([401, 403, 404].includes(internal.status), 'Anonymous workflow execution must be rejected');
console.log('PASS: readiness responds; dashboard and workflow execution require authentication.');
