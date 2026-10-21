import nodemailer from 'nodemailer';
import { uid, assert, getPreferences, requestJson, AppError, hash, nextAttempt, cleanError } from './util.js';
export async function queueNotification(db,user,eventKey,payload,prefs,onlyChannel=null) {
  let queued=0;
  for(const channel of ['email','telegram']) {
    if(onlyChannel&&onlyChannel!==channel) continue;
    if(!onlyChannel&&!prefs[channel==='email'?'notify_email':'notify_telegram']) continue;
    const id=uid();
    const result=await db.query(`INSERT INTO notification_logs(id,user_id,event_key,channel,payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,event_key,channel) DO NOTHING RETURNING id`,[id,user,eventKey,channel,JSON.stringify(payload)]);
    queued+=result.rows.length;
  }
  return queued;
}
export class NotificationService {
  constructor(db,config,dependencies={}) {
    this.db=db;this.config=config;this.fetcher=dependencies.fetcher||globalThis.fetch;
    this.transport=dependencies.transport||null;
  }
  emailReady(prefs) { return !!((this.transport||this.config.smtp.host)&&this.config.smtp.from&&(prefs.notification_email||this.config.notificationEmail)); }
  telegramReady(prefs) { return !!(this.config.telegramToken&&(prefs.telegram_chat_id||this.config.telegramChatId)); }
  getTransport() {
    if(!this.transport) {
      const s=this.config.smtp;
      this.transport=nodemailer.createTransport({host:s.host,port:s.port,secure:s.secure,requireTLS:!s.secure,
        ...(s.user?{auth:{user:s.user,pass:s.pass}}:{}),tls:{rejectUnauthorized:true},
        connectionTimeout:15000,greetingTimeout:15000,socketTimeout:30000,logger:false,debug:false});
    }
    return this.transport;
  }
  async check(prefs) {
    const result={email:{configured:this.emailReady(prefs),tested:false},telegram:{configured:this.telegramReady(prefs),tested:false}};
    if(result.email.configured) {
      try{await this.getTransport().verify();result.email={...result.email,tested:true,connected:true};}
      catch{result.email={...result.email,tested:true,connected:false,error:'SMTP verification failed. Check the configured server and credentials.'};}
    }
    if(result.telegram.configured) {
      try {
        const r=await requestJson(`https://api.telegram.org/bot${this.config.telegramToken}/getMe`,{},this.fetcher);
        result.telegram={...result.telegram,tested:true,connected:r.ok===true};
      }catch{result.telegram={...result.telegram,tested:true,connected:false,error:'Telegram token verification failed.'};}
    }
    return result;
  }
  async drain(user,limit=20) {
    const prefs=await getPreferences(this.db,user);
    const control=(await this.db.query("SELECT enabled FROM workflow_controls WHERE user_id=$1 AND name='notifications'",[user])).rows[0];
    if(control&&!control.enabled)return {sent:0,failed:0,disconnected:0,unknown:0,cancelled:0,paused:true};
    // A crash after the provider accepts a message is ambiguous. Never blindly send it again.
    await this.db.query(`UPDATE notification_logs SET status='unknown',last_error='Delivery outcome is unknown after an interrupted send. Check the destination before re-sending.' WHERE user_id=$1 AND status='sending' AND locked_until<now()`,[user]);
    const pending=(await this.db.query(`SELECT id FROM notification_logs WHERE user_id=$1 AND status IN ('pending','failed') AND attempts<5 AND next_attempt_at<=now() ORDER BY created_at LIMIT $2`,[user,limit])).rows;
    const result={sent:0,failed:0,disconnected:0,unknown:0,cancelled:0};
    const deadline=Date.now()+90000;
    for(const {id} of pending) {
      if(Date.now()>=deadline)break;
      const claim=await this.db.query(`UPDATE notification_logs SET status='sending',attempts=attempts+1,locked_until=now()+interval '2 minutes' WHERE id=$1 AND user_id=$2 AND status IN ('pending','failed') AND attempts<5 AND next_attempt_at<=now() RETURNING *`,[id,user]);
      if(!claim.rows.length) continue;
      const entry=claim.rows[0],isTest=entry.event_key.startsWith('test:');
      if(!isTest&&!prefs[entry.channel==='email'?'notify_email':'notify_telegram']) {
        await this.db.query(`UPDATE notification_logs SET status='cancelled',last_error='This notification channel was disabled before delivery.',locked_until=NULL WHERE id=$1`,[id]);result.cancelled++;continue;
      }
      const configured=entry.channel==='email'?this.emailReady(prefs):this.telegramReady(prefs);
      if(!configured) {
        await this.db.query(`UPDATE notification_logs SET status='disconnected',last_error=$1,locked_until=NULL WHERE id=$2`,[`${entry.channel} is not configured. Set its server credential and destination, then retry.`,id]);result.disconnected++;continue;
      }
      try {
        let providerId;
        if(entry.channel==='email') {
          const info=await this.getTransport().sendMail({
            from:this.config.smtp.from,to:prefs.notification_email||this.config.notificationEmail,
            subject:entry.payload.subject,text:entry.payload.email_text,
            messageId:`<${hash(`${user}:${entry.event_key}`)}@freelance-assistant.local>`
          });
          if(Array.isArray(info.rejected)&&info.rejected.length) throw new AppError('The email destination was rejected.',503,'DELIVERY_REJECTED');
          providerId=info.messageId;
        } else {
          const r=await requestJson(`https://api.telegram.org/bot${this.config.telegramToken}/sendMessage`,{
            method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:prefs.telegram_chat_id||this.config.telegramChatId,text:String(entry.payload.telegram_text).slice(0,4000),link_preview_options:{is_disabled:true}})
          },this.fetcher);
          assert(r.ok&&r.result?.message_id,'Telegram did not confirm delivery.',503,'PROVIDER_UNCONFIRMED');providerId=String(r.result.message_id);
        }
        await this.db.query(`UPDATE notification_logs SET status='sent',sent_at=now(),provider_id=$1,last_error=NULL,locked_until=NULL WHERE id=$2`,[providerId||null,id]);result.sent++;
      } catch(e) {
        // Only retry failures known to have occurred before acceptance. A lost response may hide a successful send.
        const knownFailure=['INTEGRATION_AUTH','PROVIDER_RATE_LIMIT','DELIVERY_REJECTED'].includes(e.code)||['EAUTH','EDNS','ECONNREFUSED','ENOTFOUND'].includes(e.code);
        const status=knownFailure?'failed':'unknown';
        const message=status==='unknown'?'Delivery outcome is unknown. Check the destination before sending a new notification.':cleanError(e);
        await this.db.query('UPDATE notification_logs SET status=$1,last_error=$2,next_attempt_at=$3,locked_until=NULL WHERE id=$4',[status,message,nextAttempt(entry.attempts),id]);result[status]++;
      }
    }
    return result;
  }
}
