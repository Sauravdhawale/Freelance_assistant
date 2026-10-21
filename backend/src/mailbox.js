import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { AppError, hash, uid } from './util.js';
import { emailAddress, platformForHostname, parsePlatformEmail } from './adapters/index.js';

const MAX_MESSAGE_BYTES = 1024 * 1024;
const MAX_BATCH = 100;

function stripComments(value) {
  let depth=0, quoted=false, escaped=false, result='';
  for (const char of value) {
    if (escaped) { if (!depth) result += char; escaped=false; continue; }
    if (char === '\\') { escaped=true; if (!depth) result += char; continue; }
    if (char === '"' && !depth) { quoted=!quoted; result += char; continue; }
    if (!quoted && char === '(') { depth++; continue; }
    if (!quoted && char === ')' && depth) { depth--; continue; }
    if (!depth) result += char;
  }
  return depth || quoted ? '' : result;
}

/** Trust only the first receiver-added Authentication-Results header, never a later matching header. */
export function verifyPlatformSender(mail, allowedSenders=[], authServers=['mx.google.com']) {
  const sender = emailAddress(mail?.from);
  const platform = sender ? platformForHostname(sender.split('@')[1]) : null;
  const denied = reason => ({verified:false,reason,sender,platform});
  if (!sender || !platform) return denied('Sender is not a recognized platform address.');
  if (!allowedSenders.map(s => String(s).trim().toLowerCase()).includes(sender)) return denied('Sender is not on the exact address allowlist.');
  const lines = Array.isArray(mail.headerLines) ? mail.headerLines : [];
  if (lines.filter(h => String(h.key).toLowerCase() === 'from').length !== 1) return denied('A single unambiguous From header is required.');
  const first = lines.find(h => String(h.key).toLowerCase() === 'authentication-results');
  if (!first || typeof first.line !== 'string') return denied('The mail server did not supply Authentication-Results.');
  const raw = first.line.replace(/^authentication-results\s*:/i,'').replace(/\r?\n[ \t]+/g,' ');
  const parts = stripComments(raw).split(';').map(part => part.trim());
  const authserv = (parts.shift() || '').replace(/\s+\d+$/,'').toLowerCase();
  if (!authServers.map(s => String(s).trim().toLowerCase()).includes(authserv)) return denied('The top Authentication-Results header is not from a configured trusted receiver.');
  const results = parts.filter(part => /^dmarc\s*=/i.test(part));
  if (results.length !== 1 || !/^dmarc\s*=\s*pass(?:\s|$)/i.test(results[0])) return denied('The trusted receiver did not report DMARC pass.');
  const fromDomain = results[0].match(/\bheader\.from\s*=\s*(?:"([a-z0-9.-]+)"|([a-z0-9.-]+))(?:\s|$)/i);
  if (!fromDomain || (fromDomain[1] || fromDomain[2]).toLowerCase() !== sender.split('@')[1]) return denied('Authenticated From domain does not match the notification sender.');
  return {verified:true,reason:null,sender,platform};
}

async function saveStateError(db,userId,message) {
  await db.query(`INSERT INTO mailbox_state(user_id,last_checked_at,error) VALUES($1,now(),$2)
    ON CONFLICT(user_id) DO UPDATE SET last_checked_at=now(),error=EXCLUDED.error`,[userId,message]);
}

function safeMailboxError(error) {
  if (error instanceof AppError) return error.message;
  const code = String(error?.serverResponseCode || error?.code || '').toUpperCase();
  if (/AUTH|CREDENTIAL|LOGIN/.test(code)) return 'Mailbox authorization failed. Update the mailbox credential in your server environment.';
  if (/TIMEOUT|ETIMEDOUT|CONNECT|ECONN|ENOTFOUND|TLS|CERT|SOCKET/.test(code)) return 'Mailbox connection failed. Check host, TLS, network access and the configured credential.';
  return 'Mailbox polling failed. No failed message was skipped by the checkpoint; check configuration and retry.';
}

/**
 * Pull only the configured mailbox, in read-only mode. The caller holds the shared
 * discovery/replies intake lease. All event inserts and UID checkpoints commit together.
 * Optional dependencies are for local automated tests; production uses real IMAP.
 */
