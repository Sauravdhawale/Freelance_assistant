import { z } from 'zod';
import { canonicalPlatformUrl } from './adapters/index.js';
import { uid, hash, assert, audit, getPreferences, AppError } from './util.js';
import { queueNotification } from './notifications.js';
import { REPLY_TYPES } from './ai.js';
const messageSchema=z.object({
  platform:z.enum(['upwork','fiverr','peopleperhour','guru']),external_id:z.string().min(1).max(500),
  body:z.string().trim().min(1).max(20000),received_at:z.iso.datetime({offset:true}),
  conversation_url:z.string().max(2048).nullish(),job_url:z.string().max(2048).nullish(),
  client_name:z.string().trim().max(200).nullish(),classification:z.enum(REPLY_TYPES).optional()
});
const actions={interview:'Review the invitation and arrange a time in the original platform.',information_requested:'Review the requested information and prepare a reply.',negotiation:'Review scope, pricing and terms before replying.',rejected:'Review the original message and update your next steps.',offer:'Review the original offer and its terms before accepting.',general:'Open the conversation and review the message.'};
export async function listMessages(db,user,limit=200) {
  return (await db.query(`SELECT m.*,c.url AS conversation_url,c.application_id,j.title AS job_title,a.submitted_at AS application_date
    FROM client_messages m JOIN conversations c ON c.id=m.conversation_id
    LEFT JOIN applications a ON a.id=c.application_id LEFT JOIN jobs j ON j.id=a.job_id
    WHERE m.user_id=$1 ORDER BY m.received_at DESC LIMIT $2`,[user,limit])).rows;
}
export async function importMessages(db,user,input,ai) {
  assert(Array.isArray(input.items)&&input.items.length>0&&input.items.length<=100,'Import between 1 and 100 messages at a time.');
  const data=input.items.map(item=>{
    const m=messageSchema.parse(item);
    assert(new Date(m.received_at).getTime()<=Date.now()+60000,'Message time cannot be in the future.');
    return {...m,conversation_url:m.conversation_url?canonicalPlatformUrl(m.conversation_url,m.platform):null,job_url:m.job_url?canonicalPlatformUrl(m.job_url,m.platform):null};
  });
  const prefs=await getPreferences(db,user);let inserted=0,duplicates=0,unmatched=0;
  for(const message of data) {
    const integration=(await db.query('SELECT enabled FROM platform_integrations WHERE user_id=$1 AND platform=$2',[user,message.platform])).rows[0];
    assert(integration?.enabled,`Enable the ${message.platform} integration before importing its messages.`);
    if((await db.query('SELECT id FROM client_messages WHERE user_id=$1 AND platform=$2 AND external_id=$3',[user,message.platform,message.external_id])).rows.length){duplicates++;continue;}
    const type=message.classification?{classification:message.classification,source:'user'}:await ai.classify(user,message.body,prefs);
    const result=await db.transaction(async tx=>{
      let application=null;
      if(message.job_url) application=(await tx.query('SELECT a.* FROM applications a JOIN jobs j ON j.id=a.job_id WHERE a.user_id=$1 AND j.platform=$2 AND j.url=$3',[user,message.platform,message.job_url])).rows[0];
      const conversationKey=message.conversation_url?hash(message.conversation_url):`unlinked:${message.external_id}`;
      const conversation=(await tx.query(`INSERT INTO conversations(id,user_id,platform,external_id,url,application_id) VALUES($1,$2,$3,$4,$5,$6)
        ON CONFLICT(user_id,platform,external_id) DO UPDATE SET application_id=COALESCE(conversations.application_id,EXCLUDED.application_id) RETURNING *`,[uid(),user,message.platform,conversationKey,message.conversation_url,application?.id||null])).rows[0];
      const cid=conversation.id;
      assert(!conversation.application_id||!application||conversation.application_id===application.id,'The conversation is associated with a different application. Review it manually.',409,'AMBIGUOUS_MATCH');
      if(conversation.application_id&&!application)application=(await tx.query('SELECT * FROM applications WHERE id=$1 AND user_id=$2',[conversation.application_id,user])).rows[0];
      const id=uid();
      const added=await tx.query(`INSERT INTO client_messages(id,user_id,conversation_id,platform,external_id,client_name,body,classification,classification_source,received_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(user_id,platform,external_id) DO NOTHING RETURNING id`,[id,user,cid,message.platform,message.external_id,message.client_name||null,message.body,type.classification,type.source,message.received_at]);
      if(!added.rows.length) return {duplicate:true};
      let title='Unlinked conversation';
      if(application) {
        title=(await tx.query('SELECT title FROM jobs WHERE id=$1 AND user_id=$2',[application.job_id,user])).rows[0].title;
        // The timestamp and state condition are evaluated atomically on the current locked row.
        await tx.query(`UPDATE applications SET status=CASE WHEN submitted_at IS NOT NULL AND status NOT IN ('closed','rejected') AND $1<>'general' THEN $1 ELSE status END,
          last_reply_at=$2,updated_at=now() WHERE id=$3 AND user_id=$4 AND (last_reply_at IS NULL OR last_reply_at<$2)`,[type.classification,message.received_at,application.id,user]);
      }
      const link=message.conversation_url||message.job_url||'Open the original platform inbox.';
      const excerpt=prefs.notification_excerpt?`\nMessage excerpt: ${message.body.slice(0,500)}\n`:'\nMessage content is available in your private dashboard.\n';
      const displayType=type.classification.replaceAll('_',' ');
      await queueNotification(tx,user,`message:${id}`,{
        subject:`[Freelance Alert] New Client Reply — ${message.platform} — ${title}`,
        email_text:`New freelance client reply\nPlatform: ${message.platform}\nClient: ${message.client_name||'Not supplied'}\nJob: ${title}\nType: ${displayType}\nReceived: ${message.received_at}\nApplication date: ${application?.submitted_at?new Date(application.submitted_at).toISOString():'Not linked'}\n${excerpt}\nSuggested next action: ${actions[type.classification]}\nOriginal conversation: ${link}`,
        telegram_text:`New freelance client reply\nPlatform: ${message.platform}\nJob: ${title}\nType: ${displayType}\nOpen the original conversation: ${link}`
      },prefs);
      await audit(tx,user,'import_client_message','message',id,{platform:message.platform,matched:!!application});
      return {duplicate:false,matched:!!application};
    });
    if(result.duplicate)duplicates++;else {inserted++;if(!result.matched)unmatched++;}
  }
  return {inserted,duplicates,unmatched};
}
export async function draftReply(db,user,id,ai) {
  const message=(await db.query('SELECT * FROM client_messages WHERE id=$1 AND user_id=$2',[id,user])).rows[0];assert(message,'Message not found.',404);
  const prefs=await getPreferences(db,user),draft=await ai.reply(user,message.body,prefs);
  await db.query('UPDATE client_messages SET draft_response=$1,draft_generator=$2 WHERE id=$3 AND user_id=$4',[draft.draft_response,draft.generator,id,user]);
  await audit(db,user,'draft_reply','message',id,{generator:draft.generator,sent:false});return draft;
}
