import {timingSafeEqual} from 'node:crypto';
import {createDb} from '../../backend/src/db.js';
import {loadConfig,WORKFLOWS} from '../../backend/src/config.js';
import {createApplication} from '../../backend/src/app.js';
import {assert,audit,AppError} from '../../backend/src/util.js';
export const env = name => globalThis.Netlify?.env?.get(name) ?? process.env[name];
export function authorized(request,token) {
  if(!token || token.length<32)return false;
  const actual=Buffer.from(request.headers.get('authorization')||'');
  const expected=Buffer.from(`Bearer ${token}`);
  return actual.length===expected.length && timingSafeEqual(actual,expected);
}
export function runtimeConfig() {
  const missing=['DATABASE_URL','ADMIN_EMAIL','WORKFLOW_TOKEN','APP_ORIGIN'].filter(key=>!env(key));
  if(missing.length)throw new AppError(`Deployment setup is incomplete. Configure ${missing.join(', ')} in Netlify, initialize the database, then redeploy.`,503,'SETUP_REQUIRED');
  const settings=new Proxy({}, {get:(_,key)=>env(key)});
  return {...loadConfig(settings),secureCookie:env('COOKIE_SECURE')==='true',trustProxy:false};
}
let instance;
export async function getRuntime() {
  if(!instance)instance=(async()=>{
    const config=runtimeConfig(),db=createDb(config.databaseUrl,{max:2});
    const dispatchWorkflow=async({name,key,user,retryId})=>{
      assert(typeof key==='string'&&key.length>=1&&key.length<=180,'Invalid idempotency key.');
      if(retryId){
        const run=(await db.query('SELECT workflow,status,retryable FROM workflow_runs WHERE id=$1 AND user_id=$2',[retryId,user])).rows[0];
        assert(run&&run.retryable&&['failed','needs_setup'].includes(run.status),'This run is not eligible for retry.',409);
        name=run.workflow;
      }
      assert(WORKFLOWS.includes(name),'Unknown workflow.',404);
      const control=(await db.query('SELECT enabled FROM workflow_controls WHERE user_id=$1 AND name=$2',[user,name])).rows[0];
      assert(control,'Workflow not found.',404);
      if(!control.enabled)return {workflow:name,status:'skipped',summary:{reason:'Workflow paused.'}};
      const response=await fetch(new URL('/.netlify/functions/workflow-worker',config.origin),{
        method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${config.workflowToken}`},
        body:JSON.stringify({name,key,retryId}),signal:AbortSignal.timeout(10000),redirect:'error'
      });
      assert(response.status===202,'The background worker did not accept this run. Check the Netlify Functions deployment.',503,'WORKER_UNAVAILABLE');
      await audit(db,user,'workflow_dispatch','workflow',name,{key});
      return {workflow:name,status:'queued',summary:{reason:'Accepted for background execution. Refresh Automation Logs for the actual result.'}};
    };
    try {return {...await createApplication({db,config,initialize:false,dependencies:{dispatchWorkflow}}),db,config};}
    catch(error){await db.close();throw error;}
  })().catch(error=>{instance=undefined;throw error;});
  return instance;
}
export function failure(error) {
  // No connection strings, credentials or raw database errors reach the browser.
  console.error('Function error:',error.code||error.name);
  return Response.json({error:error instanceof AppError?error.message:'The service could not connect. Check database configuration and run npm run setup:netlify.',code:error instanceof AppError?error.code:'SERVICE_UNAVAILABLE'},
    {status:error instanceof AppError?error.status:503,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}
