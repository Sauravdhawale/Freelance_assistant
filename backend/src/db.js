import pg from 'pg';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export function createDb(connectionString, options={}) {
  if (!connectionString) throw new Error('DATABASE_URL is required. Configure .env before starting.');
  const pool = new pg.Pool({ connectionString, max: options.max || 10, connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000 });
  pool.on('error', () => process.stderr.write('Database connection error. Check database health.\n'));
  return {
    query: (sql, values=[]) => pool.query(sql, values),
    transaction: async fn => {
      const c = await pool.connect();
      try { await c.query('BEGIN'); const result = await fn({query:(sql,values=[])=>c.query(sql,values)}); await c.query('COMMIT'); return result; }
      catch(e) { await c.query('ROLLBACK'); throw e; }
      finally { c.release(); }
    },
    close: () => pool.end()
  };
}
export async function migrate(db) {
  await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const directory = fileURLToPath(new URL('../migrations/', import.meta.url));
  for (const name of (await readdir(directory)).filter(n=>n.endsWith('.sql')).sort()) {
    if ((await db.query('SELECT version FROM schema_migrations WHERE version=$1',[name])).rows.length) continue;
    const sql = await readFile(`${directory}/${name}`, 'utf8');
    await db.transaction(async tx => { await tx.query(sql); await tx.query('INSERT INTO schema_migrations(version) VALUES($1)',[name]); });
  }
}
