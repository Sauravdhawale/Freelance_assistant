import { AppError, assert, hash } from '../util.js';
import upwork from './upwork.js';
import fiverr from './fiverr.js';
import peopleperhour from './peopleperhour.js';
import guru from './guru.js';

export const PLATFORM_ADAPTERS = Object.freeze({upwork, fiverr, peopleperhour, guru});
export const adapters = PLATFORM_ADAPTERS;
export const platformAdapters = PLATFORM_ADAPTERS;

export function platformForHostname(hostname) {
  const host = String(hostname || '').toLowerCase();
  if (host.length > 253 || host.split('.').some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return null;
  return Object.values(PLATFORM_ADAPTERS).find(adapter => adapter.domains.some(domain => host === domain || host.endsWith(`.${domain}`)))?.id || null;
}

/** Validate an original link without visiting the site or following redirects. */
export function canonicalPlatformUrl(value, platform) {
  assert(PLATFORM_ADAPTERS[platform], 'Choose a supported freelance platform.');
  assert(typeof value === 'string' && value.trim().length > 0 && value.length <= 4096, 'A platform URL is required (maximum 4096 characters).');
  // WHATWG URL normalizes controls/backslashes; reject those before parsing.
  assert(!/[\u0000-\u0020\u007f\\]/.test(value.trim()), 'The platform URL contains invalid characters.');
  let url;
  try { url = new URL(value.trim()); } catch { throw new AppError('Enter a valid HTTPS platform URL.'); }
  assert(url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443'), 'Use an HTTPS platform URL without credentials or a custom port.');
  assert(platformForHostname(url.hostname) === platform, 'The URL must belong to the selected freelance platform.');
  if (PLATFORM_ADAPTERS[platform].isJobPath(url)) url.pathname = url.pathname.replace(/\/$/, '');
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (/^utm_/i.test(key) || ['referrer', 'tracking_id'].includes(key.toLowerCase())) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  return url.toString();
}

function textField(value, name, max, optional = false) {
  if (optional && (value === undefined || value === null || value === '')) return null;
  assert(typeof value === 'string', `${name} must be text.`);
  const text = (name === 'Description'
    ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '')
    : value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/[ \t]+/g, ' ')).trim();
  assert(text.length > 0 && text.length <= max, `${name} must contain between 1 and ${max} characters.`);
  return text;
}

function money(value, name) {
  if (value === undefined || value === null || value === '') return null;
  assert(typeof value === 'number' || (typeof value === 'string' && /^\d+(?:\.\d{1,2})?$/.test(value.trim())), `${name} must be a nonnegative number without currency symbols.`);
  const number = Number(value);
  assert(Number.isFinite(number) && number >= 0 && number <= 999999999999.99, `${name} is outside the supported range.`);
  return Math.round(number * 100) / 100;
}

function postingTimestamp(value) {
  if (value === undefined || value === null || value === '') return null;
  // PostgreSQL returns Date instances when existing jobs are edited internally.
  if (value instanceof Date) {
    assert(Number.isFinite(value.getTime()), 'Posting date is invalid.');
    return value.toISOString();
  }
  assert(typeof value === 'string', 'Posting date must be an ISO timestamp with a timezone.');
  const parts = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-](\d{2}):(\d{2}))$/i);
  assert(parts, 'Posting date must be an ISO timestamp with a timezone.');
  const [year,month,day,hour,minute,second] = parts.slice(1,7).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31,leap ? 29 : 28,31,30,31,30,31,31,30,31,30,31];
  assert(month >= 1 && month <= 12 && day >= 1 && day <= monthDays[month-1]
    && hour <= 23 && minute <= 59 && second <= 59
    && (parts[8] === undefined || (Number(parts[8]) <= 23 && Number(parts[9]) <= 59)), 'Posting date is invalid.');
  const timestamp = new Date(value);
  assert(Number.isFinite(timestamp.getTime()), 'Posting date is invalid.');
  return timestamp.toISOString();
}

