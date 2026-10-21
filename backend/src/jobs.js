import { parse } from 'csv-parse/sync';
import { normalizeJob } from './adapters/index.js';
import { uid, assert, audit, getPreferences, numbers, localDate, AppError } from './util.js';
import { filterJob } from './ai.js';
import { proposalEditSchema, confirmationSchema } from './validation.js';
export const jobColumns=`j.*, ARRAY(SELECT skill FROM job_skills WHERE job_id=j.id ORDER BY skill) AS skills`;
export function shapeJob(job) { return numbers(job,['budget_min','budget_max','score']); }
export async function getJob(db,user,id) {
  const r=await db.query(`SELECT ${jobColumns} FROM jobs j WHERE j.id=$1 AND j.user_id=$2`,[id,user]);
  assert(r.rows.length,'Job not found.',404);return shapeJob(r.rows[0]);
}
export async function importJobs(db,user,input,source='user_import') {
  let items=input.items;
  if(typeof input.csv==='string') {
    assert(input.csv.length<=1000000,'CSV exceeds the 1 MB import limit.');
    try { items=parse(input.csv,{columns:true,skip_empty_lines:true,trim:true,bom:true,max_record_size:50000}); }
    catch { throw new AppError('The CSV could not be parsed. Use the supplied example headers and quote cells containing commas.'); }
  }
  assert(Array.isArray(items)&&items.length>0&&items.length<=100,'Import between 1 and 100 opportunities at a time.');
  const normalized=items.map((item,index)=>{try{return normalizeJob(item);}catch(e){throw new AppError(`Row ${index+1}: ${e.message}`);}});
  let inserted=0,duplicates=0;const ids=[];
  await db.transaction(async tx=>{
    const enabled=(await tx.query('SELECT platform FROM platform_integrations WHERE user_id=$1 AND enabled=true',[user])).rows.map(r=>r.platform);
    for(const job of normalized) {
      assert(enabled.includes(job.platform),`Enable the ${job.platform} integration before importing its opportunities.`);
      const id=uid();
      const r=await tx.query(`INSERT INTO jobs(id,user_id,platform,external_id,title,description,url,budget_min,budget_max,currency,work_type,experience_level,client_name,posted_at,full_description,kind,source)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) ON CONFLICT DO NOTHING RETURNING id`,
        [id,user,job.platform,job.external_id,job.title,job.description,job.url,job.budget_min,job.budget_max,job.currency,job.work_type,job.experience_level,job.client_name,job.posted_at,job.full_description,job.kind,source]);
      if(!r.rows.length) { duplicates++;continue; }
      for(const skill of job.skills) await tx.query('INSERT INTO job_skills(job_id,skill) VALUES($1,$2) ON CONFLICT DO NOTHING',[id,skill]);
      inserted++;ids.push(id);
    }
    for(const platform of new Set(normalized.map(j=>j.platform))) await tx.query(`UPDATE platform_integrations SET status=CASE WHEN status='email_connected' THEN status ELSE 'import_ready' END,last_sync_at=now(),error=NULL WHERE user_id=$1 AND platform=$2`,[user,platform]);
    await audit(tx,user,'import_jobs','job',null,{inserted,duplicates,source});
  });
  return {inserted,duplicates,ids};
}
export async function editJob(db,user,id,input) {
  const allowed=['description','budget_min','budget_max','currency','work_type','experience_level','full_description','skills'];
  assert(input&&typeof input==='object'&&Object.keys(input).every(k=>allowed.includes(k)),'Only job details can be edited.');
  return db.transaction(async tx=>{
    const app=(await tx.query('SELECT status FROM applications WHERE job_id=$1 AND user_id=$2 FOR UPDATE',[id,user])).rows[0];
    const original=await getJob(tx,user,id);
    assert(!app||['draft','awaiting_submission'].includes(app.status),'Submitted job details are locked to preserve the application record.',409);
    const job=normalizeJob({...original,...input});
    await tx.query('UPDATE jobs SET description=$1,budget_min=$2,budget_max=$3,currency=$4,work_type=$5,experience_level=$6,full_description=$7,score=NULL,score_source=NULL,score_reason=NULL,status=$8,updated_at=now(),revision=revision+1,score_attempts=0,next_score_at=now() WHERE id=$9 AND user_id=$10',
      [job.description,job.budget_min,job.budget_max,job.currency,job.work_type,job.experience_level,job.full_description,'new',id,user]);
    await tx.query('DELETE FROM job_skills WHERE job_id=$1',[id]);
    for(const skill of job.skills) await tx.query('INSERT INTO job_skills(job_id,skill) VALUES($1,$2) ON CONFLICT DO NOTHING',[id,skill]);
    await tx.query('UPDATE proposals SET review_required=true,reviewed_at=NULL WHERE job_id=$1 AND user_id=$2',[id,user]);
    await tx.query(`UPDATE applications SET status='draft',updated_at=now() WHERE job_id=$1 AND user_id=$2 AND status='awaiting_submission'`,[id,user]);
    await audit(tx,user,'edit_job','job',id);return getJob(tx,user,id);
  });
}
export async function scoreJob(db,user,id,ai) {
  const job=await getJob(db,user,id),prefs=await getPreferences(db,user),filter=filterJob(job,prefs);
  const result=await ai.score(user,job,prefs);
  const status=!job.full_description?'needs_details':!filter.eligible?'filtered':result.score>=prefs.min_score?'shortlisted':'filtered';
  const reason=[result.reason,...filter.reasons].filter(Boolean).join(' ').slice(0,5000);
  const r=await db.query('UPDATE jobs SET score=$1,score_source=$2,score_reason=$3,status=$4,score_attempts=0 WHERE id=$5 AND user_id=$6 AND revision=$7 RETURNING id',[result.score,result.source,reason,status,id,user,job.revision]);
  assert(r.rows.length,'The job changed during scoring. Score it again.',409,'JOB_CHANGED');
  return getJob(db,user,id);
}
export async function generateProposal(db,user,id,ai,templateId=null) {
  const existing=(await db.query('SELECT * FROM proposals WHERE job_id=$1 AND user_id=$2',[id,user])).rows[0];
  if(existing) return numbers(existing,['suggested_price','delivery_days']);
  const job=await getJob(db,user,id),prefs=await getPreferences(db,user);
  const enabled=(await db.query('SELECT enabled FROM platform_integrations WHERE user_id=$1 AND platform=$2',[user,job.platform])).rows[0];
  assert(enabled?.enabled,'This platform integration is paused.',409,'INTEGRATION_PAUSED');
  assert(job.platform!=='fiverr'&&job.kind==='job','Fiverr inquiries use response drafts in Client Replies; they are not job applications.',409,'INQUIRY_ONLY');
  const filter=filterJob(job,prefs);assert(filter.eligible,filter.reasons.join(' '),409,'JOB_INELIGIBLE');
  if(job.score==null) await scoreJob(db,user,id,ai);
  const scored=await getJob(db,user,id);assert(scored.score>=prefs.min_score,'The relevance score is below your minimum.',409,'SCORE_TOO_LOW');
  let template=null;
  if(templateId) {template=(await db.query('SELECT * FROM proposal_templates WHERE id=$1 AND user_id=$2',[templateId,user])).rows[0];assert(template,'Template not found.',404);}
  const token=uid();
  const claim=await db.query(`UPDATE jobs SET generation_lock_until=now()+interval '5 minutes',generation_lock_token=$1 WHERE id=$2 AND user_id=$3 AND (generation_lock_until IS NULL OR generation_lock_until<now()) RETURNING id`,[token,id,user]);
  assert(claim.rows.length,'A proposal is already being prepared for this job. Refresh shortly.',409,'GENERATION_RUNNING');
  try {
    const proposal=await ai.proposal(user,scored,prefs,template);
    return await db.transaction(async tx=>{
      const current=(await tx.query('SELECT revision,generation_lock_token FROM jobs WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,user])).rows[0];
      assert(current.revision===scored.revision&&current.generation_lock_token===token,'Job details changed during generation; review the updated job and retry.',409,'JOB_CHANGED');
      const proposalId=uid();
      const r=await tx.query(`INSERT INTO proposals(id,user_id,job_id,body,suggested_price,currency,delivery_days,generator) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(job_id) DO NOTHING RETURNING *`,[proposalId,user,id,proposal.body,proposal.suggested_price,proposal.currency,proposal.delivery_days,proposal.generator]);
      if(!r.rows.length) return numbers((await tx.query('SELECT * FROM proposals WHERE job_id=$1 AND user_id=$2',[id,user])).rows[0],['suggested_price','delivery_days']);
      await tx.query('INSERT INTO applications(id,user_id,job_id,proposal_id) VALUES($1,$2,$3,$4)',[uid(),user,id,proposalId]);
      await audit(tx,user,'generate_proposal','proposal',proposalId,{generator:proposal.generator});
      return numbers(r.rows[0],['suggested_price','delivery_days']);
    });
  } finally { await db.query('UPDATE jobs SET generation_lock_until=NULL,generation_lock_token=NULL WHERE id=$1 AND user_id=$2 AND generation_lock_token=$3',[id,user,token]); }
}
export async function editProposal(db,user,id,input) {
  const data=proposalEditSchema.parse(input);
  return db.transaction(async tx=>{
    const app=(await tx.query('SELECT id,status FROM applications WHERE proposal_id=$1 AND user_id=$2 FOR UPDATE',[id,user])).rows[0];
    assert(app,'Proposal not found.',404);assert(['draft','awaiting_submission'].includes(app.status),'A submitted proposal is kept as an immutable application record.',409);
    const r=await tx.query('UPDATE proposals SET body=$1,suggested_price=$2,delivery_days=$3,review_required=true,reviewed_at=NULL,updated_at=now() WHERE id=$4 AND user_id=$5 RETURNING *',[data.body,data.suggested_price,data.delivery_days,id,user]);
    await tx.query(`UPDATE applications SET status='draft',updated_at=now() WHERE id=$1`,[app.id]);
    await audit(tx,user,'edit_proposal','proposal',id);return numbers(r.rows[0],['suggested_price','delivery_days']);
  });
}
export async function markReady(db,user,id) {
  return db.transaction(async tx=>{
    const app=(await tx.query('SELECT * FROM applications WHERE proposal_id=$1 AND user_id=$2 FOR UPDATE',[id,user])).rows[0];
    assert(app,'Application not found.',404);assert(['draft','awaiting_submission'].includes(app.status),'This application has already progressed beyond review.',409);
    const job=await getJob(tx,user,app.job_id),prefs=await getPreferences(tx,user);
    const filter=filterJob(job,prefs);assert(filter.eligible,filter.reasons.join(' '),409);
    assert(job.score!=null&&job.score>=prefs.min_score,'Score the job again before marking this proposal ready.',409);
    assert(prefs.max_daily_applications>0,'Applications are paused by your daily limit.',409,'APPLICATION_LIMIT');
    await tx.query('INSERT INTO daily_usage(user_id,local_date) VALUES($1,$2) ON CONFLICT DO NOTHING',[user,localDate()]);
    const usage=(await tx.query('SELECT application_count FROM daily_usage WHERE user_id=$1 AND local_date=$2 FOR UPDATE',[user,localDate()])).rows[0];
    const queued=Number((await tx.query(`SELECT count(*) AS n FROM applications WHERE user_id=$1 AND status='awaiting_submission' AND id<>$2`,[user,app.id])).rows[0].n);
    assert(usage.application_count+queued<prefs.max_daily_applications,'Your daily application limit is reached, including ready proposals.',409,'APPLICATION_LIMIT');
    await tx.query('UPDATE proposals SET review_required=false,reviewed_at=now() WHERE id=$1 AND user_id=$2',[id,user]);
    await tx.query(`UPDATE applications SET status='awaiting_submission',updated_at=now() WHERE id=$1`,[app.id]);
    await audit(tx,user,'review_proposal','application',app.id);return {id:app.id,status:'awaiting_submission'};
  });
}
export async function confirmManualSubmission(db,user,id,input) {
  const data=confirmationSchema.parse(input),date=data.submitted_at?new Date(data.submitted_at):new Date();
  assert(date.getTime()<=Date.now()+60000,'Submission time cannot be in the future.');
  return db.transaction(async tx=>{
    const app=(await tx.query('SELECT a.*,p.review_required FROM applications a JOIN proposals p ON p.id=a.proposal_id WHERE a.id=$1 AND a.user_id=$2 FOR UPDATE OF a',[id,user])).rows[0];
    assert(app,'Application not found.',404);
    if(app.submitted_at) return {id,status:app.status,duplicate:true};
    assert(app.status==='awaiting_submission'&&!app.review_required,'Review and mark the proposal ready before confirming an external submission.',409,'REVIEW_REQUIRED');
    const prefs=await getPreferences(tx,user),day=localDate(date,prefs.timezone);
    await tx.query('INSERT INTO daily_usage(user_id,local_date) VALUES($1,$2) ON CONFLICT DO NOTHING',[user,day]);
    const usage=(await tx.query('SELECT * FROM daily_usage WHERE user_id=$1 AND local_date=$2 FOR UPDATE',[user,day])).rows[0];
    assert(usage.application_count<prefs.max_daily_applications,'The configured daily application limit has been reached.',409,'APPLICATION_LIMIT');
    assert(Number(usage.spend_amount)+data.spend_amount<=prefs.max_daily_spend,'The reported spend exceeds your configured daily limit. Review your settings before recording it.',409,'SPEND_LIMIT');
    await tx.query(`UPDATE applications SET status='submitted',submitted_at=$1,confirmation=$2,method='manual_confirmation',spend_amount=$3,updated_at=now() WHERE id=$4 AND user_id=$5`,[date.toISOString(),data.confirmation,data.spend_amount,id,user]);
    await tx.query('UPDATE daily_usage SET application_count=application_count+1,spend_amount=spend_amount+$1 WHERE user_id=$2 AND local_date=$3',[data.spend_amount,user,day]);
    await audit(tx,user,'confirm_external_submission','application',id,{method:'manual_confirmation',spend_amount:data.spend_amount,currency:prefs.currency});
    return {id,status:'submitted',method:'manual_confirmation'};
  });
}
export async function blockAutomaticSubmission(db,user,id) {
  const app=(await db.query('SELECT id FROM applications WHERE id=$1 AND user_id=$2',[id,user])).rows[0];assert(app,'Application not found.',404);
  await audit(db,user,'automatic_submission_blocked','application',id,{reason:'No verified, account-authorized submission adapter is enabled in this build.'});
  throw new AppError('Automatic submission is unavailable in this build. Use the reviewed proposal and original job link. Upwork API/MCP access requires separate verified approval and an implemented account-authorized adapter.',409,'MANUAL_SUBMISSION_REQUIRED');
}
