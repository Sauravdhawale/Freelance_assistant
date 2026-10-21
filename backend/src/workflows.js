import { WORKFLOWS } from './config.js';
import { uid, assert, getPreferences, audit, nextAttempt, cleanError, AppError } from './util.js';
import { importJobs, scoreJob, generateProposal } from './jobs.js';
import { importMessages } from './messages.js';
import { queueNotification } from './notifications.js';
import { dailyReport } from './reporting.js';
import { pollMailbox } from './mailbox.js';
import { platformForHostname } from './adapters/index.js';
export class WorkflowService {
  constructor(db,config,ai,notifications,ownerId) {Object.assign(this,{db,config,ai,notifications,ownerId});}
  async intake(user) {
    // Discovery and replies can independently poll without racing the shared IMAP UID checkpoint.
    await this.db.query('INSERT INTO mailbox_state(user_id) VALUES($1) ON CONFLICT DO NOTHING',[user]);
    const token=uid();
    const claim=await this.db.query(`UPDATE mailbox_state SET poll_lock_until=now()+interval '5 minutes',poll_lock_token=$2 WHERE user_id=$1 AND (poll_lock_until IS NULL OR poll_lock_until<now()) RETURNING user_id`,[user,token]);
    if(!claim.rows.length)return {connected:null,busy:true,queued:0,reason:'Another workflow is polling the shared mailbox.'};
    try {
      const mailbox=await pollMailbox(this.db,user,this.config);
      for(const platform of new Set((this.config.imap.allowedSenders||[]).map(s=>platformForHostname(s.split('@')[1])).filter(Boolean))) {
        if(mailbox.connected)await this.db.query("UPDATE platform_integrations SET status='email_connected',last_sync_at=now(),error=NULL WHERE user_id=$1 AND platform=$2 AND enabled=true",[user,platform]);
        else await this.db.query("UPDATE platform_integrations SET status='error',error=$1 WHERE user_id=$2 AND platform=$3 AND enabled=true",[mailbox.error||'Email monitoring needs setup.',user,platform]);
      }
      return mailbox;
    } finally {await this.db.query('UPDATE mailbox_state SET poll_lock_until=NULL,poll_lock_token=NULL WHERE user_id=$1 AND poll_lock_token=$2',[user,token]);}
  }
  async consume(user,kind) {
    const events=(await this.db.query(`SELECT * FROM email_events WHERE user_id=$1 AND kind=$2 AND status IN ('pending','failed') AND attempts<5 AND next_attempt_at<=now() ORDER BY created_at LIMIT 5`,[user,kind])).rows;
    const counts={processed:0,inserted:0,duplicates:0,failed:0};
    for(const event of events) {
      try {
        const input={items:Array.isArray(event.payload)?event.payload:event.payload.items};
        const result=kind==='job'?await importJobs(this.db,user,input,'email'):await importMessages(this.db,user,input,this.ai);
        await this.db.query(`UPDATE email_events SET status='processed',payload='{}',error=NULL WHERE id=$1`,[event.id]);
        counts.processed++;counts.inserted+=result.inserted;counts.duplicates+=result.duplicates;
      } catch(e) {
        await this.db.query(`UPDATE email_events SET status='failed',attempts=attempts+1,error=$1,next_attempt_at=$2 WHERE id=$3`,[cleanError(e),nextAttempt(event.attempts+1),event.id]);counts.failed++;
      }
    }
    return counts;
  }
  async perform(user,name) {
    const prefs=await getPreferences(this.db,user);
    switch(name) {
      case 'discovery': {
        const mailbox=await this.intake(user);
        const events=await this.consume(user,'job');let scored=0,failed=0;
        const jobs=(await this.db.query(`SELECT j.id FROM jobs j JOIN platform_integrations p ON p.user_id=j.user_id AND p.platform=j.platform WHERE j.user_id=$1 AND p.enabled=true AND j.score IS NULL AND j.score_attempts<5 AND j.next_score_at<=now() AND j.kind='job' ORDER BY j.created_at DESC LIMIT 5`,[user])).rows;
        for(const {id} of jobs) {
          try {
            const job=await scoreJob(this.db,user,id,this.ai);scored++;
            if(job.status==='shortlisted') await queueNotification(this.db,user,`match:${id}`,{subject:`[Freelance Match] ${job.platform} — ${job.title}`,email_text:`New relevant opportunity\nPlatform: ${job.platform}\nJob: ${job.title}\nScore: ${job.score}/100 (${job.score_source})\n${job.score_reason}\nOriginal listing: ${job.url}\nReview the full scope before preparing an application.`,telegram_text:`New freelance match\nPlatform: ${job.platform}\nJob: ${job.title}\nScore: ${job.score}/100 (${job.score_source})\n${job.url}`},prefs);
          } catch(e) {const current=(await this.db.query('SELECT score_attempts FROM jobs WHERE id=$1',[id])).rows[0];await this.db.query('UPDATE jobs SET score_attempts=score_attempts+1,next_score_at=$1,score_reason=$2 WHERE id=$3',[nextAttempt(current.score_attempts+1),cleanError(e),id]);failed++;}
        }
        return {...events,mailbox,scored,score_failures:failed,needs_setup:!!this.config.imap.host&&mailbox.connected===false,source:'Authorized imports and verified notification emails'};
      }
      case 'proposals': {
        if(!prefs.auto_generate_proposals)return {skipped:true,reason:'Automatic draft generation is disabled in preferences.'};
        const jobs=(await this.db.query(`SELECT j.id FROM jobs j JOIN platform_integrations i ON i.user_id=j.user_id AND i.platform=j.platform LEFT JOIN proposals p ON p.job_id=j.id WHERE j.user_id=$1 AND i.enabled=true AND j.status='shortlisted' AND j.kind='job' AND j.platform<>'fiverr' AND p.id IS NULL ORDER BY j.score DESC LIMIT 5`,[user])).rows;
        let generated=0,failed=0;const errors=[];
        for(const {id} of jobs) {try{await generateProposal(this.db,user,id,this.ai);generated++;}catch(e){failed++;errors.push(cleanError(e));}}
        return {generated,failed,errors,submitted:0};
      }
      case 'replies': {
        const mailbox=await this.intake(user);
        const events=await this.consume(user,'reply');
        const delivery=await this.notifications.drain(user);
        return {mailbox,...events,delivery,needs_setup:mailbox.connected===false};
      }
      case 'notifications': return this.notifications.drain(user);
      case 'daily_report': {const report=await dailyReport(this.db,user);const delivery=await this.notifications.drain(user);return {...report,delivery,needs_setup:!report.email_enabled||delivery.disconnected>0};}
      case 'retention': {
        const cutoff=new Date(Date.now()-prefs.retention_days*86400000).toISOString();
        return this.db.transaction(async tx=>{
          const messages=await tx.query('DELETE FROM client_messages WHERE user_id=$1 AND received_at<$2 RETURNING id',[user,cutoff]);
          const notifications=await tx.query('DELETE FROM notification_logs WHERE user_id=$1 AND created_at<$2 RETURNING id',[user,cutoff]);
          const events=await tx.query('DELETE FROM email_events WHERE user_id=$1 AND created_at<$2 RETURNING id',[user,cutoff]);
          await tx.query('DELETE FROM sessions WHERE expires_at<now()');
          await tx.query('DELETE FROM request_limits WHERE reset_at<now()');
          await tx.query(`DELETE FROM workflow_runs WHERE user_id=$1 AND started_at<$2 AND status<>'running'`,[user,cutoff]);
          await tx.query('UPDATE client_messages SET draft_response=NULL WHERE user_id=$1 AND received_at<$2',[user,cutoff]);
          await audit(tx,user,'retention_cleanup','user',user,{messages:messages.rows.length,notifications:notifications.rows.length,events:events.rows.length});
          return {deleted_messages:messages.rows.length,deleted_notifications:notifications.rows.length,deleted_email_events:events.rows.length,retention_days:prefs.retention_days};
        });
      }
      default: throw new AppError('Unknown workflow.',404);
    }
  }
  async run(user,name,idempotencyKey=uid()) {
    assert(WORKFLOWS.includes(name),'Unknown workflow.',404);
    assert(typeof idempotencyKey==='string'&&idempotencyKey.length<=180&&idempotencyKey.length>=1,'Invalid idempotency key.');
    const previous=(await this.db.query('SELECT * FROM workflow_runs WHERE user_id=$1 AND workflow=$2 AND idempotency_key=$3',[user,name,idempotencyKey])).rows[0];
    if(previous)return {...previous,replayed:true};
    const id=uid();
    const state=await this.db.transaction(async tx=>{
      const lock=(await tx.query('SELECT * FROM workflow_controls WHERE user_id=$1 AND name=$2 FOR UPDATE',[user,name])).rows[0];
      assert(lock,'Workflow not found.',404);
      const duplicate=(await tx.query('SELECT * FROM workflow_runs WHERE user_id=$1 AND workflow=$2 AND idempotency_key=$3',[user,name,idempotencyKey])).rows[0];
      if(duplicate)return {duplicate};
      if(!lock.enabled)return {skipped:true,reason:'Workflow paused.'};
      if(lock.locked_until&&new Date(lock.locked_until)>new Date())return {skipped:true,reason:'This workflow is already running.'};
      await tx.query(`UPDATE workflow_runs SET status='failed',finished_at=now(),error='Run interrupted before completion. Safe stages can be retried.',retryable=true WHERE user_id=$1 AND workflow=$2 AND status='running'`,[user,name]);
      await tx.query(`UPDATE workflow_controls SET locked_until=now()+interval '30 minutes',lock_owner=$3 WHERE user_id=$1 AND name=$2`,[user,name,id]);
      await tx.query(`INSERT INTO workflow_runs(id,user_id,workflow,idempotency_key,status) VALUES($1,$2,$3,$4,'running')`,[id,user,name,idempotencyKey]);return {};
    });
    if(state.duplicate)return {...state.duplicate,replayed:true};
    if(state.skipped)return {workflow:name,status:'skipped',summary:{reason:state.reason}};
    try {
      const summary=await this.perform(user,name);
      const issue=summary.failed>0||summary.score_failures>0||summary.needs_setup||summary.disconnected>0||summary.unknown>0||summary.delivery?.failed>0||summary.delivery?.disconnected>0||summary.delivery?.unknown>0;
      const status=issue?'needs_setup':'completed';
      const error=issue?'Some tasks need attention. Review the counters, connection settings and retryable errors.':null;
      await this.db.query('UPDATE workflow_runs SET status=$1,summary=$2,finished_at=now(),error=$3,retryable=$4 WHERE id=$5',[status,JSON.stringify(summary),error,!!issue,id]);
    } catch(e) {await this.db.query(`UPDATE workflow_runs SET status='failed',error=$1,finished_at=now(),retryable=true WHERE id=$2`,[cleanError(e),id]);}
    finally {await this.db.query('UPDATE workflow_controls SET locked_until=NULL,lock_owner=NULL WHERE user_id=$1 AND name=$2 AND lock_owner=$3',[user,name,id]);}
    return (await this.db.query('SELECT * FROM workflow_runs WHERE id=$1 AND user_id=$2',[id,user])).rows[0];
  }
  async retry(user,id) {
    const run=(await this.db.query('SELECT * FROM workflow_runs WHERE id=$1 AND user_id=$2',[id,user])).rows[0];
    assert(run&&run.retryable&&['failed','needs_setup'].includes(run.status),'This run is not eligible for retry.',409);
    if(run.workflow==='discovery')await this.db.query('UPDATE jobs SET next_score_at=now(),score_attempts=0 WHERE user_id=$1 AND score IS NULL',[user]);
    if(['discovery','replies'].includes(run.workflow))await this.db.query(`UPDATE email_events SET next_attempt_at=now(),attempts=0 WHERE user_id=$1 AND kind=$2 AND status='failed'`,[user,run.workflow==='discovery'?'job':'reply']);
    if(['notifications','daily_report','replies'].includes(run.workflow))await this.db.query(`UPDATE notification_logs SET status='pending',attempts=0,next_attempt_at=now() WHERE user_id=$1 AND status IN ('failed','disconnected')`,[user]);
    await audit(this.db,user,'retry_workflow','workflow_run',id);return this.run(user,run.workflow,uid());
  }
}