export function normalizeJob(input) {
  assert(input && typeof input === 'object' && !Array.isArray(input), 'Each opportunity must be an object.');
  const platform = String(input.platform || '').trim().toLowerCase();
  assert(PLATFORM_ADAPTERS[platform], 'Choose upwork, fiverr, peopleperhour or guru.');
  const url = canonicalPlatformUrl(input.url || input.job_url, platform);
  const rawId = input.external_id ?? input.id;
  assert(rawId === undefined || rawId === null || typeof rawId === 'string' || (typeof rawId === 'number' && Number.isSafeInteger(rawId)), 'External ID must be text or a safe integer.');
  const externalId = rawId === undefined || rawId === null || rawId === ''
    ? `url:${hash(url)}` : textField(String(rawId), 'External ID', 256);
  const title = textField(input.title, 'Title', 300);
  const description = textField(input.description, 'Description', 30000);
  const budgetMin = money(input.budget_min ?? input.budget, 'Minimum budget');
  const budgetMax = money(input.budget_max ?? input.budget, 'Maximum budget');
  assert(budgetMin === null || budgetMax === null || budgetMax >= budgetMin, 'Maximum budget must be at least the minimum budget.');
  const currency = String(input.currency || 'USD').toUpperCase().trim();
  assert(/^[A-Z]{3}$/.test(currency), 'Currency must be a three-letter code such as USD.');
  const workAliases = {'fixed_price':'fixed','fixed-price':'fixed'};
  const experienceAliases = {'entry_level':'entry','entry-level':'entry'};
  const workRaw = String(input.work_type || 'unknown').trim().toLowerCase();
  const workType = workAliases[workRaw] || workRaw;
  const experienceRaw = String(input.experience_level || 'unknown').trim().toLowerCase();
  const experience = experienceAliases[experienceRaw] || experienceRaw;
  assert(['fixed','hourly','unknown'].includes(workType), 'Work type must be fixed, hourly or unknown.');
  assert(['entry','intermediate','expert','unknown'].includes(experience), 'Experience must be entry, intermediate, expert or unknown.');
  let rawSkills = input.skills ?? [];
  if (typeof rawSkills === 'string') rawSkills = rawSkills.split(/[,;]/).map(s => s.trim()).filter(Boolean);
  assert(Array.isArray(rawSkills) && rawSkills.length <= 100, 'Provide at most 100 skills.');
  const seen = new Set();
  const skills = rawSkills.map(skill => textField(skill, 'Skill', 100)).filter(skill => {
    const key = skill.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const postedAt = postingTimestamp(input.posted_at);
  let fullDescription = input.full_description ?? false;
  if (fullDescription === 'true') fullDescription = true;
  if (fullDescription === 'false') fullDescription = false;
  assert(typeof fullDescription === 'boolean', 'Full description must be true or false.');
  return {
    platform, external_id:externalId, title, description, url,
    budget_min:budgetMin, budget_max:budgetMax, currency,
    work_type:workType, experience_level:experience, skills,
    posted_at:postedAt, client_name:textField(input.client_name, 'Client name', 200, true),
    full_description:fullDescription, kind:platform === 'fiverr' ? 'inquiry' : 'job', source:'user_import'
  };
}

export function emailAddress(value) {
  if (value && typeof value === 'object') {
    if (!Array.isArray(value.value) || value.value.length !== 1) return null;
    return emailAddress(value.value[0]?.address);
  }
  if (typeof value !== 'string' || value.length > 1000 || /[\r\n]/.test(value)) return null;
  const wrapped = value.match(/^[^<>]*<([^<>]+)>\s*$/);
  const address = (wrapped ? wrapped[1] : value).trim().toLowerCase();
  return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(address) ? address : null;
}

function decodeEntities(value) {
  const named = {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};
  return String(value || '').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, code) => {
    if (code[0] !== '#') return named[code.toLowerCase()] ?? match;
    const number = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2),16) : parseInt(code.slice(1),10);
    return number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff) ? String.fromCodePoint(number) : '';
  });
}

export function plainEmailText(html) {
  return decodeEntities(String(html || '').slice(0,500000)
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\b[^>]*>|<\/(?:p|div|tr|h[1-6]|li)>/gi,'\n')
    .replace(/<[^>]*>/g,' '))
    .replace(/\u0000/g,'').replace(/[ \t]+/g,' ').replace(/\n\s*\n\s*\n/g,'\n\n').trim();
}

