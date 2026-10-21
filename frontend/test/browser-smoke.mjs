#!/usr/bin/env node
/**
 * Optional browser smoke journey. Requires a built frontend, app dev dependencies,
 * Playwright, and Chromium. See README.md beside this file.
 * Always creates its own temporary PGlite database and loopback HTTP server.
 * It never targets an existing application or reads provider credentials.
 */
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { makeDb } from '../../backend/test/helpers.js';
import { createApplication } from '../../backend/src/app.js';
import { loadConfig } from '../../backend/src/config.js';

const project = fileURLToPath(new URL('../../', import.meta.url));
const out = process.env.BROWSER_ARTIFACT_DIR
  ? path.resolve(process.env.BROWSER_ARTIFACT_DIR)
  : await fs.mkdtemp(path.join(os.tmpdir(), 'freelance-browser-'));
await fs.mkdir(out, { recursive: true });
const testEmail = 'browser-owner@example.test';
const testPassword = randomBytes(24).toString('hex');
const steps = [], errors = [], outsideRequests = [], providerCalls = [];
let db, server, browser, page, base;

async function step(name, fn) {
  await fn();
  steps.push(name);
  process.stdout.write(`PASS ${name}\n`);
}
async function settled() {
  await page.locator('.loading-state').waitFor({ state: 'hidden' });
  await page.locator('.error-panel').waitFor({ state: 'hidden' });
}
async function go(view, heading) {
  await page.goto(`${base}/#${view}`);
  await page.getByRole('heading', { name: heading, exact: true }).waitFor();
  await settled();
}
async function overflow() {
  return page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth }));
}