export async function pollMailbox(db,userId,config,dependencies={}) {
  const settings = config?.imap || config || {};
  const counts = {fetched:0,queued:0,skipped:0,unverified:0,oversized:0,ignored:0,duplicates:0,connected:false,has_more:false};
  let validationError;
  if (!settings.host || !settings.user || !settings.pass) validationError = 'Mailbox is not connected. Set IMAP_HOST, IMAP_USER and IMAP_PASS in your server environment.';
  else if (settings.secure !== true) validationError = 'Mailbox polling requires implicit TLS. Set IMAP_TLS=true and the provider TLS port.';
  else if (!Array.isArray(settings.allowedSenders) || !settings.allowedSenders.length) validationError = 'Mailbox is not enabled. Configure IMAP_ALLOWED_SENDERS with exact addresses from genuine platform notifications.';
  else if (settings.allowedSenders.some(sender => !emailAddress(sender) || emailAddress(sender) !== String(sender).trim().toLowerCase() || !platformForHostname(emailAddress(sender).split('@')[1]))) validationError = 'Every allowlisted sender must be an exact email address on a supported platform domain, without a display name.';
  const trustedServers = settings.authServers || ['mx.google.com'];
  if (!Array.isArray(trustedServers) || !trustedServers.length || trustedServers.some(server => !/^[a-z0-9.-]+$/i.test(server))) validationError = 'Configure trusted IMAP_AUTH_SERVERS using your receiving mail provider Authentication-Results identifiers.';
  if (validationError) {
    await saveStateError(db,userId,validationError);
    return {...counts,error:validationError};
  }

  const Client = dependencies.ImapFlow || ImapFlow;
  const parser = dependencies.simpleParser || simpleParser;
  const now = dependencies.now || (() => Date.now());
  const started = now();
  const client = new Client({
    host:settings.host,port:Number(settings.port || 993),secure:true,
    auth:{user:settings.user,pass:settings.pass},tls:{rejectUnauthorized:true},
    logger:false,emitLogs:false,disableAutoIdle:true,
    connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000,maxLineLength:2*MAX_MESSAGE_BYTES
  });
  client.on?.('error',()=>{});
  let lock;
  try {
    await client.connect();
    lock = await client.getMailboxLock(settings.mailbox || 'INBOX',{readOnly:true});
    if (!client.mailbox || client.mailbox.uidValidity === undefined) throw new AppError('Mailbox server did not provide a UID validity value.',503);
    // Snapshot before searching: a new arrival must not be hidden by a later UIDNEXT.
    const initialUidNext = Number(client.mailbox.uidNext || 1);
    counts.connected = true;
    const scope = hash([settings.host,settings.user,settings.mailbox || 'INBOX'].join('\n')).slice(0,24);
    const validity = `${scope}:${String(client.mailbox.uidValidity)}`;
    const previous = (await db.query('SELECT uid_validity,last_uid FROM mailbox_state WHERE user_id=$1',[userId])).rows[0];
    const sameMailbox = previous?.uid_validity === validity;
    let lastUid = sameMailbox ? Number(previous.last_uid) : 0;
    const lookback = Math.min(30,Math.max(1,Number(settings.lookbackDays) || 7));
    const search = sameMailbox
      ? {uid:`${lastUid+1}:*`}
      : {since:new Date(now()-lookback*24*60*60*1000)};
    const found = await client.search(search,{uid:true});
    if (!Array.isArray(found)) throw new AppError('Mailbox search was rejected. The checkpoint was not advanced.',503);
    const allUids = [...new Set(found.map(Number))].filter(value => Number.isSafeInteger(value) && value > lastUid).sort((a,b)=>a-b);
    const selected = allUids.slice(0,MAX_BATCH);
    counts.has_more = allUids.length > selected.length;

    const checkpoint = async (messageUid,event=null,sourceId=null) => db.transaction(async tx => {
      let inserted=false;
      if (event) {
        const result = await tx.query(`INSERT INTO email_events(id,user_id,source_id,platform,kind,payload)
          VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,source_id) DO NOTHING RETURNING id`,
          [uid(),userId,sourceId,event.platform,event.kind,JSON.stringify({items:event.items})]);
        inserted = result.rows.length > 0;
      }
      await tx.query(`INSERT INTO mailbox_state(user_id,uid_validity,last_uid,last_checked_at,error) VALUES($1,$2,$3,now(),NULL)
        ON CONFLICT(user_id) DO UPDATE SET uid_validity=EXCLUDED.uid_validity,last_uid=EXCLUDED.last_uid,last_checked_at=now(),error=NULL`,
        [userId,validity,messageUid]);
      return inserted;
    });

    for (const messageUid of selected) {
      if (now()-started > 45000) { counts.has_more=true; break; }
      const metadata = await client.fetchOne(String(messageUid),{size:true,envelope:true,internalDate:true},{uid:true});
      counts.fetched++;
      if (!metadata) { counts.skipped++; counts.ignored++; await checkpoint(messageUid); lastUid=messageUid; continue; }
      // Reject an oversized message before downloading MIME/attachments.
      if (!Number.isFinite(metadata.size) || metadata.size > MAX_MESSAGE_BYTES) {
        counts.skipped++; counts.oversized++; await checkpoint(messageUid); lastUid=messageUid; continue;
      }
      const envelopeFrom = metadata.envelope?.from;
      const envelopeSender = emailAddress({value:envelopeFrom});
      if (!envelopeSender || !settings.allowedSenders.map(s=>s.trim().toLowerCase()).includes(envelopeSender)) {
        counts.skipped++; counts.unverified++; await checkpoint(messageUid); lastUid=messageUid; continue;
      }
      const content = await client.fetchOne(String(messageUid),{source:true},{uid:true});
      if (!content) { counts.skipped++; counts.ignored++; await checkpoint(messageUid); lastUid=messageUid; continue; }
      if (!content.source || content.source.length > MAX_MESSAGE_BYTES) {
        counts.skipped++; counts.oversized++; await checkpoint(messageUid); lastUid=messageUid; continue;
      }
      const mail = await parser(content.source, {skipHtmlToText:true,skipTextToHtml:true,skipTextLinks:true,skipImageLinks:true,keepCidLinks:true,maxHtmlLengthToParse:500000});
      const verified = verifyPlatformSender(mail,settings.allowedSenders,trustedServers);
      if (!verified.verified || verified.sender !== envelopeSender) {
        counts.skipped++; counts.unverified++; await checkpoint(messageUid); lastUid=messageUid; continue;
      }
      const event = parsePlatformEmail({from:mail.from,subject:mail.subject,text:mail.text,html:mail.html,
        messageId:mail.messageId || `${validity}:${messageUid}`,date:metadata.internalDate || mail.date});
      if (!event || event.kind === 'ignored' || !event.items.length) {
        counts.skipped++; counts.ignored++; await checkpoint(messageUid); lastUid=messageUid; continue;
      }
      const sourceId = mail.messageId
        ? `message:${hash(`${verified.sender}\n${mail.messageId}`)}`
        : `imap:${hash(`${validity}:${messageUid}`)}`;
      const inserted = await checkpoint(messageUid,event,sourceId);
      if (inserted) counts.queued++; else {counts.skipped++;counts.duplicates++;}
      lastUid = messageUid;
    }
    if (!selected.length) await checkpoint(sameMailbox ? lastUid : Math.max(0,initialUidNext-1));
    const warning = counts.unverified || counts.oversized || counts.ignored
      ? `Skipped ${counts.unverified} unverified, ${counts.oversized} oversized and ${counts.ignored} unsupported notifications. Review the dedicated mailbox for anything needing manual import.` : null;
    await saveStateError(db,userId,warning);
    return {...counts,...(warning ? {warning} : {})};
  } catch (error) {
    const message = safeMailboxError(error);
    await saveStateError(db,userId,message);
    return {...counts,connected:false,error:message};
  } finally {
    lock?.release();
    try { await client.logout(); } catch { client.close?.(); }
  }
}