export function extractPlatformLinks(text, html, platform) {
  const result = new Map();
  const add = (candidate,label='') => {
    try {
      const url = canonicalPlatformUrl(decodeEntities(candidate), platform);
      const existing = result.get(url);
      if (!existing || (!existing.label && label)) result.set(url,{url,label:plainEmailText(label).slice(0,300)});
    } catch { /* Non-platform and tracking redirect links remain unvisited. */ }
  };
  for (const match of String(html || '').slice(0,500000).matchAll(/<a\b[^>]*\bhref\s*=\s*(["'])([^"']+)\1[^>]*>([\s\S]*?)<\/a\s*>/gi)) add(match[2],match[3]);
  for (const match of String(text || '').slice(0,100000).matchAll(/https:\/\/[^\s<>"']+/gi)) add(match[0].replace(/[.,;!?\])}]+$/,''));
  return [...result.values()];
}

const replySubject = /\b(?:new (?:client )?message|message from|new inquiry|sent you (?:a )?(?:new )?(?:message|offer)|has replied|replied to (?:your|the)|interview invitation|invitation to interview|invited you to (?:interview|apply)|new (?:job )?offer)\b/i;
const jobSubject = /\b(?:new (?:freelance )?jobs?|job alerts?|job match(?:es)?|jobs matching|recommended jobs?|new projects?|project alerts?|projects matching|new opportunities|saved search|job digest|jobs for you|projects for you|daily jobs?)\b/i;
const ignoredSubject = /\b(?:newsletter|weekly tips|webinar|security alert|password|verification code|reset|support ticket|receipt|invoice|promotion|discount|sale ends|survey)\b/i;
const genericLinkLabel = /^(?:view|open|read|see|apply|learn)(?:\b|$)|^https?:|^click here$/i;

function inferClientName(subject) {
  const match = subject.match(/^(?:\[[^\]]+\]\s*)?(.{1,100}?) (?:has )?(?:sent you (?:a )?(?:message|offer)|replied to your)/i)
    || subject.match(/\b(?:new message|new inquiry) from[:\s]+(.{1,100})$/i);
  return match ? match[1].trim() : null;
}

/** Parse only notification content the user already received. This performs no network requests. */
export function parsePlatformEmail({from,subject='',text='',html='',messageId,date}) {
  const sender = emailAddress(from);
  const platform = sender ? platformForHostname(sender.split('@')[1]) : null;
  if (!platform) return null;
  const adapter = PLATFORM_ADAPTERS[platform];
  const title = String(subject).replace(/[\u0000-\u001f\u007f-\u009f]/g,' ').replace(/[ \t]+/g,' ').trim().slice(0,300);
  const ignored = reason => ({platform,kind:'ignored',items:[],reason});
  if (ignoredSubject.test(title)) return ignored('This notification is not an opportunity or client reply.');
  const body = (String(text || '').trim() || plainEmailText(html)).replace(/\u0000/g,'').slice(0,12000);
  const links = extractPlatformLinks(text,html,platform);
  const listingLinks = links.filter(link => adapter.isJobPath(new URL(link.url)));
  const conversationLinks = links.filter(link => adapter.isConversationPath(new URL(link.url)));
  if (replySubject.test(title)) {
    if (!body || (!conversationLinks.length && !listingLinks.length)) return ignored('The reply notification has no recognized original platform link.');
    const received = new Date(date);
    if (!date || !Number.isFinite(received.getTime())) return ignored('The reply notification has no valid timestamp.');
    const source = typeof messageId === 'string' && messageId.trim() ? messageId.trim() : [sender,title,received.toISOString(),body].join('\n');
    return {platform,kind:'reply',items:[{
      platform, external_id:`email:${hash(source)}`, body:body.slice(0,5000),
      received_at:received.toISOString(), conversation_url:conversationLinks[0]?.url || null,
      ...(listingLinks.length === 1 ? {job_url:listingLinks[0].url} : {}), client_name:inferClientName(title)
    }]};
  }
  if (platform === 'fiverr') return ignored('Fiverr notifications are inquiries, not conventional job applications.');
  if (!jobSubject.test(title) || !listingLinks.length) return ignored('No recognized job-alert subject and listing link were found.');
  const items = listingLinks.slice(0,50).map(link => {
    const informative = link.label && !genericLinkLabel.test(link.label);
    const jobTitle = informative ? link.label : listingLinks.length === 1 ? title : `${adapter.name} opportunity from email`;
    // A digest's full body is not a description of each individual job.
    const description = listingLinks.length === 1 && body ? body : `${jobTitle}\nPartial opportunity notice. Open the original listing and supply its full description before creating a proposal.`;
    const item = normalizeJob({platform,url:link.url,title:jobTitle,description,full_description:false,posted_at:null});
    item.source = 'email_alert';
    return item;
  });
  return {platform,kind:'job',items};
}
