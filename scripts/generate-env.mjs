#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const emailFlag = process.argv.indexOf('--email');
const email = emailFlag >= 0 ? process.argv[emailFlag + 1] : '';
if (!email || !/^[^\s@"'<>]+@[^\s@"'<>]+\.[^\s@"'<>]+$/.test(email) || /[#$`\\]/.test(email)) {
  console.error('Usage: node scripts/generate-env.mjs --email you@example.com');
  process.exit(1);
}
const secrets = {
  GENERATE_ADMIN_PASSWORD: randomBytes(30).toString('base64url'),
  GENERATE_WORKFLOW_TOKEN: randomBytes(32).toString('hex'),
  GENERATE_POSTGRES_PASSWORD: randomBytes(32).toString('hex'),
  GENERATE_APP_DB_PASSWORD: randomBytes(32).toString('hex'),
  GENERATE_N8N_DB_PASSWORD: randomBytes(32).toString('hex'),
  GENERATE_N8N_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
};
let template = await readFile(path.join(root, '.env.example'), 'utf8');
template = template.replace('ADMIN_EMAIL=change-me@example.com', `ADMIN_EMAIL=${email}`);
template = template.replace('NOTIFICATION_EMAIL=\n', `NOTIFICATION_EMAIL=${email}\n`);
for (const [placeholder, secret] of Object.entries(secrets)) {
  template = template.replaceAll(placeholder, secret);
}
try {
  await writeFile(path.join(root, '.env'), template, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  console.log('Created .env with private permissions. Open it locally to view your generated login password and add optional service credentials. No secrets were printed.');
} catch (error) {
  if (error.code === 'EEXIST') {
    console.error('.env already exists. It was not changed. Edit that file locally.');
    process.exitCode = 1;
  } else {
    throw error;
  }
}
