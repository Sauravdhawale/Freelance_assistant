import {getRuntime,env,authorized} from '../lib/runtime.mjs';
import {WORKFLOWS} from '../../backend/src/config.js';
export default async request => {
  // Background functions acknowledge before execution; authorization still gates all work.
  if(request.method!=='POST'||!authorized(request,env('WORKFLOW_TOKEN')))return;
  const payload=await request.json();
  if(!WORKFLOWS.includes(payload.name)||typeof payload.key!=='string'||payload.key.length>180||!payload.key.length)return;
  const {workflows,owner}=await getRuntime();
  if(payload.retryId)await workflows.retry(owner.id,payload.retryId);
  else await workflows.run(owner.id,payload.name,payload.key);
};
export const config={background:true};
