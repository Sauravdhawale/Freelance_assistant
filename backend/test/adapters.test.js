import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalPlatformUrl,normalizeJob,parsePlatformEmail,extractPlatformLinks,plainEmailText,platformForHostname} from '../src/adapters/index.js';
import {pollMailbox,verifyPlatformSender} from '../src/mailbox.js';

const NOW = Date.parse('2026-10-20T12:00:00Z');
const job = {platform:'upwork',url:'https://www.upwork.com/jobs/~012345',title:'WordPress website maintenance',description:'Update the WordPress theme and fix a responsive menu.'};
const sender = 'notifications@upwork.com';
const goodHeader = 'Authentication-Results: mx.google.com; dkim=pass header.d=upwork.com; dmarc=pass (p=REJECT) header.from=upwork.com';
const verifiedMail = (auth=goodHeader) => ({from:{value:[{address:sender}]},headerLines:[{key:'authentication-results',line:auth},{key:'from',line:`From: ${sender}`}]});

test('canonical links enforce protocol, hostname boundary, credentials and port',()=>{
  assert.equal(canonicalPlatformUrl('https://www.upwork.com/jobs/~012345?utm_source=email#section','upwork'),job.url);
  assert.equal(canonicalPlatformUrl('https://www.upwork.com/jobs/~012345/','upwork'),job.url);
  for (const value of ['http://upwork.com/jobs/~1','https://upwork.com.evil.example/jobs/~1','https://evilupwork.com/jobs/~1','https://user:pass@upwork.com/jobs/~1','https://upwork.com:8443/jobs/~1','https://upwork.com\\@evil.example/jobs/~1','https://upwork.com/\nwrong','javascript:alert(1)']) assert.throws(()=>canonicalPlatformUrl(value,'upwork'));
  assert.throws(()=>canonicalPlatformUrl(job.url,'fiverr'));
  assert.equal(platformForHostname('support.upwork.com'),'upwork');
  assert.equal(platformForHostname('fiverr.com.evil.example'),null);
  assert.equal(platformForHostname('invalid..upwork.com'),null);
  assert.equal(platformForHostname('.upwork.com'),null);
});

test('normalizeJob validates numbers, deduplicates skills, never assumes a full description',()=>{
  const normalized=normalizeJob({...job,budget_min:'100.25',budget_max:200,skills:'WordPress, wordpress; CSS'});
  assert.deepEqual(normalized.skills,['WordPress','CSS']);
  assert.equal(normalized.budget_min,100.25);
  assert.equal(normalized.full_description,false);
  assert.equal(normalized.posted_at,null);
  assert.equal(normalized.source,'user_import');
  assert.equal(normalized.external_id,normalizeJob({...job,url:`${job.url}?utm_medium=alert`}).external_id);
  assert.equal(normalizeJob({...job,title:'WordPress\r\n project\u0007'}).title,'WordPress project');
  assert.equal(normalizeJob({...job,budget_max:'999999999999.99'}).budget_max,999999999999.99);
  assert.throws(()=>normalizeJob({...job,budget_max:'1000000000000.00'}));
  for (const extra of [{budget_min:-1},{budget_min:'NaN'},{budget_max:Infinity},{budget_min:300,budget_max:200},{skills:[{}]},{work_type:'salary'},{posted_at:'2026-10-20'},{posted_at:'2026-02-31T12:00:00Z'},{posted_at:'2026-10-20T24:00:00Z'},{external_id:{fake:'id'}}]) assert.throws(()=>normalizeJob({...job,...extra}));
  assert.equal(normalizeJob({...job,posted_at:new Date(NOW)}).posted_at,'2026-10-20T12:00:00.000Z');
  assert.equal(normalizeJob({...job,posted_at:'2024-02-29T17:30:00+05:30'}).posted_at,'2024-02-29T12:00:00.000Z');
});

test('Fiverr user imports are inquiries regardless of a requested job kind',()=>{
  const item=normalizeJob({...job,platform:'fiverr',url:'https://www.fiverr.com/inbox/client',kind:'job'});
  assert.equal(item.kind,'inquiry');
});

