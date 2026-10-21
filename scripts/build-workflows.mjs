#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const targetOrigin=process.argv[2] || 'http://app:3000';
if(!/^https?:\/\//.test(targetOrigin))throw new Error('Provide an HTTPS site origin.');
const origin=new URL(targetOrigin).origin;
const netlify=origin.startsWith('https:');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const definitions = [
  { file: '01-discovery', key: 'discovery', title: 'Discover permitted opportunities', cron: '*/15 * * * *', purpose: 'Read configured, permitted sources; normalize and deduplicate jobs. No marketplace page scraping.' },
  { file: '02-proposals', key: 'proposals', title: 'Score and prepare proposals', cron: '*/10 * * * *', purpose: 'Prepare drafts from eligible full job descriptions. Unsupported submission methods remain blocked.' },
  { file: '03-replies', key: 'replies', title: 'Monitor client reply notifications', cron: '* * * * *', purpose: 'Poll the dedicated IMAP folder for allowed platform notifications, match conversations and queue alerts. Never send client replies.' },
  { file: '04-notifications', key: 'notifications', title: 'Deliver email and Telegram alerts', cron: '* * * * *', purpose: 'Deliver due outbox notifications through configured user destinations. The backend owns deduplication and exponential retries.' },
  { file: '05-daily-report', key: 'daily_report', title: 'Daily report at 8 PM IST', cron: '0 20 * * *', purpose: 'Produce the daily database report at 20:00 Asia/Kolkata, including zero-activity days; queue delivery to the configured user email.' },
  { file: '06-retention', key: 'retention', title: 'Apply message retention policy', cron: '15 3 * * *', purpose: 'Run the configured retention policy and expire sessions. Review retention days in the dashboard before enabling.' },
];

function id(value) {
  const hex = createHash('sha256').update(value).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

await mkdir(path.join(root, netlify?'n8n-netlify':'n8n'), {recursive: true});
for (const spec of definitions) {
  const workflow = {
    name: `Freelance Assistant | ${spec.title}`,
    active: false,
    nodes: [
      {
        parameters: {content: `## ${spec.title}\n${spec.purpose}\n\n**Setup:** select the saved Header Auth credential **Freelance Assistant API** in the HTTP Request node. It must contain **Authorization** = **Bearer <WORKFLOW_TOKEN>**.\n\n${netlify?'The URL targets your Netlify API. A queued response means accepted, not completed; inspect Automation Logs for the actual result.':'The default URL is for the Docker Compose stack.'} The API checks the dashboard workflow pause setting. Save and publish only after configuring and testing.`, height: 330, width: 630},
        id: id(`${spec.key}:note`), name: 'Setup and purpose', type: 'n8n-nodes-base.stickyNote', typeVersion: 1, position: [-360, -420]
      },
      {
        parameters: {rule: {interval: [{field: 'cronExpression', expression: spec.cron}]}},
        id: id(`${spec.key}:schedule`), name: 'Schedule', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, position: [-340, 0]
      },
      {
        parameters: {}, id: id(`${spec.key}:manual`), name: 'Manual check', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [-340, 180]
      },
      {
        parameters: {
          method: 'POST',
          url: `${origin}/internal/workflows/${spec.key}/run`,
          authentication: 'genericCredentialType',
          genericAuthType: 'httpHeaderAuth',
          sendHeaders: true,
          headerParameters: {parameters: [{name: 'X-Idempotency-Key', value: '={{ $workflow.id + ":" + $execution.id }}'}]},
          sendBody: true,
          specifyBody: 'json',
          jsonBody: '{}',
          options: {timeout: spec.key === 'daily_report' ? 300000 : 120000, response: {response: {responseFormat: 'json'}}}
        },
        id: id(`${spec.key}:request`), name: 'Run authorized backend workflow', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
        position: [0, 80], retryOnFail: true, maxTries: 3, waitBetweenTries: 5000,
        notesInFlow: true, notes: 'Choose the Header Auth credential. Keep backend tokens out of node parameters. Retries reuse the same execution idempotency key.'
      }
    ],
    connections: {
      Schedule: {main: [[{node: 'Run authorized backend workflow', type: 'main', index: 0}]]},
      'Manual check': {main: [[{node: 'Run authorized backend workflow', type: 'main', index: 0}]]}
    },
    settings: {
      executionOrder: 'v1', timezone: 'Asia/Kolkata', executionTimeout: spec.key === 'daily_report' ? 1000 : 420,
      saveDataErrorExecution: 'all', saveDataSuccessExecution: 'none', saveManualExecutions: false,
      saveExecutionProgress: false
    },
    pinData: {},
    meta: {templateCredsSetupCompleted: false},
    tags: []
  };
  await writeFile(path.join(root, netlify?'n8n-netlify':'n8n', `${spec.file}.json`), JSON.stringify(workflow, null, 2) + '\n');
}
console.log(`Wrote ${definitions.length} inactive n8n workflows. Credentials must be configured in n8n.`);
