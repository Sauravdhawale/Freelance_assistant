import { scrypt as scryptCallback, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { DEFAULT_PREFERENCES, PLATFORMS, WORKFLOWS } from './config.js';
import { uid, hash, assert, audit, AppError } from './util.js';
const scrypt = promisify(scryptCallback);
export async function hashPassword(password) {
  const salt=randomBytes(16).toString('hex');
  return `${salt}:${(await scrypt(password,salt,64)).toString('hex')}`;
}
export async function verifyPassword(password,stored) {
  const [salt,encoded]=stored.split(':');
  const actual=await scrypt(password,salt,64);
  const expected=Buffer.from(encoded,'hex');
  return expected.length===actual.length && timingSafeEqual(actual,expected);
}
export async function bootstrap(db,config) {
  assert(config.adminEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.adminEmail),'Configure a valid ADMIN_EMAIL.',500);
  const email=config.adminEmail.trim().toLowerCase();
  let user=(await db.query('SELECT id,email,name FROM users WHERE email=$1',[email])).rows[0];
  if(user) return user;
  assert(config.adminPassword && config.adminPassword.length>=12,'Set ADMIN_PASSWORD to at least 12 characters before first startup.',500);
  assert(!(await db.query('SELECT id FROM users LIMIT 1')).rows.length,'This is a single-owner installation. Use the existing administrator email.',500);
  const id=uid(), passwordHash=await hashPassword(config.adminPassword);
  await db.transaction(async tx=>{
    await tx.query('INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4)',[id,email,config.adminName,passwordHash]);
    const preferences={...DEFAULT_PREFERENCES,notification_email:config.notificationEmail||'',telegram_chat_id:config.telegramChatId||'',notify_email:!!config.notificationEmail,notify_telegram:!!config.telegramChatId};
    await tx.query('INSERT INTO user_preferences(user_id,config) VALUES($1,$2)',[id,JSON.stringify(preferences)]);
    for(const platform of PLATFORMS) await tx.query('INSERT INTO platform_integrations(id,user_id,platform) VALUES($1,$2,$3)',[uid(),id,platform]);
    for(const name of WORKFLOWS) await tx.query('INSERT INTO workflow_controls(user_id,name) VALUES($1,$2)',[id,name]);
  });
  return {id,email,name:config.adminName};
}
function cookieValue(req) {
  const part=(req.headers.cookie||'').split(';').find(c=>c.trim().startsWith('fa_session='));
  return part ? part.trim().slice('fa_session='.length) : '';
}
export function cookieOptions(config) { return {httpOnly:true,secure:config.secureCookie,sameSite:'strict',path:'/',maxAge:8*60*60*1000}; }
export function authMiddleware(db) {
  return async (req,res,next)=>{
    try {
      const token=cookieValue(req);
      assert(/^[a-f0-9]{64}$/.test(token),'Please sign in.',401,'UNAUTHENTICATED');
      const r=await db.query('SELECT u.id,u.email,u.name,s.csrf_token FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()',[hash(token)]);
      assert(r.rows.length,'Your session expired. Please sign in again.',401,'UNAUTHENTICATED');
      req.user={id:r.rows[0].id,email:r.rows[0].email,name:r.rows[0].name};
      req.csrfToken=r.rows[0].csrf_token;
      if(!['GET','HEAD','OPTIONS'].includes(req.method)) assert(req.headers['x-csrf-token']===req.csrfToken,'Refresh the page and retry; the security token is missing or expired.',403,'CSRF');
      next();
    } catch(e) { next(e); }
  };
}
export function originGuard(config) {
  return (req,res,next)=>{
    if(!['GET','HEAD','OPTIONS'].includes(req.method) && req.headers.origin && req.headers.origin!==config.origin) return next(new AppError('Request origin is not allowed.',403,'ORIGIN'));
    next();
  };
}
export function internalAuth(config) {
  return (req,res,next)=>{
    const expected=Buffer.from(`Bearer ${config.workflowToken}`);
    const actual=Buffer.from(req.headers.authorization||'');
    if(actual.length!==expected.length || !timingSafeEqual(actual,expected)) return next(new AppError('Workflow authorization is required.',401,'UNAUTHENTICATED'));
    next();
  };
}
export async function login(db,config,req,res) {
  const {email,password}=req.body||{};
  assert(typeof email==='string' && email.length<=254 && typeof password==='string' && password.length<=256,'Enter an email and password.');
  const user=(await db.query('SELECT * FROM users WHERE email=$1',[email.trim().toLowerCase()])).rows[0];
  const dummy='0123456789abcdef0123456789abcdef:'+('00'.repeat(64));
  const valid=await verifyPassword(password,user?.password_hash||dummy);
  assert(user && valid,'Email or password is incorrect.',401,'LOGIN_FAILED');
  const token=randomBytes(32).toString('hex'),csrfToken=randomBytes(32).toString('hex');
  await db.query('INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,$4)',[hash(token),user.id,csrfToken,new Date(Date.now()+8*60*60*1000).toISOString()]);
  await audit(db,user.id,'login','session',null);
  res.cookie('fa_session',token,cookieOptions(config));
  res.json({user:{id:user.id,email:user.email,name:user.name},csrfToken});
}
export async function logout(db,config,req,res) {
  await db.query('DELETE FROM sessions WHERE token_hash=$1',[hash(cookieValue(req))]);
  res.clearCookie('fa_session',{...cookieOptions(config),maxAge:undefined});
  res.json({ok:true});
}