test('email links never follow trackers and HTML is converted only to plain text',()=>{
  const links=extractPlatformLinks('',`<a href="https://click.example/redirect?url=${job.url}">redirect</a><a href="${job.url}?utm_source=alert&amp;utm_medium=email">WordPress</a>`,'upwork');
  assert.deepEqual(links,[{url:job.url,label:'WordPress'}]);
  assert.equal(plainEmailText('<script>steal()</script><p>Hello &amp; welcome</p>'),'Hello & welcome');
});

test('email digest preserves distinct jobs and marks every description incomplete',()=>{
  const event=parsePlatformEmail({from:sender,subject:'New jobs matching your skills',html:`<a href="${job.url}">WordPress help</a><a href="https://www.upwork.com/jobs/~06789">React dashboard</a>`,date:new Date(NOW),messageId:'digest-1'});
  assert.equal(event.kind,'job');
  assert.equal(event.items.length,2);
  assert.equal(event.items[0].title,'WordPress help');
  assert.ok(event.items.every(item=>!item.full_description && item.posted_at===null && item.budget_min===null));
  assert.ok(!event.items[0].description.includes('React dashboard'));
});

test('email parsers recognize separate PeoplePerHour and Guru listing shapes',()=>{
  for(const input of [
    {from:'alerts@peopleperhour.com',url:'https://www.peopleperhour.com/freelance-jobs/technology-programming/website-development/wordpress-project-12345',platform:'peopleperhour'},
    {from:'alerts@guru.com',url:'https://www.guru.com/jobs/wordpress-project/12345',platform:'guru'}
  ]) {
    const result=parsePlatformEmail({from:input.from,subject:'New job alerts',text:`WordPress support\n${input.url}`});
    assert.equal(result.platform,input.platform);
    assert.equal(result.items.length,1);
  }
});

test('reply notifications retain exact links and IDs without inventing a job association',()=>{
  const base={from:sender,subject:'New message from Jamie',text:'Can we arrange an interview? https://www.upwork.com/ab/messages/rooms/room_123',date:new Date(NOW),messageId:'reply-1'};
  const event=parsePlatformEmail(base);
  assert.equal(event.kind,'reply');
  assert.equal(event.items[0].client_name,'Jamie');
  assert.equal(event.items[0].job_url,undefined);
  assert.equal(event.items[0].conversation_url,'https://www.upwork.com/ab/messages/rooms/room_123');
  assert.equal(event.items[0].external_id,parsePlatformEmail(base).items[0].external_id);
  const fiverr=parsePlatformEmail({...base,from:'messages@fiverr.com',text:'Can you help? https://www.fiverr.com/inbox/buyer'});
  assert.equal(fiverr.kind,'reply');
  assert.equal(fiverr.platform,'fiverr');
});

test('support/newsletters and unrecognized links do not become client notifications or jobs',()=>{
  for(const input of [
    {from:sender,subject:'New message from Support ticket 123',text:'https://www.upwork.com/ab/messages/rooms/room_123'},
    {from:sender,subject:'New jobs newsletter',text:job.url},
    {from:sender,subject:'New message from Alex',text:'https://upwork.com.evil.example/ab/messages/rooms/123'},
    {from:sender,subject:'New jobs for you',text:'https://support.upwork.com/help'},
    {from:'messages@fiverr.com',subject:'New jobs for you',text:'https://www.fiverr.com/one/website'}
  ]) assert.equal(parsePlatformEmail({...input,date:new Date(NOW)}).kind,'ignored');
  assert.equal(parsePlatformEmail({from:'alerts@evilupwork.com',subject:'New job',text:job.url}),null);
});

test('sender verification requires exact allowlist and trusted top DMARC result',()=>{
  assert.equal(verifyPlatformSender(verifiedMail(),[sender]).verified,true);
  assert.equal(verifyPlatformSender(verifiedMail(),['other@upwork.com']).verified,false);
  assert.equal(verifyPlatformSender(verifiedMail(goodHeader.replace('dmarc=pass','dmarc=fail')),[sender]).verified,false);
  assert.equal(verifyPlatformSender(verifiedMail(goodHeader.replace('mx.google.com','attacker.example')),[sender]).verified,false);
  assert.equal(verifyPlatformSender(verifiedMail(goodHeader.replace('header.from=upwork.com','header.from=fiverr.com')),[sender]).verified,false);
  assert.equal(verifyPlatformSender(verifiedMail('Authentication-Results: mx.google.com; dkim=pass (dmarc=pass header.from=upwork.com)'),[sender]).verified,false);
  const forged=verifiedMail(goodHeader.replace('dmarc=pass','dmarc=fail'));
  forged.headerLines.push({key:'authentication-results',line:goodHeader});
  assert.equal(verifyPlatformSender(forged,[sender]).verified,false);
});

