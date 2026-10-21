#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expectedOrigin=process.argv[2] ? new URL(process.argv[2]).origin : 'http://app:3000';
const folder = path.join(root, process.argv[2] ? 'n8n-netlify' : 'n8n');
const files = (await readdir(folder)).filter(x => x.endsWith('.json')).sort();
assert.equal(files.length, 6, 'Expected six separately importable workflows');
const names = new Set();
const endpoints = new Set(['discovery', 'proposals', 'replies', 'notifications', 'daily_report', 'retention']);
for (const file of files) {
  const text = await readFile(path.join(folder, file), 'utf8');
  const workflow = JSON.parse(text);
  assert.equal(workflow.active, false, `${file} must not activate itself`);
  assert.equal(workflow.settings.timezone, 'Asia/Kolkata', 'Timezone must be explicit');
  assert.equal(workflow.settings.saveDataSuccessExecution, 'none', 'Do not retain successful payloads');
  assert.equal(workflow.settings.saveManualExecutions, false, 'Do not retain manual payloads');
  assert.equal(Object.keys(workflow.pinData).length, 0, 'No real or sample user data may be pinned');
  assert.ok(!text.includes('$env.'), 'Secrets must be credential-backed, not node env reads');
  assert.ok(!names.has(workflow.name), 'Workflow names must be unique');
  names.add(workflow.name);
  const requestNodes = workflow.nodes.filter(x => x.type === 'n8n-nodes-base.httpRequest');
  assert.equal(requestNodes.length, 1, 'One authenticated backend action per workflow');
  const request = requestNodes[0];
  const url = new URL(request.parameters.url);
  assert.equal(url.origin, expectedOrigin, 'Do not send workflow tokens to a marketplace or third party');
  const match = url.pathname.match(/^\/internal\/workflows\/([a-z_]+)\/run$/);
  assert.ok(match && endpoints.delete(match[1]), 'Backend workflow must be recognized and unique');
  assert.equal(request.parameters.authentication, 'genericCredentialType');
  assert.equal(request.parameters.genericAuthType, 'httpHeaderAuth');
  const idem = request.parameters.headerParameters.parameters.find(x => x.name === 'X-Idempotency-Key');
  assert.ok(idem?.value.includes('$execution.id'), 'Retries need a stable execution idempotency key');
  assert.ok(request.maxTries <= 3, 'Bound transport retries');
  const schedule = workflow.nodes.find(x => x.type === 'n8n-nodes-base.scheduleTrigger');
  assert.ok(schedule, 'Schedule trigger required');
  const cron = schedule.parameters.rule.interval[0].expression;
  assert.equal(cron.split(' ').length, 5, 'Use a five-field cron expression');
  if (match[1] === 'daily_report') assert.equal(cron, '0 20 * * *', 'Daily report must be 8 PM local time');
  for (const trigger of ['Schedule', 'Manual check']) {
    assert.equal(workflow.connections[trigger].main[0][0].node, request.name);
  }
}
assert.equal(endpoints.size, 0);
console.log('PASS: all six workflow files have safe activation defaults, explicit schedules, private authenticated targets, bounded retries and no embedded credentials/data.');
