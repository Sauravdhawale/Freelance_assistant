import { createDb } from './db.js';
import { hashPassword } from './auth.js';
const db=createDb(process.env.DATABASE_URL);
try {
  const password=process.env.ADMIN_PASSWORD,email=process.env.ADMIN_EMAIL?.toLowerCase();
  if(!password||password.length<12||!email)throw new Error('Set ADMIN_EMAIL and a new ADMIN_PASSWORD of at least 12 characters in the private environment.');
  await db.transaction(async tx=>{
    const r=await tx.query('UPDATE users SET password_hash=$1 WHERE email=$2 RETURNING id',[await hashPassword(password),email]);
    if(!r.rows.length)throw new Error('Administrator was not found.');
    await tx.query('DELETE FROM sessions WHERE user_id=$1',[r.rows[0].id]);
  });process.stdout.write('Administrator password reset and existing sessions revoked.\n');
}finally{await db.close();}
