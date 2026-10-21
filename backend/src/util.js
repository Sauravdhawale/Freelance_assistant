import { randomUUID, createHash } from 'node:crypto';
export const uid = () => randomUUID();
export const hash = value => createHash('sha256').update(String(value)).digest('hex');
export class AppError extends Error { constructor(message,status=400,code='INVALID_REQUEST') { super(message); this.status=status; this.code=code; } }
export function assert(condition,message,status=400,code) { if(!condition) throw new AppError(message,status,code); }
export function localDate(date=new Date(),timezone='Asia/Kolkata') { return new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(date); }
export function cleanError(e) { return e instanceof AppError ? e.message : 'Operation failed. Check the integration configuration and try again.'; }
export async function audit(db,user,action,entityType,entityId,details={}) { await db.query('INSERT INTO audit_log(id,user_id,action,entity_type,entity_id,details) VALUES($1,$2,$3,$4,$5,$6)',[uid(),user,action,entityType,entityId,JSON.stringify(details)]); }
export function nextAttempt(attempt,now=Date.now()) { return new Date(now+Math.min(3600000,30000*(2**Math.min(attempt,7)))).toISOString(); }
export function numbers(row,keys) { if(!row) return row; const result={...row}; for(const k of keys) if(result[k]!==null && result[k]!==undefined) result[k]=Number(result[k]); return result; }
export async function getPreferences(db,user) { const r=await db.query('SELECT config FROM user_preferences WHERE user_id=$1',[user]); assert(r.rows.length,'User preferences missing.',404); return r.rows[0].config; }
export async function requestJson(url,options={},fetcher=globalThis.fetch) {
  let response;
  try { response=await fetcher(url,{...options,signal:AbortSignal.timeout(35000),redirect:'error'}); }
  catch { throw new AppError('The provider did not confirm the request. Check its status before retrying.',503,'PROVIDER_UNCONFIRMED'); }
  if(!response.ok) {
    if([401,403].includes(response.status)) throw new AppError('The provider rejected authorization. Reconnect the integration or update the credential.',503,'INTEGRATION_AUTH');
    if(response.status===429) throw new AppError('The provider rate limit was reached. The task can be retried later.',503,'PROVIDER_RATE_LIMIT');
    throw new AppError(`The provider returned HTTP ${response.status}.`,503,'PROVIDER_ERROR');
  }
  return response.json();
}
