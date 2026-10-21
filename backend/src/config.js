export const PLATFORMS = ['upwork','fiverr','peopleperhour','guru'];
export const WORKFLOWS = ['discovery','proposals','replies','notifications','daily_report','retention'];
export const DEFAULT_PREFERENCES = {
  skills: ['HTML','CSS','JavaScript','React.js','Node.js','Express.js','WordPress','Website maintenance','SEO','Technical SEO','Digital marketing','B2B lead generation','Email marketing','ABM','Content syndication','Data analytics','SQL','Power BI','Reporting','Data entry','Data processing'],
  min_budget: 100, min_hourly_rate: 15, currency: 'USD', allow_unknown_budget: false,
  work_types: ['fixed','hourly'], experience_levels: ['entry','intermediate','expert','unknown'],
  min_score: 70, max_job_age_days: 14, max_daily_applications: 5, max_daily_spend: 0,
  hourly_rate: 25, default_delivery_days: 7, verified_profile: '', portfolio_items: [],
  auto_generate_proposals: false, ai_enabled: false, timezone: 'Asia/Kolkata',
  notify_email: false, notify_telegram: false, notification_email: '', telegram_chat_id: '',
  notification_excerpt: false, retention_days: 90
};
export function loadConfig(env=process.env) {
  const origin = env.APP_ORIGIN || 'http://localhost:3000';
  const parsed = new URL(origin);
  if (!['http:','https:'].includes(parsed.protocol) || parsed.pathname !== '/' || parsed.search || parsed.hash) throw new Error('APP_ORIGIN must be an HTTP(S) origin without a path.');
  if (!env.WORKFLOW_TOKEN || env.WORKFLOW_TOKEN.length < 32) throw new Error('WORKFLOW_TOKEN must contain at least 32 random characters.');
  const secure = env.COOKIE_SECURE === 'true';
  if (parsed.protocol === 'https:' && !secure) throw new Error('Set COOKIE_SECURE=true for HTTPS deployments.');
  if (parsed.protocol === 'http:' && !['localhost','127.0.0.1','[::1]'].includes(parsed.hostname)) throw new Error('Public deployments require an HTTPS APP_ORIGIN.');
  return {
    origin: parsed.origin, port: Number(env.PORT || 3000), secureCookie: secure, trustProxy: env.TRUST_PROXY==='1'?1:false,
    workflowToken: env.WORKFLOW_TOKEN, adminEmail: env.ADMIN_EMAIL, adminPassword: env.ADMIN_PASSWORD,
    adminName: env.ADMIN_NAME || 'Arkentech', databaseUrl: env.DATABASE_URL,
    openaiKey: env.OPENAI_API_KEY || '', openaiModel: env.OPENAI_MODEL || 'gpt-4.1-mini',
    aiDailyLimit: Math.max(0, Math.min(1000, Number(env.AI_DAILY_CALL_LIMIT || 50))),
    smtp: { host:env.SMTP_HOST, port:Number(env.SMTP_PORT||587), secure:env.SMTP_SECURE==='true', user:env.SMTP_USER, pass:env.SMTP_PASS, from:env.SMTP_FROM },
    notificationEmail: env.NOTIFICATION_EMAIL || '', telegramToken:env.TELEGRAM_BOT_TOKEN || '', telegramChatId:env.TELEGRAM_CHAT_ID || '',
    imap: {host:env.IMAP_HOST,port:Number(env.IMAP_PORT||993),secure:env.IMAP_TLS!=='false',user:env.IMAP_USER,pass:env.IMAP_PASS,mailbox:env.IMAP_MAILBOX||'INBOX',allowedSenders:(env.IMAP_ALLOWED_SENDERS||'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean),authServers:(env.IMAP_AUTH_SERVERS||'mx.google.com').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean),lookbackDays:Math.min(30,Math.max(1,Number(env.IMAP_LOOKBACK_DAYS||7)))}
  };
}