function memoryDb() {
  const db={state:null,events:new Map(),failInsert:false};
  db.query=async(sql,values=[])=>{
    if(sql.startsWith('SELECT uid_validity')) return {rows:db.state?[db.state]:[]};
    if(sql.startsWith('INSERT INTO email_events')) {
      if(db.failInsert) throw new Error('Simulated database failure with a secret that must not escape.');
      if(db.events.has(values[2])) return {rows:[]};
      db.events.set(values[2],{id:values[0],platform:values[3],kind:values[4],payload:JSON.parse(values[5])});
      return {rows:[{id:values[0]}]};
    }
    if(sql.startsWith('INSERT INTO mailbox_state')) {
      db.state=values.length===3 ? {uid_validity:values[1],last_uid:values[2],error:null} : {...(db.state||{last_uid:0}),error:values[1]};
      return {rows:[]};
    }
    throw new Error(`Unexpected test query: ${sql}`);
  };
  db.transaction=async(fn)=>{
    const before={state:structuredClone(db.state),events:new Map(db.events)};
    try{return await fn(db);}catch(error){db.state=before.state;db.events=before.events;throw error;}
  };
  return db;
}

function fixture(uidValue=1,valid=true) {
  return {uid:uidValue,internalDate:new Date(NOW),source:Buffer.from([
    valid?goodHeader:goodHeader.replace('dmarc=pass','dmarc=fail'),
    `From: Platform <${sender}>`,`Message-ID: <fixture-${uidValue}@upwork.com>`,
    'Date: Tue, 20 Oct 2026 12:00:00 +0000','Subject: New job alerts','Content-Type: text/plain; charset=utf-8','',`WordPress maintenance\n${job.url}`
  ].join('\r\n'))};
}
const settings={imap:{host:'imap.test.invalid',port:993,secure:true,user:'test-user',pass:'local-fixture-password',mailbox:'Freelance',allowedSenders:[sender],authServers:['mx.google.com'],lookbackDays:7}};

function fakeImap(messages,{validity=100,failUid=null,afterSearch=null,searchResult}={}) {
  const calls=[];
  class Fake {
    constructor(options){this.options=options;this.mailbox={uidValidity:BigInt(validity),uidNext:Math.max(0,...messages.map(m=>m.uid))+1};calls.push(['construct',options]);}
    on(){}
    async connect(){calls.push(['connect']);}
    async getMailboxLock(path,options){calls.push(['lock',path,options]);return{release(){calls.push(['release']);}};}
    async search(criteria){calls.push(['search',criteria]);const after=criteria.uid?Number(criteria.uid.split(':')[0]):0;const result=messages.filter(m=>m.uid>=after && (!criteria.since || m.internalDate>=criteria.since)).map(m=>m.uid);afterSearch?.(this);return searchResult===undefined?result:searchResult;}
    async fetchOne(id,query,options){calls.push(['fetch',Number(id),query,options]);if(Number(id)===failUid)throw new Error('Simulated IMAP failure');const m=messages.find(m=>m.uid===Number(id));if(!m)return false;if(query.source)return{source:m.source};return{size:m.size??m.source.length,internalDate:m.internalDate,envelope:{from:[{address:sender}]}};}
    async logout(){calls.push(['logout']);}
    close(){calls.push(['close']);}
  }
  return{ImapFlow:Fake,now:()=>NOW,calls};
}

test('unconfigured mailbox returns disconnected with an actionable safe error',async()=>{
  const db=memoryDb();
  const result=await pollMailbox(db,'user',{});
  assert.equal(result.connected,false);
  assert.match(result.error,/IMAP_HOST/);
  assert.equal(db.state.last_uid,0);
});