try {
  await fs.access(path.join(project, 'frontend/dist/index.html'));
  const modulePath = process.env.PLAYWRIGHT_MODULE;
  const specifier = modulePath && (path.isAbsolute(modulePath) || modulePath.startsWith('.'))
    ? pathToFileURL(path.resolve(modulePath)).href : (modulePath || 'playwright');
  const { chromium: engine } = await import(specifier);
  const args = process.env.BROWSER_LAUNCH_ARGS ? JSON.parse(process.env.BROWSER_LAUNCH_ARGS) : [];
  assert(Array.isArray(args) && args.every(arg => typeof arg === 'string'), 'BROWSER_LAUNCH_ARGS must be a JSON array of strings');
  // Pass an explicit environment object: real .env values and account secrets are ignored.
  const config = loadConfig({
    ADMIN_EMAIL: testEmail, ADMIN_PASSWORD: testPassword,
    WORKFLOW_TOKEN: randomBytes(32).toString('hex'),
    APP_ORIGIN: 'http://127.0.0.1:1', COOKIE_SECURE: 'false', AI_DAILY_CALL_LIMIT: '0',
  });
  db = await makeDb();
  const { app } = await createApplication({ db, config, dependencies: {
    fetcher: async url => {
      providerCalls.push(String(url));
      throw new Error('External provider calls are disabled in this isolated browser test');
    },
  } });
  server = await new Promise((resolve, reject) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    listening.once('error', reject);
  });
  base = `http://127.0.0.1:${server.address().port}`;
  config.origin = base;
  browser = await engine.launch({
    headless: true,
    ...(process.env.BROWSER_EXECUTABLE_PATH ? { executablePath: process.env.BROWSER_EXECUTABLE_PATH } : {}),
    args,
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== base) {
      outsideRequests.push(url.origin);
      return route.abort();
    }
    return route.continue();
  });
 await step('Login through the real form',async()=>{await page.goto(base);await page.getByLabel('Email address',{exact:true}).fill(testEmail);await page.getByLabel('Password',{exact:true}).fill(testPassword);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('heading',{name:'Your freelance workspace'}).waitFor();await settled();});
 const views=[['overview','Your freelance workspace'],['jobs','All opportunities'],['recommended','Recommended for you'],['applications','Applications & proposals'],['messages','Client replies'],['interviews','Interviews & offers'],['templates','Your proposal toolkit'],['integrations','Platform integrations'],['notifications','Notification settings'],['preferences','Skills & preferences'],['logs','Automation & activity']];
 await step('All eleven sections render at 1440px without errors or overflow',async()=>{for(const [view,heading]of views){await go(view,heading);const size=await overflow();assert(size.scroll<=size.width+1,`${view} overflows desktop: ${JSON.stringify(size)}`);}await go('overview','Your freelance workspace');assert((await page.locator('.metric-number').allTextContents()).every(value=>Number(value.replaceAll(',',''))===0));await page.screenshot({path:`${out}/browser-overview-empty-desktop.png`,fullPage:true});});
 await step('All eleven sections render at 390px without errors or overflow',async()=>{await page.setViewportSize({width:390,height:844});for(const [view,heading]of views){await go(view,heading);const size=await overflow();assert(size.scroll<=size.width+1,`${view} overflows mobile: ${JSON.stringify(size)}`);}await go('overview','Your freelance workspace');await page.screenshot({path:`${out}/browser-overview-empty-mobile.png`,fullPage:true});await page.getByRole('button',{name:'Open navigation'}).click();await page.getByRole('link',{name:'All Jobs',exact:true}).click();await page.getByRole('heading',{name:'All opportunities',exact:true}).waitFor();assert(await page.locator('.sidebar-open').count()===0);await page.setViewportSize({width:1440,height:1000});});
 await step('Import a clearly fictional job through the JSON dialog',async()=>{await go('jobs','All opportunities');const before=await page.locator('.job-card').count();const existing=await page.locator('.job-card').filter({hasText:'EXAMPLE ONLY — WordPress website and technical SEO'}).count();await page.getByRole('button',{name:'Import opportunities',exact:true}).first().click();const modal=page.getByRole('dialog');await modal.getByRole('button',{name:'JSON',exact:true}).click();await modal.getByLabel('JSON records',{exact:true}).fill(await fs.readFile(`${project}/examples/jobs.json`,'utf8'));await modal.getByRole('button',{name:'Import opportunities',exact:true}).click();await modal.waitFor({state:'hidden'});await page.locator('.job-card').first().waitFor();assert(await page.locator('.job-card').count()===before+(existing?0:1));await page.screenshot({path:`${out}/browser-job.png`,fullPage:true});});
 await step('Import a CSV file and deduplicate its replay',async()=>{for(let attempt=0;attempt<2;attempt++){const before=await page.locator('.job-card').count();const existing=await page.locator('.job-card').filter({hasText:'EXAMPLE ONLY — SQL and Power BI report'}).count();await page.getByRole('button',{name:'Import opportunities',exact:true}).first().click();const modal=page.getByRole('dialog');await modal.getByRole('button',{name:'CSV',exact:true}).click();await modal.locator('input[type=file]').setInputFiles(`${project}/examples/jobs.csv`);await modal.getByRole('button',{name:'Import opportunities',exact:true}).click();await modal.waitFor({state:'hidden'});await settled();assert(await page.locator('.job-card').count()===before+(existing?0:1));}});
 await step('Run actual rule scoring and prepare a proposal through the UI',async()=>{await page.locator('.job-card').filter({hasText:'EXAMPLE ONLY — WordPress website and technical SEO'}).getByRole('button',{name:'Score',exact:true}).click();await page.locator('.score strong').waitFor();assert(Number(await page.locator('.score strong').first().textContent())>=70);await page.locator('.job-card').filter({hasText:'EXAMPLE ONLY — WordPress website and technical SEO'}).getByRole('button',{name:'Prepare proposal',exact:true}).click();await page.getByRole('dialog',{name:'Review your proposal'}).waitFor();assert((await page.getByLabel('Proposal text',{exact:true}).inputValue()).includes('EXAMPLE ONLY'));});
 await step('Review the proposal and mark it ready without sending',async()=>{const dialog=page.getByRole('dialog');const text=dialog.getByLabel('Proposal text',{exact:true});await text.fill(`${await text.inputValue()}\n\nLOCAL BROWSER TEST REVIEW — no real application.`);await dialog.getByLabel('I have reviewed the claims, scope, price, and timeline',{exact:true}).check();await dialog.getByRole('button',{name:'Mark ready',exact:true}).click();await dialog.waitFor({state:'hidden'});await go('applications','Applications & proposals');await page.getByRole('button',{name:'Record submission',exact:true}).waitFor();});
 await step('Record a synthetic manual confirmation and preserve submitted text',async()=>{await page.getByRole('button',{name:'Record submission',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByLabel('Submission confirmation',{exact:true}).fill('LOCAL TEST ONLY — synthetic manual confirmation; no marketplace action occurred.');await dialog.getByLabel('I already submitted this application on the platform',{exact:true}).check();await dialog.getByRole('button',{name:'Record submission',exact:true}).click();await dialog.waitFor({state:'hidden'});await settled();await page.getByRole('button',{name:'Review proposal',exact:true}).click();await page.getByRole('dialog',{name:'Recorded proposal'}).waitFor();assert(await page.getByLabel('Proposal text',{exact:true}).getAttribute('readonly')!==null);await page.getByRole('button',{name:'Close',exact:true}).click();});
 await step('Import a fictional reply, match its application and classify an interview',async()=>{await go('messages','Client replies');await page.getByRole('button',{name:'Import messages',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByLabel('JSON records',{exact:true}).fill(await fs.readFile(`${project}/examples/messages.json`,'utf8'));await dialog.getByRole('button',{name:'Import messages',exact:true}).click();await dialog.waitFor({state:'hidden'});await settled();await page.getByRole('heading',{name:'Fictional Test Client'}).waitFor();assert((await page.locator('.message-card-heading').textContent()).includes('EXAMPLE ONLY'));assert((await page.locator('.message-timestamp').textContent()).includes('Interview'));await page.screenshot({path:`${out}/browser-messages-desktop.png`,fullPage:true});});
 await step('Prepare a response draft without a sending action',async()=>{await page.getByRole('button',{name:'Prepare response draft',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Your response draft'});await dialog.waitFor();assert((await dialog.getByLabel('Draft response',{exact:true}).inputValue()).length>20);assert((await dialog.getByRole('button').allTextContents()).every(label=>!/^send/i.test(label)));await dialog.getByRole('button',{name:'Close dialog',exact:true}).click();await go('interviews','Interviews & offers');assert(await page.locator('.message-card').count()===1);});
 await step('Connection checks show missing credentials and stay truthful',async()=>{await go('integrations','Platform integrations');await page.getByRole('button',{name:'Check connections',exact:true}).click();await page.getByRole('heading',{name:'Latest connection check',exact:true}).waitFor();assert((await page.locator('.connection-check-grid').textContent()).includes('Not configured'));assert(await page.locator('.connection-check').count()===4);});
 await step('Pause/resume a workflow, run the missing-connection path, and inspect its real outcome',async()=>{
   await go('logs','Automation & activity');const row=page.locator('.workflow-row').filter({has:page.getByRole('heading',{name:'Replies',exact:true})});
   if(!(await row.getByRole('checkbox',{name:'Replies enabled',exact:true}).isChecked())) {await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/workflows/replies')&&r.request().method()==='PATCH'),row.locator('.switch').click()]);await page.waitForFunction(()=>Array.from(document.querySelectorAll('.workflow-row')).find(row=>row.querySelector('h3')?.textContent==='Replies')?.querySelector('input')?.checked===true);}
   await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/workflows/replies')&&r.request().method()==='PATCH'),row.locator('.switch').click()]);
   await page.waitForFunction(()=>Array.from(document.querySelectorAll('.workflow-row')).find(row=>row.querySelector('h3')?.textContent==='Replies')?.querySelector('button')?.disabled===true);
   await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/workflows/replies')&&r.request().method()==='PATCH'),row.locator('.switch').click()]);
   await page.waitForFunction(()=>Array.from(document.querySelectorAll('.workflow-row')).find(row=>row.querySelector('h3')?.textContent==='Replies')?.querySelector('button')?.disabled===false);
   const [response]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/workflows/replies/run')),row.getByRole('button',{name:'Run now',exact:true}).click()]);
   assert.equal(response.status(),200);assert.equal((await response.json()).status,'needs_setup');
   await page.locator('.toast-error').filter({hasText:'Replies needs setup'}).waitFor();
   await page.locator('.activity-panel .badge').filter({hasText:'Needs Setup'}).first().waitFor();
   await page.locator('.activity-panel .log-summary pre').first().waitFor();
   assert.match(await page.locator('.activity-panel').textContent(),/not configured|IMAP|configure/i);
   await page.screenshot({path:`${out}/browser-workflow-result.png`,fullPage:true});
   await page.getByRole('button',{name:'Action audit',exact:true}).click();await page.getByText('Confirm External Submission',{exact:true}).waitFor();
 });
 await step('Populated jobs, applications, and replies fit a 390px viewport',async()=>{await page.setViewportSize({width:390,height:844});for(const [view,heading]of [['jobs','All opportunities'],['applications','Applications & proposals'],['messages','Client replies']]){await go(view,heading);const size=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:innerWidth}));assert(size.scroll<=size.width+1,`${view} overflow ${JSON.stringify(size)}`);await page.screenshot({path:`${out}/browser-${view}-mobile.png`,fullPage:true});}});
 await step('No browser page errors or external requests occurred',async()=>{assert.deepEqual(errors,[]);assert.deepEqual(outsideRequests,[]);assert.deepEqual(providerCalls,[]);});
  const result = {
    status: 'passed', browser: await browser.version(), steps, errors, outsideRequests, providerCalls,
    viewports: [{ width: 1440, height: 1000 }, { width: 390, height: 844 }],
    pageChecks: 22, populatedMobileChecks: 3,
  };
  await fs.writeFile(path.join(out, 'browser-results.json'), JSON.stringify(result, null, 2));
  process.stdout.write(`Browser artifacts: ${out}\n${JSON.stringify(result)}\n`);
} catch (error) {
  if (page) await page.screenshot({ path: path.join(out, 'browser-failure.png'), fullPage: true }).catch(() => {});
  const result = { status: 'failed', steps, error: error.message, errors, outsideRequests, providerCalls };
  await fs.writeFile(path.join(out, 'browser-results.json'), JSON.stringify(result, null, 2));
  process.stderr.write(`${error.stack}\nBrowser artifacts: ${out}\n`);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (server) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  if (db) await db.close();
}
