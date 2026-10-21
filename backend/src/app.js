import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { PostgresRateLimitStore } from './rate-limit-store.js';
import { ZodError } from 'zod';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { migrate } from './db.js';
import { bootstrap, authMiddleware, originGuard, internalAuth, login, logout } from './auth.js';
import { uid, assert, audit, AppError, getPreferences, cleanError, numbers, requestJson } from './util.js';
import { PLATFORMS, WORKFLOWS } from './config.js';
import { AiService } from './ai.js';
import { NotificationService, queueNotification } from './notifications.js';
import { importJobs, getJob, editJob, scoreJob, generateProposal, editProposal, markReady, confirmManualSubmission, blockAutomaticSubmission, jobColumns, shapeJob } from './jobs.js';
import { importMessages, listMessages, draftReply } from './messages.js';
import { integrations, overview, workflowStates } from './reporting.js';
import { preferencesSchema, templateSchema, gigSchema } from './validation.js';
import { WorkflowService } from './workflows.js';

export async function createApplication({db,config,dependencies={},initialize=true}) {
  if(initialize) await migrate(db);
  const owner=initialize ? await bootstrap(db,config) : (await db.query('SELECT id,email,name FROM users WHERE email=$1',[config.adminEmail?.trim().toLowerCase()])).rows[0];
  assert(owner,'Run npm run setup:netlify before using this deployment.',503,'SETUP_REQUIRED');
  const ai=new AiService(db,config,dependencies.fetcher);
  const notifications=new NotificationService(db,config,dependencies);
  const workflows=new WorkflowService(db,config,ai,notifications,owner.id);
  const app=express();app.disable('x-powered-by');app.set('trust proxy',config.trustProxy||false);
  app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'","'unsafe-inline'"],imgSrc:["'self'",'data:'],connectSrc:["'self'"],fontSrc:["'self'"],objectSrc:["'none'"],frameAncestors:["'none'"],upgradeInsecureRequests:config.secureCookie?[]:null}}}));
  app.use(express.json({limit:'1mb',strict:true}));
  app.get('/api/health',async(req,res)=>{try{await db.query('SELECT 1');res.json({ok:true});}catch{res.status(503).json({ok:false,error:'Database unavailable.'});}});
  app.use('/api',(req,res,next)=>{res.set('Cache-Control','no-store');next();});
  const loginLimiter=rateLimit({store:new PostgresRateLimitStore(db,'login'),windowMs:15*60*1000,limit:10,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Too many login attempts. Try again in 15 minutes.'}});
  app.post('/api/auth/login',originGuard(config),loginLimiter,(req,res)=>login(db,config,req,res));
  const api=express.Router();
  api.use(originGuard(config),authMiddleware(db));
  api.use(rateLimit({store:new PostgresRateLimitStore(db,'api'),windowMs:60*1000,limit:180,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Request limit reached. Please wait a minute.'}}));
  api.get('/auth/me',(req,res)=>res.json({user:req.user,csrfToken:req.csrfToken}));
  api.post('/auth/logout',(req,res)=>logout(db,config,req,res));
  api.get('/overview',async(req,res)=>res.json(await overview(db,req.user.id)));
  api.get('/jobs',async(req,res)=>{
    const params=[req.user.id],where=['j.user_id=$1'];let page=Number(req.query.page||1);
    assert(Number.isInteger(page)&&page>=1&&page<=100000,'Invalid page number.');const pageSize=25;
    if(req.query.platform){assert(PLATFORMS.includes(req.query.platform),'Invalid platform.');params.push(req.query.platform);where.push(`j.platform=$${params.length}`);}
    if(req.query.q){assert(typeof req.query.q==='string'&&req.query.q.length<=200,'Search text is too long.');params.push(`%${req.query.q.replace(/[\\%_]/g,'\\$&')}%`);where.push(`(j.title ILIKE $${params.length} OR j.description ILIKE $${params.length})`);}
    if(req.query.recommended==='true')where.push("j.status='shortlisted' AND j.kind='job'");
    const count=(await db.query(`SELECT count(*) AS n FROM jobs j WHERE ${where.join(' AND ')}`,params)).rows[0];
    const queryParams=[...params,pageSize,(page-1)*pageSize];
    const r=await db.query(`SELECT ${jobColumns} FROM jobs j WHERE ${where.join(' AND ')} ORDER BY j.score DESC NULLS LAST,j.posted_at DESC NULLS LAST,j.created_at DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`,queryParams);
    res.json({items:r.rows.map(shapeJob),total:Number(count.n),page,pageSize});
  });
  api.get('/jobs/:id',async(req,res)=>res.json(await getJob(db,req.user.id,req.params.id)));
  api.patch('/jobs/:id',async(req,res)=>res.json(await editJob(db,req.user.id,req.params.id,req.body)));
  api.post('/import/jobs',async(req,res)=>res.json(await importJobs(db,req.user.id,req.body)));
  api.post('/jobs/:id/score',async(req,res)=>res.json(await scoreJob(db,req.user.id,req.params.id,ai)));
  api.post('/jobs/:id/proposal',async(req,res)=>res.json({proposal:await generateProposal(db,req.user.id,req.params.id,ai,req.body?.template_id)}));
  api.get('/proposals',async(req,res)=>{
    const r=await db.query('SELECT p.*,j.title AS job_title,j.platform,j.url AS job_url FROM proposals p JOIN jobs j ON j.id=p.job_id WHERE p.user_id=$1 ORDER BY p.created_at DESC LIMIT 200',[req.user.id]);
    res.json({items:r.rows.map(p=>numbers(p,['suggested_price','delivery_days']))});
  });
  api.patch('/proposals/:id',async(req,res)=>res.json({proposal:await editProposal(db,req.user.id,req.params.id,req.body)}));
  api.post('/proposals/:id/ready',async(req,res)=>res.json(await markReady(db,req.user.id,req.params.id)));
  api.get('/applications',async(req,res)=>{
    const r=await db.query(`SELECT a.*,j.title AS job_title,j.platform,j.url AS job_url,row_to_json(p) AS proposal FROM applications a JOIN jobs j ON j.id=a.job_id JOIN proposals p ON p.id=a.proposal_id WHERE a.user_id=$1 ORDER BY a.created_at DESC LIMIT 200`,[req.user.id]);
    res.json({items:r.rows.map(a=>({...numbers(a,['spend_amount']),proposal:numbers(a.proposal,['suggested_price','delivery_days'])}))});
  });
  api.post('/applications/:id/confirm',async(req,res)=>res.json(await confirmManualSubmission(db,req.user.id,req.params.id,req.body)));
  api.post('/applications/:id/submit',async(req,res)=>res.json(await blockAutomaticSubmission(db,req.user.id,req.params.id)));
  api.get('/messages',async(req,res)=>res.json({items:await listMessages(db,req.user.id)}));
  api.post('/import/messages',async(req,res)=>{const result=await importMessages(db,req.user.id,req.body,ai);const delivery=await notifications.drain(req.user.id);res.json({...result,delivery});});
  api.post('/messages/:id/draft',async(req,res)=>res.json(await draftReply(db,req.user.id,req.params.id,ai)));
  // There is deliberately no route that sends a client reply.
  api.get('/preferences',async(req,res)=>res.json(await getPreferences(db,req.user.id)));
  api.patch('/preferences',async(req,res)=>{
    const changes=preferencesSchema.parse(req.body),previous=await getPreferences(db,req.user.id),next={...previous,...changes};
    assert(!next.notify_email||next.notification_email,'Add your notification email before enabling email alerts.');
    assert(!next.notify_telegram||next.telegram_chat_id,'Add your Telegram chat ID before enabling mobile alerts.');
    await db.transaction(async tx=>{
      await tx.query('UPDATE user_preferences SET config=$1,updated_at=now() WHERE user_id=$2',[JSON.stringify(next),req.user.id]);
      const matching=['skills','min_budget','min_hourly_rate','currency','allow_unknown_budget','work_types','experience_levels','min_score','max_job_age_days','ai_enabled'];
      if(Object.keys(changes).some(k=>matching.includes(k))) {
        await tx.query(`UPDATE jobs SET score=NULL,score_source=NULL,status='new',score_reason=NULL,score_attempts=0,next_score_at=now(),updated_at=now(),revision=revision+1 WHERE user_id=$1 AND id NOT IN (SELECT job_id FROM applications WHERE user_id=$1 AND submitted_at IS NOT NULL)`,[req.user.id]);
        await tx.query(`UPDATE proposals SET review_required=true,reviewed_at=NULL WHERE user_id=$1 AND job_id IN (SELECT job_id FROM applications WHERE user_id=$1 AND submitted_at IS NULL)`,[req.user.id]);
        await tx.query(`UPDATE applications SET status='draft' WHERE user_id=$1 AND status='awaiting_submission'`,[req.user.id]);
      }
      await audit(tx,req.user.id,'update_preferences','user',req.user.id,{fields:Object.keys(changes)});
    });res.json(next);
  });
  api.get('/integrations',async(req,res)=>res.json({items:await integrations(db,req.user.id)}));
  api.patch('/integrations/:platform',async(req,res)=>{
    assert(PLATFORMS.includes(req.params.platform)&&typeof req.body?.enabled==='boolean','Choose a valid platform and enabled state.');
    await db.query('UPDATE platform_integrations SET enabled=$1 WHERE user_id=$2 AND platform=$3',[req.body.enabled,req.user.id,req.params.platform]);
    await audit(db,req.user.id,'toggle_integration','integration',req.params.platform,{enabled:req.body.enabled});res.json({items:await integrations(db,req.user.id)});
  });
  api.post('/integrations/check',async(req,res)=>{
    const prefs=await getPreferences(db,req.user.id),checks=await notifications.check(prefs);
    checks.openai={configured:!!config.openaiKey,tested:false,model:config.openaiModel};
    if(config.openaiKey){try{await requestJson(`https://api.openai.com/v1/models/${encodeURIComponent(config.openaiModel)}`,{headers:{Authorization:`Bearer ${config.openaiKey}`}},dependencies.fetcher);checks.openai={...checks.openai,tested:true,connected:true};}catch{checks.openai={...checks.openai,tested:true,connected:false,error:'OpenAI model access check failed.'};}}
    const mailbox=(await db.query('SELECT last_checked_at,error FROM mailbox_state WHERE user_id=$1',[req.user.id])).rows[0];
    checks.imap={configured:!!(config.imap.host&&config.imap.user&&config.imap.pass&&config.imap.allowedSenders.length),last_checked_at:mailbox?.last_checked_at||null,error:mailbox?.error||null};
    res.json({items:await integrations(db,req.user.id),checks});
  });
  api.get('/workflows',async(req,res)=>res.json({items:await workflowStates(db,req.user.id)}));
  api.patch('/workflows/:name',async(req,res)=>{
    assert(WORKFLOWS.includes(req.params.name)&&typeof req.body?.enabled==='boolean','Choose a valid workflow and enabled state.');
    await db.query('UPDATE workflow_controls SET enabled=$1 WHERE user_id=$2 AND name=$3',[req.body.enabled,req.user.id,req.params.name]);
    await audit(db,req.user.id,'toggle_workflow','workflow',req.params.name,{enabled:req.body.enabled});res.json({items:await workflowStates(db,req.user.id)});
  });
  api.post('/workflows/:name/run',async(req,res)=>res.json(await (dependencies.dispatchWorkflow ? dependencies.dispatchWorkflow({name:req.params.name,key:req.headers['x-idempotency-key']||uid(),user:req.user.id}) : workflows.run(req.user.id,req.params.name,req.headers['x-idempotency-key']||uid()))));
  api.get('/logs',async(req,res)=>{
    const [runs,notes,events,audits]=await Promise.all([
      db.query('SELECT id,workflow,status,started_at,finished_at,summary,error,retryable FROM workflow_runs WHERE user_id=$1 ORDER BY started_at DESC LIMIT 150',[req.user.id]),
      db.query('SELECT id,channel,status,attempts,last_error,sent_at,created_at FROM notification_logs WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100',[req.user.id]),
      db.query(`SELECT id,platform,kind,status,error,attempts FROM email_events WHERE user_id=$1 AND status='failed' ORDER BY created_at DESC LIMIT 30`,[req.user.id]),
      db.query('SELECT id,action,entity_type,entity_id,details,created_at FROM audit_log WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100',[req.user.id])
    ]);res.json({items:runs.rows,notifications:notes.rows,import_errors:events.rows,audit:audits.rows});
  });
  api.post('/logs/:id/retry',async(req,res)=>res.json(await (dependencies.dispatchWorkflow ? dependencies.dispatchWorkflow({retryId:req.params.id,key:uid(),user:req.user.id}) : workflows.retry(req.user.id,req.params.id))));
  api.get('/templates',async(req,res)=>res.json({items:(await db.query('SELECT * FROM proposal_templates WHERE user_id=$1 ORDER BY created_at DESC',[req.user.id])).rows}));
  api.post('/templates',async(req,res)=>{
    const data=templateSchema.parse(req.body),id=uid();await db.query('INSERT INTO proposal_templates(id,user_id,name,body) VALUES($1,$2,$3,$4)',[id,req.user.id,data.name,data.body]);res.status(201).json({id,...data});
  });
  api.patch('/templates/:id',async(req,res)=>{
    const data=templateSchema.parse(req.body);const r=await db.query('UPDATE proposal_templates SET name=$1,body=$2 WHERE id=$3 AND user_id=$4 RETURNING *',[data.name,data.body,req.params.id,req.user.id]);assert(r.rows.length,'Template not found.',404);res.json(r.rows[0]);
  });
  api.post('/gigs/optimize',async(req,res)=>{const data=gigSchema.parse(req.body),prefs=await getPreferences(db,req.user.id);res.json(await ai.gig(req.user.id,data,prefs));});
  api.post('/notifications/test',async(req,res)=>{
    assert(['email','telegram'].includes(req.body?.channel),'Choose email or telegram.');const prefs=await getPreferences(db,req.user.id);
    await queueNotification(db,req.user.id,`test:${uid()}`,{subject:'[Freelance Alert] Integration test',email_text:'This is a test from your Freelance Assistant. No client message or application is represented.',telegram_text:'Freelance Assistant test notification. No client message or application is represented.'},prefs,req.body.channel);
    const delivery=await notifications.drain(req.user.id);res.json({delivery});
  });
  app.use('/api',api);
  app.post('/internal/workflows/:name/run',internalAuth(config),async(req,res)=>res.json(await (dependencies.dispatchWorkflow ? dependencies.dispatchWorkflow({name:req.params.name,key:req.headers['x-idempotency-key']||uid(),user:owner.id}) : workflows.run(owner.id,req.params.name,req.headers['x-idempotency-key']||uid()))));
  app.use(['/api','/internal'],(req,res)=>res.status(404).json({error:'Endpoint not found.'}));
  const webRoot=fileURLToPath(new URL('../../frontend/dist/',import.meta.url));
  if(existsSync(`${webRoot}/index.html`)) {app.use(express.static(webRoot));app.get(/.*/, (req,res)=>res.sendFile(`${webRoot}/index.html`));}
  app.use((error,req,res,next)=>{
    if(res.headersSent)return next(error);
    if(error instanceof ZodError)return res.status(400).json({error:error.issues.map(i=>`${i.path.join('.')||'Input'}: ${i.message}`).join('; ').slice(0,1200),code:'VALIDATION'});
    if(error.type==='entity.too.large')return res.status(413).json({error:'Import or request exceeds the 1 MB limit.',code:'TOO_LARGE'});
    if(error instanceof SyntaxError&&'body' in error)return res.status(400).json({error:'Invalid JSON request body.',code:'VALIDATION'});
    if(!(error instanceof AppError)) process.stderr.write(`Application error: ${error.code||error.name||'UnknownError'}\n`);
    res.status(error.status||500).json({error:cleanError(error),code:error instanceof AppError?error.code:'INTERNAL_ERROR'});
  });
  return {app,owner,ai,notifications,workflows};
}