test('IMAP ingests verified email once, saves only normalized data, and opens read-only',async()=>{
  const db=memoryDb();const client=fakeImap([fixture()]);
  const first=await pollMailbox(db,'user',settings,client);
  assert.equal(first.connected,true);assert.equal(first.queued,1);assert.equal(db.state.last_uid,1);
  assert.equal(db.events.size,1);
  const stored=[...db.events.values()][0];
  assert.equal(stored.kind,'job');assert.equal(stored.payload.items[0].full_description,false);
  assert.ok(!JSON.stringify(stored).includes('Authentication-Results'));
  assert.equal(client.calls.find(c=>c[0]==='lock')[2].readOnly,true);
  const second=await pollMailbox(db,'user',settings,client);
  assert.equal(second.queued,0);assert.equal(second.fetched,0);
});

test('IMAP surfaces unverified and oversized skips without creating notifications',async()=>{
  const db=memoryDb();const large=fixture(2);large.size=2*1024*1024;
  const client=fakeImap([fixture(1,false),large]);
  const result=await pollMailbox(db,'user',settings,client);
  assert.equal(result.unverified,1);assert.equal(result.oversized,1);assert.equal(result.queued,0);
  assert.equal(db.state.last_uid,2);assert.match(result.warning,/unverified/);
  assert.ok(!client.calls.some(c=>c[0]==='fetch' && c[1]===2 && c[2].source));
});

test('failed event storage rolls back its UID checkpoint and never exposes raw errors',async()=>{
  const db=memoryDb();db.failInsert=true;
  const result=await pollMailbox(db,'user',settings,fakeImap([fixture()]));
  assert.equal(result.connected,false);assert.equal(db.state.last_uid,0);assert.equal(db.events.size,0);
  assert.ok(!result.error.includes('secret'));
  db.failInsert=false;
  const retried=await pollMailbox(db,'user',settings,fakeImap([fixture()]));
  assert.equal(retried.queued,1);
});

test('IMAP failures preserve already committed progress and retry the failed UID',async()=>{
  const db=memoryDb();
  const first=await pollMailbox(db,'user',settings,fakeImap([fixture(1),fixture(2)],{failUid:2}));
  assert.equal(first.queued,1);assert.equal(first.connected,false);assert.equal(db.state.last_uid,1);
  const next=await pollMailbox(db,'user',settings,fakeImap([fixture(1),fixture(2)]));
  assert.equal(next.queued,1);assert.equal(db.state.last_uid,2);
});

test('UIDVALIDITY reset rescans lookback while Message-ID prevents duplicate ingestion',async()=>{
  const db=memoryDb();await pollMailbox(db,'user',settings,fakeImap([fixture(1)],{validity:100}));
  const reset=await pollMailbox(db,'user',settings,fakeImap([fixture(1)],{validity:101}));
  assert.equal(reset.duplicates,1);assert.equal(reset.queued,0);assert.equal(db.events.size,1);
  assert.match(db.state.uid_validity,/:101$/);
});

test('IMAP batches are bounded and remaining messages are processed on the next poll',async()=>{
  const db=memoryDb();const messages=Array.from({length:102},(_,i)=>fixture(i+1));
  const first=await pollMailbox(db,'user',settings,fakeImap(messages));
  assert.equal(first.fetched,100);assert.equal(first.has_more,true);assert.equal(db.state.last_uid,100);
  const second=await pollMailbox(db,'user',settings,fakeImap(messages));
  assert.equal(second.fetched,2);assert.equal(db.state.last_uid,102);
});

test('a first-poll arrival after an empty search is not hidden by a newer UIDNEXT',async()=>{
  const db=memoryDb();const messages=[];
  await pollMailbox(db,'user',settings,fakeImap(messages,{afterSearch:client=>{messages.push(fixture(1));client.mailbox.uidNext=2;}}));
  assert.equal(db.state.last_uid,0);
  const next=await pollMailbox(db,'user',settings,fakeImap(messages));
  assert.equal(next.queued,1);
});

test('a rejected mailbox search does not advance the checkpoint',async()=>{
  const db=memoryDb();
  const result=await pollMailbox(db,'user',settings,fakeImap([fixture(1)],{searchResult:false}));
  assert.equal(result.connected,false);assert.equal(db.state.last_uid,0);assert.equal(result.queued,0);
});
