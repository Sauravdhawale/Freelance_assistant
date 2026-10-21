import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, readFile, stat, rm, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function isolatedProject() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'freelance-config-test-'));
  await mkdir(path.join(dir, 'scripts'));
  await copyFile(path.join(root, '.env.example'), path.join(dir, '.env.example'));
  await copyFile(path.join(root, 'scripts/generate-env.mjs'), path.join(dir, 'scripts/generate-env.mjs'));
  return dir;
}
function generate(dir, email) {
  return spawnSync(process.execPath, [path.join(dir, 'scripts/generate-env.mjs'), '--email', email], {encoding: 'utf8'});
}

test('generated deployment credentials are private, independent, consistent, and never printed', async () => {
  const dir = await isolatedProject();
  try {
    const result = generate(dir, 'owner@example.com');
    assert.equal(result.status, 0);
    const content = await readFile(path.join(dir, '.env'), 'utf8');
    const values = Object.fromEntries(content.split('\n').filter(line => line && !line.startsWith('#')).map(line => {
      const eq = line.indexOf('=');
      return [line.slice(0, eq), line.slice(eq + 1)];
    }));
    assert.equal(values.ADMIN_EMAIL, 'owner@example.com');
    const keys = ['ADMIN_PASSWORD','WORKFLOW_TOKEN','POSTGRES_PASSWORD','APP_DB_PASSWORD','N8N_DB_PASSWORD','N8N_ENCRYPTION_KEY'];
    assert.equal(new Set(keys.map(key => values[key])).size, keys.length);
    for (const key of keys) {
      assert.ok(values[key].length >= 32);
      assert.ok(!(result.stdout + result.stderr).includes(values[key]));
    }
    assert.equal(new URL(values.DATABASE_URL).password, values.APP_DB_PASSWORD);
    if (process.platform !== 'win32') assert.equal((await stat(path.join(dir, '.env'))).mode & 0o777, 0o600);
    const repeat = generate(dir, 'another@example.com');
    assert.equal(repeat.status, 1);
    assert.equal(await readFile(path.join(dir, '.env'), 'utf8'), content);
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});

test('line breaks and interpolation syntax cannot be injected through the email setting', async () => {
  const dir = await isolatedProject();
  try {
    for (const email of ['owner@example.com\nWORKFLOW_TOKEN=bad', '$(pwd)@example.com', 'owner`cmd`@example.com']) {
      const result = generate(dir, email);
      assert.equal(result.status, 1);
      await assert.rejects(access(path.join(dir, '.env')));
    }
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});
