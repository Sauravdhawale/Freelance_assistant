// Shared counters survive cold starts and work across Netlify instances.
export class PostgresRateLimitStore {
  constructor(db,prefix) {this.db=db;this.prefix=prefix;this.localKeys=false;}
  init(options) {this.windowMs=options.windowMs;}
  async increment(key) {
    const result=await this.db.query(`INSERT INTO request_limits(bucket,hits,reset_at)
      VALUES($1,1,now()+($2 * interval '1 millisecond'))
      ON CONFLICT(bucket) DO UPDATE SET
        hits=CASE WHEN request_limits.reset_at<=now() THEN 1 ELSE request_limits.hits+1 END,
        reset_at=CASE WHEN request_limits.reset_at<=now() THEN excluded.reset_at ELSE request_limits.reset_at END
      RETURNING hits,reset_at`,[`${this.prefix}:${key}`,this.windowMs]);
    return {totalHits:result.rows[0].hits,resetTime:new Date(result.rows[0].reset_at)};
  }
  async decrement(key) {await this.db.query('UPDATE request_limits SET hits=GREATEST(0,hits-1) WHERE bucket=$1',[`${this.prefix}:${key}`]);}
  async resetKey(key) {await this.db.query('DELETE FROM request_limits WHERE bucket=$1',[`${this.prefix}:${key}`]);}
}
