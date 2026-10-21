import { getPreferences, localDate } from './util.js';
import { shapeJob, jobColumns } from './jobs.js';
import { queueNotification } from './notifications.js';
export async function metrics(db,user) {
  const today=`(date_trunc('day',now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata')`;
  const job=(await db.query(`SELECT count(*) FILTER(WHERE created_at>=${today} AND kind='job') AS new_jobs,
    count(*) FILTER(WHERE status='shortlisted' AND kind='job') AS shortlisted,
    count(*) FILTER(WHERE kind='inquiry') AS inquiries FROM jobs WHERE user_id=$1`,[user])).rows[0];
  const application=(await db.query(`SELECT count(*) FILTER(WHERE submitted_at>=${today}) AS submitted,
    count(*) FILTER(WHERE status IN ('draft','awaiting_submission')) AS awaiting_submission,
    count(*) FILTER(WHERE status='interview') AS interviews,count(*) FILTER(WHERE status='offer') AS offers,
    count(*) FILTER(WHERE status='negotiation') AS negotiations,count(*) FILTER(WHERE status='rejected') AS rejections,
    count(*) FILTER(WHERE status='submitted' AND submitted_at<now()-interval '3 days' AND last_reply_at IS NULL) AS follow_up
    FROM applications WHERE user_id=$1`,[user])).rows[0];
  const replies=(await db.query(`SELECT count(*) AS n FROM client_messages WHERE user_id=$1 AND received_at>=${today}`,[user])).rows[0];
  return Object.fromEntries(Object.entries({...job,...application,replies:replies.n}).map(([k,v])=>[k,Number(v)]));
}
export async function integrations(db,user) {
  const items=(await db.query('SELECT platform,enabled,mode,status,last_sync_at,error FROM platform_integrations WHERE user_id=$1 ORDER BY platform',[user])).rows;
  return items.map(item=>({...item,capabilities:{discover:item.platform!=='fiverr',auto_submit:false,messages:true,discovery_method:'email/import'},
    notes:item.platform==='fiverr'?'Incoming inquiries, response drafts and your own Gig content. No conventional job applications or automated publishing.':item.platform==='upwork'?'Email/import is implemented. Upwork has approved API/MCP options; no live account-authorized submission adapter is enabled in this build.':'Email/import is implemented. Review proposals and submit them through the original platform.'}));
}
export async function workflowStates(db,user) {
  return (await db.query(`SELECT c.name,c.enabled,(SELECT row_to_json(r) FROM (SELECT status,started_at,finished_at FROM workflow_runs WHERE user_id=c.user_id AND workflow=c.name ORDER BY started_at DESC LIMIT 1) r) AS last_run
    FROM workflow_controls c WHERE c.user_id=$1 ORDER BY c.name`,[user])).rows;
}
export async function overview(db,user) {
  const [counts,jobs,runs,flows,platforms]=await Promise.all([
    metrics(db,user),db.query(`SELECT ${jobColumns} FROM jobs j WHERE j.user_id=$1 AND j.status='shortlisted' AND j.kind='job' ORDER BY j.score DESC,j.posted_at DESC NULLS LAST LIMIT 6`,[user]),
    db.query('SELECT id,workflow,status,started_at,finished_at,summary,error,retryable FROM workflow_runs WHERE user_id=$1 ORDER BY started_at DESC LIMIT 8',[user]),workflowStates(db,user),integrations(db,user)
  ]);
  return {metrics:counts,recommended:jobs.rows.map(shapeJob),recent_activity:runs.rows,workflows:flows,integrations:platforms};
}
export async function dailyReport(db,user) {
  const prefs=await getPreferences(db,user),day=localDate(new Date(),prefs.timezone),m=await metrics(db,user);
  const platform=await integrations(db,user);
  const logs=(await db.query(`SELECT workflow,status,error FROM workflow_runs WHERE user_id=$1 AND started_at>=now()-interval '1 day' AND status IN ('failed','needs_setup') ORDER BY started_at DESC LIMIT 15`,[user])).rows;
  const jobs=(await db.query(`SELECT title,url FROM jobs WHERE user_id=$1 AND created_at>=(date_trunc('day',now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata') ORDER BY created_at DESC LIMIT 20`,[user])).rows;
  const conversations=(await db.query(`SELECT DISTINCT c.url FROM client_messages m JOIN conversations c ON c.id=m.conversation_id WHERE m.user_id=$1 AND m.received_at>=(date_trunc('day',now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata') AND c.url IS NOT NULL LIMIT 20`,[user])).rows;
  const mailbox=(await db.query('SELECT error,last_checked_at FROM mailbox_state WHERE user_id=$1',[user])).rows[0];
  const lines=[`Freelance activity report — ${day} (Asia/Kolkata)`,
    `New jobs discovered today: ${m.new_jobs}`,`Relevant jobs currently shortlisted: ${m.shortlisted}`,
    `Applications recorded as submitted today: ${m.submitted}`,`Applications awaiting review/submission: ${m.awaiting_submission}`,
    `Client replies today: ${m.replies}`,`Current interview invitations: ${m.interviews}`,`Current offers: ${m.offers}`,`Current negotiations: ${m.negotiations}`,`Current rejections: ${m.rejections}`,`Applications awaiting follow-up (3+ days without reply): ${m.follow_up}`,
    '',m.new_jobs===0&&m.replies===0?'No new opportunities or client replies were recorded today.':'Review the dashboard for proposals, messages and next actions.',
    '', 'Integrations:',...platform.map(p=>`${p.platform}: ${p.enabled?p.status:'paused'}${p.error?` — ${p.error}`:''}`),
    `Email monitoring: ${mailbox?.error|| (mailbox?.last_checked_at?'last checked '+new Date(mailbox.last_checked_at).toISOString():'not yet connected')}`,
    '', 'Workflow issues:',...(logs.length?logs.map(l=>`${l.workflow}: ${l.error||l.status}`):['No failed workflow runs recorded in the last 24 hours.']),
    '', 'New opportunity links:',...(jobs.length?jobs.map(j=>`${j.title}\n${j.url}`):['None.']),
    '', 'Conversation links:',...(conversations.length?conversations.map(c=>c.url):['None.']),
    '', 'Submission counts are based on stored confirmations. No platform purchase or client reply is sent by this report.'
  ];
  const queued=prefs.notify_email?await queueNotification(db,user,`daily:${day}`,{subject:`[Freelance Report] Daily Summary — ${day}`,email_text:lines.join('\n'),telegram_text:`Freelance daily report — ${day}\nJobs today: ${m.new_jobs}\nSubmitted today: ${m.submitted}\nReplies today: ${m.replies}\nAwaiting review/submission: ${m.awaiting_submission}`},prefs,'email'):0;
  return {date:day,queued,metrics:m,email_enabled:prefs.notify_email};
}
