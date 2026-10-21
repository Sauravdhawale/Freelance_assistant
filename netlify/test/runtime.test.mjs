import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {harness,makeDb} from '../../backend/test/helpers.js';
import {migrate} from '../../backend/src/db.js';
import {PostgresRateLimitStore} from '../../backend/src/rate-limit-store.js';
import {createWebHandler} from '../lib/express-adapter.mjs';
import {authorized} from '../lib/runtime.mjs';
import worker from '../functions/workflow-worker.mjs';
const context={ip:'198.51.100.42',requestId:'test-request',function:{name:'api'},site:{id:'local'},deploy:{id:'test'}};
test('Netlify web adapter preserves real login, secure cookie, session and CSRF protection',async()=>{
  const h=await harness();
  try {
    const handler=createWebHandler(h.app);
    const login=await handler(new Request('http://localhost:3000/api/auth/login',{method:'POST',headers:{'content-type':'application/json',origin:'http://localhost:3000'},body:JSON.stringify({email:h.env.ADMIN_EMAIL,password:h.env.ADMIN_PASSWORD})}),context);
    assert.equal(login.status,200);
    const cookie=login.headers.get('set-cookie');assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);
    const payload=await login.json();
    const headers={cookie:cookie.split(';')[0],origin:'http://localhost:3000','content-type':'application/json'};
    const me=await handler(new Request('http://localhost:3000/api/auth/me',{headers}),context);
    assert.equal(me.status,200);assert.equal((await me.json()).user.email,h.env.ADMIN_EMAIL);
    const denied=await handler(new Request('http://localhost:3000/api/preferences',{method:'PATCH',headers,body:JSON.stringify({min_budget:200})}),context);assert.equal(denied.status,403);
    headers['x-csrf-token']=payload.csrfToken;
    const saved=await handler(new Request('http://localhost:3000/api/preferences',{method:'PATCH',headers,body:JSON.stringify({min_budget:200})}),context);assert.equal(saved.status,200);assert.equal((await saved.json()).min_budget,200);
    const noSession=await handler(new Request('http://localhost:3000/api/jobs'),context);assert.equal(noSession.status,401);
  }finally{await h.close();}
});
test('forwarded client IP headers cannot spoof the Netlify context IP',async()=>{
  const app=express();app.get('/ip',(req,res)=>res.json({ip:req.ip}));
  const handler=createWebHandler(app);
  const result=await handler(new Request('https://example.test/ip',{headers:{'x-forwarded-for':'1.1.1.1','x-fa-client-ip':'8.8.8.8'}}),context);
  assert.equal((await result.json()).ip,context.ip);
});
test('rate limits are shared across serverless instances and expired windows reset',async()=>{
  const db=await makeDb();try{
    await migrate(db);const one=new PostgresRateLimitStore(db,'login'),two=new PostgresRateLimitStore(db,'login');one.init({windowMs:10000});two.init({windowMs:10000});
    assert.equal((await one.increment('same-ip')).totalHits,1);assert.equal((await two.increment('same-ip')).totalHits,2);
    await db.query("UPDATE request_limits SET reset_at=now()-interval '1 second'");assert.equal((await one.increment('same-ip')).totalHits,1);
  }finally{await db.close();}
});
test('background worker refuses missing or incorrect bearer authorization before database access',async()=>{
  const token='a'.repeat(64);assert.equal(authorized(new Request('https://example.test'),token),false);
  assert.equal(authorized(new Request('https://example.test',{headers:{authorization:`Bearer ${token}`}}),token),true);
  assert.equal(authorized(new Request('https://example.test',{headers:{authorization:'Bearer wrong'}}),token),false);
  await worker(new Request('https://example.test',{method:'POST',body:'not valid JSON'}));
});
