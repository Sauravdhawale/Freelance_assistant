import React, { useCallback, useContext, useEffect, useRef, useState, createContext } from 'react';
import {
  Activity, ArrowDownToLine, ArrowRight, ArrowUpRight, Bell, BriefcaseBusiness,
  CalendarDays, Check, CheckCheck, CheckCircle2, ChevronLeft, ChevronRight, CircleAlert,
  ClipboardList, Clock3, Copy, ExternalLink, FilePenLine, Filter, Gauge, Inbox,
  Layers3, Link2, LoaderCircle, LogOut, Menu, MessageSquare, MoreHorizontal,
  Pause, Play, Plus, RefreshCw, Save, Search, Send, Settings2, ShieldCheck,
  SlidersHorizontal, Sparkles, Target, Upload, UserRound, X,
} from 'lucide-react';
import { api, setCsrf } from './api.js';

const PLATFORM_NAMES = { upwork: 'Upwork', fiverr: 'Fiverr', peopleperhour: 'PeoplePerHour', guru: 'Guru' };
const NAV = [
  ['overview', 'Overview', Gauge, 'Workspace'],
  ['jobs', 'All Jobs', BriefcaseBusiness],
  ['recommended', 'Recommended Jobs', Target],
  ['applications', 'Applications', FilePenLine],
  ['messages', 'Client Replies', MessageSquare],
  ['interviews', 'Interviews & Offers', CalendarDays],
  ['templates', 'Proposal Templates', ClipboardList, 'Configuration'],
  ['integrations', 'Platform Integrations', Link2],
  ['notifications', 'Notification Settings', Bell],
  ['preferences', 'Skills & Preferences', SlidersHorizontal],
  ['logs', 'Automation Logs', Activity],
];
const HEADINGS = {
  overview: ['Your freelance workspace', 'A clear view of your opportunities, proposals, and conversations.'],
  jobs: ['All opportunities', 'Review opportunities from your authorized sources and imports.'],
  recommended: ['Recommended for you', 'Opportunities that meet your saved matching preferences.'],
  applications: ['Applications & proposals', 'Review your proposals and keep every submission accounted for.'],
  messages: ['Client replies', 'Stay close to your conversations. Response drafts always stay in your control.'],
  interviews: ['Interviews & offers', 'Follow the conversations that could become your next project.'],
  templates: ['Your proposal toolkit', 'Reusable starting points and Fiverr Gig drafts based on your own information.'],
  integrations: ['Platform integrations', 'See what each source can do and whether it has been connected.'],
  notifications: ['Notification settings', 'Choose how your assistant brings important updates to you.'],
  preferences: ['Skills & preferences', 'Tell your assistant what you offer and what a good opportunity looks like.'],
  logs: ['Automation & activity', 'Start or pause workflows, inspect results, and retry eligible failures.'],
};
const UI = createContext(null);
const human = value => String(value || 'Unknown').replaceAll('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
const platformName = value => PLATFORM_NAMES[value] || human(value);
const number = value => Number(value || 0).toLocaleString('en-IN');
function date(value, withTime = true) {
  if (!value || Number.isNaN(new Date(value).getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata',
    ...(withTime ? { hour: 'numeric', minute: '2-digit', hour12: true } : {}),
  }).format(new Date(value));
}
function money(value, currency = 'USD') {
  if (value === null || value === undefined || value === '') return 'Not specified';
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(value)); }
  catch { return `${value} ${currency}`; }
}
function safeURL(value) {
  try { const url = new URL(value); return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null; }
  catch { return null; }
}
function workflowNotice(name, result) {
  if (['failed', 'needs_setup'].includes(result?.status)) return { text: `${human(name)} ${human(result.status).toLowerCase()}: ${result.error || result.summary?.reason || 'Check the workflow log and integration settings.'}`, type: 'error' };
  if (result?.status === 'skipped') return { text: `${human(name)} skipped: ${result.summary?.reason || 'The workflow is paused or has no eligible work.'}`, type: 'success' };
  return { text: `${human(name)} ${result?.status === 'completed' ? 'completed' : 'run requested'}. Check the recorded result for details.`, type: 'success' };
}
function deliveryNotice(channel, result) {
  const delivery = result?.delivery || {};
  if (Number(delivery.sent) > 0) return { text: `The ${channel} test was accepted by the provider. Check your ${channel === 'email' ? 'inbox' : 'Telegram chat'}.`, type: 'success' };
  if (Number(delivery.unknown) > 0) return { text: `The ${channel} test delivery is uncertain. Check the destination and notification log before retrying.`, type: 'error' };
  return { text: `The ${channel} test was not delivered. ${Number(delivery.disconnected) > 0 ? 'Configure the connection and save the destination first.' : 'Check the notification log for the reported result.'}`, type: 'error' };
}
function OriginalLink({ href, children = 'Open original', className = '' }) {
  const url = safeURL(href);
  return url ? <a href={url} target="_blank" rel="noopener noreferrer" className={`text-link ${className}`}>{children}<ArrowUpRight size={15} /></a> : <span className="muted small">Original link unavailable</span>;
}
function Badge({ children, tone = 'neutral' }) { return <span className={`badge badge-${tone}`}>{children}</span>; }
function Status({ value }) {
  const good = ['submitted', 'sent', 'connected', 'succeeded', 'success', 'completed', 'interview_invitation', 'offer', 'job_offer', 'ready', 'import_ready', 'email_connected', 'interview'];
  const warn = ['awaiting_submission', 'needs_review', 'draft', 'negotiation', 'queued', 'pending', 'running', 'retrying', 'unverified', 'needs_setup'];
  const bad = ['failed', 'error', 'rejected', 'rejection', 'disconnected', 'blocked', 'not_connected'];
  return <Badge tone={good.includes(value) ? 'green' : warn.includes(value) ? 'amber' : bad.includes(value) ? 'red' : 'neutral'}>{human(value)}</Badge>;
}
function Platform({ value }) { return <span className={`platform platform-${value}`}><span className="platform-dot" />{platformName(value)}</span>; }
function Button({ children, icon: Icon, loading = false, className = '', variant = 'secondary', ...props }) {
  return <button {...props} disabled={props.disabled || loading} className={`button button-${variant} ${className}`}>
    {loading ? <LoaderCircle size={16} className="spin" /> : Icon ? <Icon size={16} /> : null}{children}
  </button>;
}
function Field({ label, hint, children, className = '' }) {
  const generatedId = React.useId();
  const controlId = children.props.id || generatedId;
  const descriptionId = `${generatedId}-hint`;
  return <div className={`field ${className}`}><label className="field-label" htmlFor={controlId}>{label}</label>{React.cloneElement(children, { id: controlId, 'aria-describedby': hint ? [children.props['aria-describedby'], descriptionId].filter(Boolean).join(' ') : children.props['aria-describedby'] })}{hint && <span className="field-hint" id={descriptionId}>{hint}</span>}</div>;
}
function Toggle({ checked, onChange, disabled, label, hint }) {
  const hintId = React.useId();
  return <label className={`toggle-row ${disabled ? 'disabled' : ''}`}><span><strong>{label}</strong>{hint && <span className="field-hint" id={hintId}>{hint}</span>}</span>
    <input className="switch-input" type="checkbox" aria-label={label} aria-describedby={hint ? hintId : undefined} checked={!!checked} onChange={e => onChange(e.target.checked)} disabled={disabled} />
    <span className="switch" aria-hidden="true" />
  </label>;
}
function Notice({ children, tone = 'info' }) {
  return <div className={`notice notice-${tone}`}><CircleAlert size={18} /><div>{children}</div></div>;
}
function Empty({ title, children, icon: Icon = Inbox, action }) {
  return <div className="empty-state"><div className="empty-icon"><Icon size={27} /></div><h3>{title}</h3><p>{children}</p>{action}</div>;
}
function Loading() { return <div className="loading-state"><LoaderCircle className="spin" size={23} /><span>Loading your workspace…</span></div>; }
function ErrorPanel({ error, retry }) { return <div className="error-panel" role="alert"><CircleAlert /><div><strong>We couldn’t load this section</strong><p>{error}</p></div><Button icon={RefreshCw} onClick={retry}>Try again</Button></div>; }
function SectionHeading({ title, subtitle, children }) {
  return <div className="section-heading"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{children && <div className="section-actions">{children}</div>}</div>;
}
function useResource(loader, dependencies = []) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState(previous => ({ ...previous, loading: true, error: null }));
    loader(controller.signal).then(data => {
      if (!controller.signal.aborted) setState({ data, loading: false, error: null });
    }).catch(error => {
      if (!controller.signal.aborted) setState({ data: null, loading: false, error: error.message });
    });
    return () => controller.abort();
  }, [...dependencies, attempt]);
  return { ...state, retry: () => setAttempt(value => value + 1) };
}
function Resource({ resource, children }) {
  return resource.loading ? <Loading /> : resource.error ? <ErrorPanel error={resource.error} retry={resource.retry} /> : children(resource.data);
}
function Modal({ title, subtitle, children, onClose, wide = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    const before = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    const onKey = event => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab') {
        const elements = ref.current?.querySelectorAll('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]');
        if (!elements?.length) return;
        const first = elements[0], last = elements[elements.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { event.preventDefault(); last.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = before; document.removeEventListener('keydown', onKey); previous?.focus?.(); };
  }, []);
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={ref} className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
      <div className="modal-heading"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button type="button" className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={20} /></button></div>
      {children}
    </section>
  </div>;
}

function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault(); setError(''); setBusy(true);
    try { const result = await api('/auth/login', { method: 'POST', body: { email, password } }); onLogin(result.user); }
    catch (error) { setError(error.message); }
    finally { setBusy(false); }
  }
  return <div className="login-screen"><div className="login-art"><div className="brand"><div className="brand-mark"><Layers3 size={23} /></div><div>ARKENTECH<span>FREELANCE ASSISTANT</span></div></div>
    <div className="login-copy"><span className="eyebrow">YOUR NEXT PROJECT STARTS HERE</span><h1>Less searching.<br />More possibility.</h1><p>A focused workspace for opportunities, thoughtful proposals, and the conversations that matter.</p><div className="login-steps"><span><Search size={18} /> Discover</span><span><FilePenLine size={18} /> Prepare</span><span><MessageSquare size={18} /> Follow through</span></div></div>
    <p className="login-caption"><ShieldCheck size={16} /> Your workspace. Your credentials. Your decisions.</p>
  </div><div className="login-form-wrap"><div className="login-form"><span className="eyebrow">WELCOME BACK</span><h2>Sign in to your workspace</h2><p className="muted">Use the administrator account configured during setup.</p>
    <form onSubmit={submit}><Field label="Email address"><input type="email" name="email" autoComplete="username" placeholder="you@yourcompany.com" required value={email} onChange={e => setEmail(e.target.value)} /></Field>
      <Field label="Password"><input type="password" name="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></Field>
      {error && <Notice tone="error">{error}</Notice>}<Button type="submit" variant="primary" className="full-width" loading={busy}>Sign in<ArrowRight size={17} /></Button>
    </form><p className="login-help">First visit? Follow the project setup guide to create the administrator account. This app does not use your freelance platform password.</p>
  </div></div></div>;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const [bootError, setBootError] = useState('');
  const [view, setView] = useState(() => NAV.some(item => item[0] === location.hash.slice(1)) ? location.hash.slice(1) : 'overview');
  const [navOpen, setNavOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const [pending, setPending] = useState(new Set());
  const [toast, setToast] = useState(null);
  const [importType, setImportType] = useState(null);
  const toastTimer = useRef(null);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  const notify = useCallback((message, type = 'success') => {
    clearTimeout(toastTimer.current); setToast({ message, type });
    toastTimer.current = setTimeout(() => setToast(null), type === 'error' ? 12000 : 6000);
  }, []);
  useEffect(() => {
    let active = true;
    api('/auth/me').then(result => { if (active) setUser(result.user); }).catch(error => {
      if (active && error.status !== 401) setBootError(error.message);
    }).finally(() => { if (active) setChecking(false); });
    const expire = () => { setUser(null); setCsrf(''); notify('Your session has expired. Please sign in again.', 'error'); };
    window.addEventListener('session-expired', expire);
    return () => { active = false; clearTimeout(toastTimer.current); window.removeEventListener('session-expired', expire); };
  }, []);
  useEffect(() => {
    const change = () => { const key = location.hash.slice(1); setView(NAV.some(item => item[0] === key) ? key : 'overview'); setNavOpen(false); };
    window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change);
  }, []);
  const navigate = key => { location.hash = key; setView(key); setNavOpen(false); };
  async function mutate(key, action, message) {
    setPending(current => new Set([...current, key]));
    try {
      const result = await action();
      if (message) {
        const notice = typeof message === 'function' ? message(result) : message;
        if (typeof notice === 'object') notify(notice.text, notice.type || 'success');
        else notify(notice);
      }
      refresh(); return result ?? {};
    } catch (error) { notify(error.message, 'error'); return null; }
    finally { setPending(current => { const next = new Set(current); next.delete(key); return next; }); }
  }
  async function logout() {
    const result = await mutate('logout', () => api('/auth/logout', { method: 'POST', body: {} }));
    if (result) { setUser(null); setCsrf(''); }
  }
  if (checking) return <div className="boot-screen"><Layers3 size={35} /><Loading /></div>;
  if (bootError && !user) return <div className="boot-screen"><section className="panel setup-card"><div className="brand"><div className="brand-mark"><Layers3 size={23}/></div><div>ARKENTECH<span>FREELANCE ASSISTANT</span></div></div><span className="eyebrow">WORKSPACE SETUP</span><h1>Let’s connect your workspace.</h1><p>Your dashboard needs its database and administrator configuration before you can sign in.</p><Notice tone="error">{bootError}</Notice><ol><li>Connect a hosted PostgreSQL database.</li><li>Add the required server settings in your Netlify project.</li><li>Run the database setup command from the supplied project.</li><li>Redeploy, then return here to sign in.</li></ol><Button variant="primary" icon={RefreshCw} onClick={()=>location.reload()}>Check connection again</Button><p className="small muted">The included NETLIFY_SETUP.md walks through each step. No opportunities, applications, or messages are created during setup.</p></section></div>;
  if (!user) return <><Login onLogin={value => { setUser(value); refresh(); }} />{toast && <Toast toast={toast} close={() => setToast(null)} />}</>;
  const context = { revision, refresh, pending, mutate, notify, navigate, openImport: setImportType };
  return <UI.Provider value={context}><div className="app-shell">
    {navOpen && <button className="nav-scrim" aria-label="Close navigation" onClick={() => setNavOpen(false)} />}
    <aside className={`sidebar ${navOpen ? 'sidebar-open' : ''}`} aria-label="Main navigation"><a href="#overview" className="brand" onClick={() => navigate('overview')}><div className="brand-mark"><Layers3 size={22} /></div><div>ARKENTECH<span>FREELANCE ASSISTANT</span></div></a>
      <div className="workspace-label"><span className="workspace-avatar">A</span><span>Freelance workspace<small>Private workspace</small></span><ShieldCheck size={15} /></div>
      <nav>{NAV.map(([id, title, Icon, group]) => <React.Fragment key={id}>{group && <div className="nav-group">{group}</div>}<a href={`#${id}`} className={`nav-item ${id === view ? 'active' : ''}`} aria-current={id === view ? 'page' : undefined} onClick={() => navigate(id)}><Icon size={18} /><span>{title}</span>{id === view && <span className="active-dot" />}</a></React.Fragment>)}</nav>
      <div className="sidebar-footer"><span className="user-avatar"><UserRound size={18} /></span><span><strong>{user.name || 'Administrator'}</strong><small title={user.email}>{user.email}</small></span><button className="icon-button" aria-label="Sign out" title="Sign out" disabled={pending.has('logout')} onClick={logout}><LogOut size={18} /></button></div>
    </aside>
    <main className="main-content"><header className="topbar"><button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setNavOpen(true)}><Menu size={22} /></button><div className="breadcrumb">Workspace<ChevronRight size={13} /><strong>{NAV.find(item => item[0] === view)?.[1]}</strong></div><div className="topbar-right"><span className="topbar-date"><CalendarDays size={15} />{new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date())}</span><button className="icon-button" aria-label="Refresh data" title="Refresh data" onClick={refresh}><RefreshCw size={17} /></button><span className="topbar-avatar">{(user.name || user.email || 'A').slice(0, 1).toUpperCase()}</span></div></header>
      <div className="page-content"><div className="page-heading"><div><div className="eyebrow">{view === 'overview' ? 'OPPORTUNITY, ORGANIZED' : 'ARKENTECH WORKSPACE'}</div><h1>{HEADINGS[view][0]}</h1><p>{HEADINGS[view][1]}</p></div><div className="page-actions">{['overview', 'jobs', 'recommended'].includes(view) && <Button variant="primary" icon={Plus} onClick={() => setImportType('jobs')}>Import opportunities</Button>}{view === 'messages' && <Button variant="primary" icon={Upload} onClick={() => setImportType('messages')}>Import messages</Button>}</div></div>
        {view === 'overview' && <Overview />}
        {(view === 'jobs' || view === 'recommended') && <Jobs key={view} recommended={view === 'recommended'} />}
        {view === 'applications' && <Applications />}
        {(view === 'messages' || view === 'interviews') && <Messages interviews={view === 'interviews'} key={view} />}
        {view === 'templates' && <Templates />}
        {view === 'integrations' && <Integrations />}
        {(view === 'preferences' || view === 'notifications') && <Preferences notifications={view === 'notifications'} key={view} />}
        {view === 'logs' && <Logs />}
        <footer className="page-footer"><span>Arkentech · Freelance Assistant</span><span>Times shown in India Standard Time</span></footer>
      </div>
    </main>
    {importType && <ImportModal type={importType} onClose={() => setImportType(null)} />}
    {toast && <Toast toast={toast} close={() => setToast(null)} />}
  </div></UI.Provider>;
}
function Toast({ toast, close }) { return <div className={`toast toast-${toast.type}`} role={toast.type === 'error' ? 'alert' : 'status'}>{toast.type === 'error' ? <CircleAlert size={19} /> : <CheckCircle2 size={19} />}<span>{toast.message}</span><button className="icon-button" onClick={close} aria-label="Dismiss notification"><X size={17} /></button></div>; }

function Overview() {
  const ui = useContext(UI);
  const resource = useResource(signal => api('/overview', { signal }), [ui.revision]);
  return <Resource resource={resource}>{data => {
    const metrics = data.metrics || {};
    const cards = [
      ['New opportunities', metrics.new_jobs, BriefcaseBusiness, 'Today · IST', 'teal'],
      ['Shortlisted', metrics.shortlisted, Target, 'Matches your preferences', 'purple'],
      ['Applications submitted', metrics.submitted, Send, 'Today · recorded confirmations', 'blue'],
      ['Client replies', metrics.replies, MessageSquare, 'Today · imported messages', 'amber'],
    ];
    return <><div className="metrics-grid">{cards.map(([label, value, Icon, foot, color]) => <div className="metric-card" key={label}><div className="metric-top"><span>{label}</span><span className={`metric-icon ${color}`}><Icon size={18} /></span></div><strong className="metric-number">{number(value)}</strong><span className="metric-foot">{foot}</span></div>)}</div>
      <div className="overview-columns"><section className="panel"><SectionHeading title="Your next opportunities" subtitle="Recent matches, ranked by relevance"><button className="text-link" onClick={() => ui.navigate('recommended')}>View all<ArrowRight size={15} /></button></SectionHeading>
        {(data.recommended || []).length ? <div className="opportunity-list">{data.recommended.slice(0, 5).map(job => <div className="opportunity-row" key={job.id}><span className={`platform-letter platform-${job.platform}`}>{platformName(job.platform).slice(0, 1)}</span><div className="opportunity-main"><OriginalLink href={job.url}>{job.title}</OriginalLink><div className="inline-meta"><span>{platformName(job.platform)}</span><span>{money(job.budget_max ?? job.budget_min, job.currency)}</span><span>{human(job.work_type)}</span></div></div><Score job={job} /></div>)}</div> : <Empty title="Make room for your next project" icon={Target} action={<Button icon={Plus} onClick={() => ui.openImport('jobs')}>Import your first opportunity</Button>}>Connect a permitted notification source or import listings you are authorized to use. Your best matches will appear here.</Empty>}
      </section><section className="panel pipeline-panel"><SectionHeading title="In your pipeline" subtitle="What needs your attention" /><div className="pipeline-list">{[
        ['Awaiting review / submission', metrics.awaiting_submission, FilePenLine, 'applications'],
        ['Interview invitations', metrics.interviews, CalendarDays, 'interviews'],
        ['Offers', metrics.offers, CheckCheck, 'interviews'],
        ['Negotiations', metrics.negotiations, MessageSquare, 'interviews'],
        ['Awaiting follow-up', metrics.follow_up, Clock3, 'applications'],
        ['Rejections', metrics.rejections, Inbox, 'messages'],
      ].map(([label, value, Icon, route]) => <button className="pipeline-row" key={label} onClick={() => ui.navigate(route)}><Icon size={17} /><span>{label}</span><strong>{number(value)}</strong><ChevronRight size={15} /></button>)}</div><div className="pipeline-note"><ShieldCheck size={18} /><p>Only recorded submissions are counted as applications. Drafts remain ready for your review.</p></div></section></div>
      <div className="overview-columns"><section className="panel"><SectionHeading title="Automation controls" subtitle="Each workflow has its own switch"><button className="text-link" onClick={() => ui.navigate('logs')}>View activity<ArrowRight size={15} /></button></SectionHeading><WorkflowList items={data.workflows || []} compact /></section><section className="panel"><SectionHeading title="Source health" subtitle="Connection status, as reported by the backend" /><div className="source-list">{(data.integrations || []).map(item => <div className="source-row" key={item.platform}><Platform value={item.platform} /><Status value={item.status || 'disconnected'} /></div>)}</div>{!(data.integrations || []).length && <Empty title="No integrations reported">Refresh this page or check the backend logs.</Empty>}<div className="panel-bottom"><button className="text-link" onClick={() => ui.navigate('integrations')}>Manage integrations<ArrowRight size={15} /></button></div></section></div>
    </>;
  }}</Resource>;
}
function Score({ job }) { return job.score === null || job.score === undefined ? <Badge>Unscored</Badge> : <div className="score" title={job.score_reason || 'Relevance score'}><strong>{Math.round(job.score)}</strong><span>/ 100</span></div>; }
function Jobs({ recommended }) {
  const ui = useContext(UI);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [platform, setPlatform] = useState('');
  const [page, setPage] = useState(1);
  const [proposal, setProposal] = useState(null);
  const [editingJob, setEditingJob] = useState(null);
  const [templateId, setTemplateId] = useState('');
  const templateResource = useResource(signal => api('/templates', { signal }), [ui.revision]);
  useEffect(() => { const timer = setTimeout(() => { setSearch(query); setPage(1); }, 300); return () => clearTimeout(timer); }, [query]);
  const resource = useResource(signal => api(`/jobs?${new URLSearchParams({ recommended: String(recommended), q: search, platform, page: String(page) })}`, { signal }), [recommended, search, platform, page, ui.revision]);
  const generate = async job => {
    const result = await ui.mutate(`proposal-${job.id}`, () => api(`/jobs/${job.id}/proposal`, { method: 'POST', body: templateId ? { template_id: templateId } : {} }), 'Proposal prepared. Please review it before submission.');
    if (result?.proposal) setProposal({ ...result.proposal, job_title: job.title, job_url: job.url, platform: job.platform });
  };
  return <><div className="toolbar"><div className="search-field"><Search size={17} /><input aria-label="Search opportunities" placeholder="Search titles, skills, or descriptions…" value={query} onChange={e => setQuery(e.target.value)} /></div><div className="filter-control"><Filter size={15} /><select aria-label="Filter platform" value={platform} onChange={e => { setPlatform(e.target.value); setPage(1); }}><option value="">All platforms</option>{Object.entries(PLATFORM_NAMES).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></div>{(templateResource.data?.items || []).length > 0 && <div className="filter-control"><ClipboardList size={15} /><select aria-label="Proposal template" value={templateId} onChange={e => setTemplateId(e.target.value)}><option value="">Default proposal approach</option>{templateResource.data.items.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}</select></div>}<span className="toolbar-count">{resource.data ? `${number(resource.data.total ?? resource.data.items?.length)} opportunities` : 'Loading…'}</span></div>
    <Resource resource={resource}>{data => (data.items || []).length ? <><div className="job-list">{data.items.map(job => <article className="job-card" key={job.id}><div className="job-card-top"><div className="job-badges"><Platform value={job.platform} /><Badge>{job.kind === 'inquiry' ? 'Client inquiry' : human(job.work_type)}</Badge>{!job.full_description && <Badge tone="amber">Needs full description</Badge>}</div><Score job={job} /></div><h2><OriginalLink href={job.url}>{job.title}</OriginalLink></h2><p className="job-description">{job.description || 'No description was provided by this source.'}</p><div className="skill-tags">{(job.skills || []).slice(0, 10).map((skill, index) => <span key={`${skill}-${index}`}>{skill}</span>)}</div><div className="job-details"><span><BriefcaseBusiness size={15} />{job.budget_min !== null && job.budget_min !== undefined && job.budget_max && Number(job.budget_max) !== Number(job.budget_min) ? `${money(job.budget_min, job.currency)} – ${money(job.budget_max, job.currency)}` : money(job.budget_max ?? job.budget_min, job.currency)}{job.work_type === 'hourly' && (job.budget_max || job.budget_min) ? ' / hour' : ''}</span><span><CalendarDays size={15} />Posted {date(job.posted_at, false)}</span><span>{human(job.experience_level)}</span></div>
      {job.score_reason && <div className="match-reason"><Sparkles size={15} /><p><strong>{job.score_source === 'openai' || job.score_source === 'ai' ? 'AI match' : 'Rule-based match'}:</strong> {job.score_reason}</p></div>}
      <details className="description-details"><summary>Read full imported description</summary><p>{job.description || 'Description unavailable.'}</p></details>
      <div className="job-actions"><span className="small muted">{job.kind === 'inquiry' ? 'Manage Fiverr inquiry responses in Client Replies.' : 'Review your proposal before submitting on the platform.'}</span><div><Button icon={FilePenLine} onClick={() => setEditingJob(job)}>{job.full_description ? 'Edit details' : 'Add full scope'}</Button><Button icon={Target} loading={ui.pending.has(`score-${job.id}`)} onClick={() => ui.mutate(`score-${job.id}`, () => api(`/jobs/${job.id}/score`, { method: 'POST', body: {} }), 'Match score updated.')}>Score</Button><Button variant="primary" icon={Sparkles} loading={ui.pending.has(`proposal-${job.id}`)} disabled={job.kind === 'inquiry' || !job.full_description} title={!job.full_description ? 'Add the full job description first' : undefined} onClick={() => generate(job)}>Prepare proposal</Button></div></div></article>)}</div><div className="pagination"><span>Page {data.page || page} · {number(data.total ?? data.items.length)} results</span><div><Button icon={ChevronLeft} onClick={() => setPage(value => Math.max(1, value - 1))} disabled={page === 1}>Previous</Button><Button onClick={() => setPage(value => value + 1)} disabled={page * (data.pageSize || 20) >= (data.total ?? data.items.length)}>Next<ChevronRight size={16} /></Button></div></div></> : <section className="panel"><Empty icon={recommended ? Target : BriefcaseBusiness} title={recommended ? 'No matching opportunities yet' : 'No opportunities to show'} action={<Button icon={Plus} onClick={() => ui.openImport('jobs')}>Import opportunities</Button>}>{query || platform ? 'Try changing your search or platform filter.' : recommended ? 'Import opportunities and run matching. You can adjust your skills, budget, and relevance threshold in preferences.' : 'Use a permitted notification source or import your own authorized listings to get started.'}</Empty></section>}</Resource>
    {proposal && <ProposalModal proposal={proposal} onClose={() => setProposal(null)} />}
    {editingJob && <JobDetailsModal job={editingJob} onClose={() => setEditingJob(null)} />}
  </>;
}

function ImportModal({ type, onClose }) {
  const ui = useContext(UI);
  const messages = type === 'messages';
  const [mode, setMode] = useState(messages ? 'json' : 'single');
  const [content, setContent] = useState('');
  const [readError, setReadError] = useState('');
  const [single, setSingle] = useState({ platform: 'upwork', title: '', description: '', url: '', currency: 'USD', budget_min: '', budget_max: '', skills: '', work_type: 'fixed', experience_level: 'unknown', full_description: false, kind: 'job' });
  const update = (name, value) => setSingle(previous => ({ ...previous, [name]: value }));
  async function readFile(event) {
    const file = event.target.files?.[0]; if (!file) return;
    if (file.size > 1024 * 1024) { setReadError('Choose a file smaller than 1 MB. Split larger imports into batches.'); return; }
    try { setContent(await file.text()); setMode(file.name.toLowerCase().endsWith('.csv') && !messages ? 'csv' : 'json'); setReadError(''); }
    catch { setReadError('The file could not be read. Please try again.'); }
  }
  async function submit(event) {
    event.preventDefault(); setReadError('');
    let body;
    try {
      if (mode === 'single') body = { items: [{ ...single, budget_min: single.budget_min === '' ? null : Number(single.budget_min), budget_max: single.budget_max === '' ? null : Number(single.budget_max), skills: single.skills.split(',').map(value => value.trim()).filter(Boolean), kind: single.platform === 'fiverr' ? 'inquiry' : 'job' }] };
      else if (mode === 'csv') body = { csv: content };
      else { const parsed = JSON.parse(content); body = { items: Array.isArray(parsed) ? parsed : parsed.items || [parsed] }; }
    } catch { setReadError('The JSON is invalid. Use an array of records, one record, or an object with an items array.'); return; }
    const result = await ui.mutate(`import-${type}`, () => api(`/import/${type}`, { method: 'POST', body }), value => `Import complete: ${value.inserted ?? value.imported ?? 0} new records, ${value.duplicates ?? 0} duplicates skipped.`);
    if (result) onClose();
  }
  return <Modal title={messages ? 'Import client messages' : 'Import opportunities'} subtitle="Only import information you are authorized to use." onClose={onClose} wide><form onSubmit={submit}>
    <div className="tab-strip">{(messages ? ['json'] : ['single', 'json', 'csv']).map(item => <button type="button" className={mode === item ? 'selected' : ''} key={item} onClick={() => setMode(item)}>{item === 'single' ? 'Add one listing' : item.toUpperCase()}</button>)}</div>
    {mode === 'single' ? <div className="form-grid"><Field label="Platform"><select value={single.platform} onChange={e => update('platform', e.target.value)}>{Object.entries(PLATFORM_NAMES).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></Field><Field label="Work type"><select value={single.work_type} onChange={e => update('work_type', e.target.value)}><option value="fixed">Fixed-price project</option><option value="hourly">Hourly work</option></select></Field><Field label="Job or inquiry title" className="span-2"><input required maxLength={300} value={single.title} onChange={e => update('title', e.target.value)} /></Field><Field label="Original platform URL" className="span-2"><input type="url" required placeholder="https://www.upwork.com/…" value={single.url} onChange={e => update('url', e.target.value)} /></Field><Field label="Description" className="span-2"><textarea rows={6} required value={single.description} onChange={e => update('description', e.target.value)} /></Field><Field label="Minimum budget"><input type="number" min="0" step="0.01" value={single.budget_min} onChange={e => update('budget_min', e.target.value)} /></Field><Field label="Maximum budget"><input type="number" min="0" step="0.01" value={single.budget_max} onChange={e => update('budget_max', e.target.value)} /></Field><Field label="Currency"><input required minLength={3} maxLength={3} value={single.currency} onChange={e => update('currency', e.target.value.toUpperCase())} /></Field><Field label="Experience required"><select value={single.experience_level} onChange={e => update('experience_level', e.target.value)}><option value="unknown">Not specified</option><option value="entry">Entry level</option><option value="intermediate">Intermediate</option><option value="expert">Expert</option></select></Field><Field label="Skills, separated by commas" className="span-2"><input placeholder="WordPress, JavaScript, technical SEO" value={single.skills} onChange={e => update('skills', e.target.value)} /></Field><div className="span-2"><Toggle checked={single.full_description} onChange={value => update('full_description', value)} label="This contains the complete job description" hint="Proposals require complete scope information. An email preview alone may be incomplete." /></div>{single.platform === 'fiverr' && <div className="span-2"><Notice>Fiverr records are incoming inquiries. Import the conversation in Client Replies to prepare a response draft.</Notice></div>}</div> : <><label className="file-upload"><Upload size={20} /><span>Choose a {messages ? 'JSON' : 'JSON or CSV'} file<small>Up to 1 MB · or paste below</small></span><input type="file" accept={messages ? '.json,application/json' : '.csv,.json,text/csv,application/json'} onChange={readFile} /></label><Field label={mode === 'csv' ? 'CSV content' : 'JSON records'} hint={messages ? 'Required: platform, external_id, body, received_at, conversation_url. Optional: job_url and client_name.' : mode === 'csv' ? 'Use the documented import headers in examples/jobs.csv. Quote descriptions that contain commas.' : 'Required: platform, title, description, url. Add full_description: true only when you have the complete listing.'}><textarea className="code-input" rows={12} required value={content} onChange={e => setContent(e.target.value)} placeholder={mode === 'csv' ? 'platform,title,description,url,work_type,currency,budget_min,budget_max,skills,full_description' : '[\n  {\n    "platform": "upwork",\n    …\n  }\n]'} /></Field></>}
    {readError && <Notice tone="error">{readError}</Notice>}<div className="modal-footer"><Button type="button" onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" icon={Upload} loading={ui.pending.has(`import-${type}`)}>Import {messages ? 'messages' : 'opportunities'}</Button></div>
  </form></Modal>;
}

function Applications() {
  const ui = useContext(UI);
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const resource = useResource(async signal => {
    const [applications, proposals] = await Promise.all([api('/applications', { signal }), api('/proposals', { signal })]);
    const proposalList = proposals.items || [];
    const items = (applications.items || []).map(application => ({ ...application, proposal: application.proposal || proposalList.find(proposal => proposal.job_id === application.job_id) }));
    const attached = new Set(items.map(item => item.proposal?.id).filter(Boolean));
    for (const proposal of proposalList) if (!attached.has(proposal.id)) items.push({ id: null, job_id: proposal.job_id, job_title: proposal.job_title || 'Proposal awaiting review', job_url: proposal.job_url, platform: proposal.platform, status: proposal.status || 'draft', proposal });
    return { items };
  }, [ui.revision]);
  return <><div className="toolbar"><div className="filter-control"><Filter size={15} /><select aria-label="Filter applications by status" value={filter} onChange={e => setFilter(e.target.value)}><option value="">All statuses</option>{['draft', 'awaiting_submission', 'submitted', 'interview', 'negotiation', 'offer', 'rejected'].map(value => <option key={value} value={value}>{human(value)}</option>)}</select></div><span className="small muted">Manual submission in this build · no platform credits are purchased</span></div>
    <Resource resource={resource}>{data => {
      const items = (data.items || []).filter(item => !filter || item.status === filter);
      return items.length ? <div className="application-list">{items.map((item, index) => <section className="panel application-card" key={item.id || item.proposal?.id || index}><div className="application-heading"><div><div className="job-badges">{item.platform && <Platform value={item.platform} />}<Status value={item.status} /></div><h2>{item.job_title}</h2><div className="inline-meta"><span>{item.submitted_at ? `Submitted ${date(item.submitted_at)}` : 'Submission not recorded'}</span>{item.proposal && <span>{money(item.proposal.suggested_price, item.proposal.currency)} · {item.proposal.delivery_days || '—'} days suggested</span>}</div></div><OriginalLink href={item.job_url}>Open opportunity</OriginalLink></div>
        {item.proposal ? <><p className="proposal-preview">{item.proposal.body}</p><div className="application-footer"><span className="small muted">{['openai', 'ai'].includes(item.proposal.generator) ? 'AI-assisted draft' : 'Template-assisted draft'} · Verify scope, price, and every claim</span><div className="button-group"><Button icon={FilePenLine} onClick={() => setEditing({ ...item.proposal, job_title: item.job_title, job_url: item.job_url, platform: item.platform, locked: !!item.submitted_at })}>Review proposal</Button>{item.id && !item.submitted_at && item.status === 'awaiting_submission' && <Button variant="primary" icon={CheckCheck} onClick={() => setConfirming(item)}>Record submission</Button>}</div></div></> : <div className="application-footer"><span className="muted">No proposal text is attached.</span>{item.id && !item.submitted_at && item.status === 'awaiting_submission' && <Button icon={CheckCheck} onClick={() => setConfirming(item)}>Record submission</Button>}</div>}
      </section>)}</div> : <section className="panel"><Empty icon={FilePenLine} title={filter ? 'No applications with this status' : 'Your next proposal starts with a good match'} action={<Button onClick={() => ui.navigate('jobs')} icon={ArrowRight}>Browse opportunities</Button>}>Prepare a proposal from an opportunity. Review the draft here, submit it through the platform, and record the confirmation.</Empty></section>;
    }}</Resource>
    {editing && <ProposalModal proposal={editing} onClose={() => setEditing(null)} />}
    {confirming && <ConfirmationModal application={confirming} onClose={() => setConfirming(null)} />}
  </>;
}
function ProposalModal({ proposal, onClose }) {
  const ui = useContext(UI);
  const [body, setBody] = useState(proposal.body || '');
  const [price, setPrice] = useState(proposal.suggested_price ?? '');
  const [days, setDays] = useState(proposal.delivery_days || 7);
  const [reviewed, setReviewed] = useState(false);
  const payload = () => ({ body, suggested_price: price === '' ? null : Number(price), delivery_days: Number(days) });
  async function save(event) {
    event?.preventDefault();
    if (proposal.locked) return;
    await ui.mutate(`save-proposal-${proposal.id}`, () => api(`/proposals/${proposal.id}`, { method: 'PATCH', body: payload() }), 'Proposal changes saved.');
  }
  async function ready() {
    const result = await ui.mutate(`ready-proposal-${proposal.id}`, async () => {
      await api(`/proposals/${proposal.id}`, { method: 'PATCH', body: payload() });
      return api(`/proposals/${proposal.id}/ready`, { method: 'POST', body: {} });
    }, 'Proposal marked ready for manual submission.');
    if (result) onClose();
  }
  async function copy() {
    try { await navigator.clipboard.writeText(body); ui.notify('Proposal copied to your clipboard.'); }
    catch { ui.notify('Clipboard access is unavailable. Select the proposal text and copy it manually.', 'error'); }
  }
  return <Modal title={proposal.locked ? 'Recorded proposal' : 'Review your proposal'} subtitle={proposal.job_title} onClose={onClose} wide><form onSubmit={save}>
    <div className="modal-context"><Badge tone={proposal.locked ? 'green' : 'amber'}>{proposal.locked ? 'Submitted record · read only' : 'Draft for review'}</Badge><OriginalLink href={proposal.job_url}>Open original opportunity</OriginalLink></div>
    <Field label="Proposal text" hint={proposal.locked ? 'Submitted proposal text is retained as part of your application history.' : 'Confirm the scope and every claim. Add experience or portfolio details only when they are true.'}><textarea className="proposal-editor" rows={15} required minLength={20} readOnly={proposal.locked} value={body} onChange={e => { setBody(e.target.value); setReviewed(false); }} /></Field>
    <div className="form-grid"><Field label={`Suggested price (${proposal.currency || 'USD'})`}><input type="number" required min="0" step="0.01" readOnly={proposal.locked} value={price} onChange={e => { setPrice(e.target.value); setReviewed(false); }} /></Field><Field label="Suggested delivery (days)"><input type="number" required min="1" max="365" readOnly={proposal.locked} value={days} onChange={e => { setDays(e.target.value); setReviewed(false); }} /></Field></div>
    {!proposal.locked && <Toggle label="I have reviewed the claims, scope, price, and timeline" checked={reviewed} onChange={setReviewed} hint="Marking ready does not send this proposal to the client or platform." />}
    <div className="modal-footer split-footer"><Button type="button" icon={Copy} onClick={copy}>Copy text</Button>{proposal.locked ? <Button type="button" onClick={onClose}>Close</Button> : <div className="button-group"><Button type="submit" icon={Save} loading={ui.pending.has(`save-proposal-${proposal.id}`)}>Save changes</Button><Button type="button" variant="primary" icon={Check} disabled={!reviewed || body.trim().length < 20 || price === '' || Number(days) < 1} loading={ui.pending.has(`ready-proposal-${proposal.id}`)} onClick={ready}>Mark ready</Button></div>}</div>
  </form></Modal>;
}
function ConfirmationModal({ application, onClose }) {
  const ui = useContext(UI);
  const [confirmation, setConfirmation] = useState('');
  const [spend, setSpend] = useState(0);
  const [completed, setCompleted] = useState(false);
  async function submit(event) {
    event.preventDefault();
    const result = await ui.mutate(`confirm-${application.id}`, () => api(`/applications/${application.id}/confirm`, { method: 'POST', body: { confirmation, spend_amount: Number(spend) } }), 'Your completed submission has been recorded.');
    if (result) onClose();
  }
  return <Modal title="Record a completed submission" subtitle={application.job_title} onClose={onClose}><form onSubmit={submit}>
    <Notice>This records an application you have already submitted on the platform. It does not send an application or buy credits.</Notice>
    <div className="modal-context"><OriginalLink href={application.job_url}>Open the original opportunity</OriginalLink></div>
    <Field label="Submission confirmation" hint="Enter the platform confirmation reference, confirmation URL, or a clear note from your completed submission."><textarea rows={4} required minLength={10} value={confirmation} onChange={e => setConfirmation(e.target.value)} /></Field>
    <Field label="Amount already spent on this submission" hint="Use your configured spending currency. Enter 0 if no money was spent; no payment is made here."><input type="number" min="0" max="1000" step="0.01" required value={spend} onChange={e => setSpend(e.target.value)} /></Field>
    <Toggle checked={completed} onChange={setCompleted} label="I already submitted this application on the platform" />
    <div className="modal-footer"><Button type="button" onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" icon={CheckCheck} disabled={!completed} loading={ui.pending.has(`confirm-${application.id}`)}>Record submission</Button></div>
  </form></Modal>;
}

function Messages({ interviews = false }) {
  const ui = useContext(UI);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState(null);
  const resource = useResource(signal => api('/messages', { signal }), [ui.revision]);
  async function draft(message) {
    const result = await ui.mutate(`draft-${message.id}`, () => api(`/messages/${message.id}/draft`, { method: 'POST', body: {} }), 'Response draft prepared. No reply has been sent.');
    if (result) setSelected({ ...message, draft_response: result.draft_response });
  }
  return <>{!interviews && <div className="toolbar"><div className="filter-control"><Filter size={15} /><select aria-label="Filter reply classification" value={filter} onChange={e => setFilter(e.target.value)}><option value="">All message types</option>{['interview', 'information_requested', 'negotiation', 'rejected', 'general', 'offer'].map(value => <option key={value} value={value}>{human(value)}</option>)}</select></div><span className="small muted">Replies are never sent automatically</span></div>}
    <Resource resource={resource}>{data => {
      const list = (data.items || []).filter(message => interviews ? ['interview_invitation', 'interview', 'job_offer', 'offer', 'negotiation'].includes(message.classification) : !filter || message.classification === filter);
      return list.length ? <div className="message-list">{list.map(message => <article className="panel message-card" key={message.id}><div className="message-card-heading"><span className="message-avatar">{(message.client_name || platformName(message.platform)).slice(0, 1).toUpperCase()}</span><div><div className="message-title"><h2>{message.client_name || 'Client name unavailable'}</h2><Platform value={message.platform} /></div><p>{message.job_title || 'Not yet matched to an application'}</p></div><div className="message-timestamp"><Status value={message.classification} /><time>{date(message.received_at)}</time></div></div><p className="message-body">{message.body}</p><div className="message-card-footer"><OriginalLink href={message.conversation_url}>Open conversation</OriginalLink><div className="button-group">{message.draft_response && <Button icon={FilePenLine} onClick={() => setSelected(message)}>View draft</Button>}<Button icon={Sparkles} loading={ui.pending.has(`draft-${message.id}`)} onClick={() => draft(message)}>{message.draft_response ? 'Refresh draft' : 'Prepare response draft'}</Button></div></div></article>)}</div> : <section className="panel"><Empty title={interviews ? 'New possibilities will appear here' : 'Your conversation inbox is clear'} icon={interviews ? CalendarDays : MessageSquare} action={!interviews && <Button icon={Upload} onClick={() => ui.openImport('messages')}>Import client messages</Button>}>{interviews ? 'Interview invitations, offers, and negotiations are shown when they are received through a connected channel or an authorized import.' : filter ? 'There are no messages matching this classification.' : 'Connect your permitted platform notification emails, or import authorized messages. No client replies have been assumed.'}</Empty></section>;
    }}</Resource>{selected && <ReplyDraftModal message={selected} onClose={() => setSelected(null)} />}
  </>;
}
function ReplyDraftModal({ message, onClose }) {
  const ui = useContext(UI);
  const raw = typeof message.draft_response === 'object' ? message.draft_response?.body || message.draft_response?.text || '' : message.draft_response || '';
  const [draft, setDraft] = useState(raw);
  async function copy() {
    try { await navigator.clipboard.writeText(draft); ui.notify('Response draft copied.'); }
    catch { ui.notify('Select and copy the response text manually; clipboard access is unavailable.', 'error'); }
  }
  return <Modal title="Your response draft" subtitle={message.job_title || platformName(message.platform)} onClose={onClose} wide><Notice>Review and copy the draft, then reply in the original conversation. Edits in this dialog stay local until copied; nothing is sent automatically.</Notice><Field label="Draft response"><textarea className="proposal-editor" rows={12} value={draft} onChange={e => setDraft(e.target.value)} /></Field><div className="modal-footer split-footer"><OriginalLink href={message.conversation_url}>Open original conversation</OriginalLink><Button variant="primary" icon={Copy} onClick={copy}>Copy draft</Button></div></Modal>;
}

function JobDetailsModal({ job, onClose }) {
  const ui = useContext(UI);
  const [form, setForm] = useState({ description: job.description || '', budget_min: job.budget_min ?? '', budget_max: job.budget_max ?? '', currency: job.currency || 'USD', work_type: job.work_type || 'fixed', experience_level: job.experience_level || 'unknown', full_description: !!job.full_description, skills: (job.skills || []).join(', ') });
  const update = (name, value) => setForm(previous => ({ ...previous, [name]: value }));
  async function submit(event) {
    event.preventDefault();
    const payload = { ...form, budget_min: form.budget_min === '' ? null : Number(form.budget_min), budget_max: form.budget_max === '' ? null : Number(form.budget_max), skills: form.skills.split(',').map(value => value.trim()).filter(Boolean) };
    const result = await ui.mutate(`edit-job-${job.id}`, () => api(`/jobs/${job.id}`, { method: 'PATCH', body: payload }), 'Opportunity details updated. Run matching again if the scope changed.');
    if (result) onClose();
  }
  return <Modal title="Edit opportunity details" subtitle={job.title} onClose={onClose} wide><form onSubmit={submit}><div className="modal-context"><OriginalLink href={job.url}>Open the full listing</OriginalLink></div><Field label="Full authorized job description" hint="Paste the complete description from a listing you are authorized to access. The app will not fetch restricted pages."><textarea rows={10} required value={form.description} onChange={e => update('description', e.target.value)} /></Field><div className="form-grid"><Field label="Minimum budget"><input type="number" min="0" step="0.01" value={form.budget_min} onChange={e => update('budget_min', e.target.value)} /></Field><Field label="Maximum budget"><input type="number" min="0" step="0.01" value={form.budget_max} onChange={e => update('budget_max', e.target.value)} /></Field><Field label="Currency"><input required minLength={3} maxLength={3} value={form.currency} onChange={e => update('currency', e.target.value.toUpperCase())} /></Field><Field label="Work type"><select value={form.work_type} onChange={e => update('work_type', e.target.value)}><option value="fixed">Fixed price</option><option value="hourly">Hourly</option></select></Field><Field label="Experience required"><select value={form.experience_level} onChange={e => update('experience_level', e.target.value)}><option value="unknown">Not specified</option><option value="entry">Entry level</option><option value="intermediate">Intermediate</option><option value="expert">Expert</option></select></Field><Field label="Skills, separated by commas"><input value={form.skills} onChange={e => update('skills', e.target.value)} /></Field></div><Toggle checked={form.full_description} onChange={value => update('full_description', value)} label="I confirm this is the complete job description" hint="Keep this off if you only have a notification preview." /><div className="modal-footer"><Button type="button" onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" icon={Save} loading={ui.pending.has(`edit-job-${job.id}`)}>Save details</Button></div></form></Modal>;
}

function Integrations() {
  const ui = useContext(UI);
  const [checks, setChecks] = useState(null);
  const resource = useResource(signal => api('/integrations', { signal }), [ui.revision]);
  async function checkConnections() {
    const result = await ui.mutate('check-integrations', () => api('/integrations/check', { method: 'POST', body: {} }), 'Integration checks completed. Review the results below.');
    if (result?.checks) setChecks(result.checks);
  }
  return <><div className="integration-intro"><div><ShieldCheck size={21} /><p><strong>Built around authorized sources.</strong> Import listings and permitted platform notifications. Submission remains manual in this build until an approved platform method has been verified for your account.</p></div><Button icon={RefreshCw} loading={ui.pending.has('check-integrations')} onClick={checkConnections}>Check connections</Button></div>
    {checks && <section className="panel connection-results"><SectionHeading title="Latest connection check" subtitle="Use Notification Settings to test delivery to your saved destination." /><div className="connection-check-grid">{Object.entries(checks).map(([name, check]) => <div className="connection-check" key={name}><strong>{name === 'imap' ? 'Incoming email' : name === 'openai' ? 'OpenAI' : human(name)}</strong><Badge tone={check.connected ? 'green' : check.error || check.connected === false ? 'red' : 'neutral'}>{check.connected ? 'Connection verified' : !check.configured ? 'Not configured' : check.error || check.connected === false ? 'Check failed' : 'Configured · not verified'}</Badge>{check.error && <p className="error-text">{check.error}</p>}{check.model && <p>Model: {check.model}</p>}{check.last_checked_at && <p>Last mailbox check: {date(check.last_checked_at)}</p>}</div>)}</div></section>}
    <Resource resource={resource}>{data => <div className="integrations-grid">{(data.items || []).map(item => <section className="panel integration-card" key={item.platform}><div className="integration-card-top"><span className={`integration-logo platform-${item.platform}`}>{platformName(item.platform).slice(0, item.platform === 'peopleperhour' ? 1 : 2)}</span><Status value={item.status || 'disconnected'} /></div><h2>{platformName(item.platform)}</h2><p className="integration-description">{item.platform === 'fiverr' ? 'Incoming inquiries, client messages, response drafts, and Gig optimization.' : 'Authorized opportunity imports, permitted notification emails, and proposal preparation.'}</p><div className="capabilities"><div><Check size={15} /><span>{item.platform === 'fiverr' ? 'Inquiry and notification imports' : 'Job and notification imports'}</span></div><div><Check size={15} /><span>Reviewable {item.platform === 'fiverr' ? 'response' : 'proposal'} drafts</span></div><div><UserRound size={15} /><span>{item.platform === 'fiverr' ? 'Reply inside Fiverr' : 'Manual submission in this build'}</span></div></div>
      {item.notes && <p className="integration-notes">{typeof item.notes === 'string' ? item.notes : JSON.stringify(item.notes)}</p>}
      {item.error && <Notice tone="error">{item.error}</Notice>}
      <div className="integration-status"><span>Last source sync</span><strong>{item.last_sync_at ? date(item.last_sync_at) : 'No successful sync recorded'}</strong></div>
      <Toggle label="Enable this source" checked={item.enabled} disabled={ui.pending.has(`integration-${item.platform}`)} onChange={enabled => ui.mutate(`integration-${item.platform}`, () => api(`/integrations/${item.platform}`, { method: 'PATCH', body: { enabled } }), `${platformName(item.platform)} source ${enabled ? 'enabled' : 'paused'}.`)} hint="Enabling a source does not connect or authorize your platform account." />
      <div className="button-group"><Button icon={Upload} onClick={() => ui.openImport(item.platform === 'fiverr' ? 'messages' : 'jobs')}>{item.platform === 'fiverr' ? 'Import inquiry' : 'Import listings'}</Button>{item.platform === 'fiverr' && <Button icon={Sparkles} onClick={() => ui.navigate('templates')}>Gig tools</Button>}</div>
    </section>)}</div>}</Resource>
    <section className="panel setup-panel"><SectionHeading title="Connect your notifications" subtitle="A dedicated email folder keeps imports focused." /><div className="setup-steps"><div><span>01</span><h3>Choose permitted notifications</h3><p>Enable the job alerts or client-message emails offered by the platforms you use.</p></div><div><span>02</span><h3>Configure your email connection</h3><p>Follow the setup guide to connect a dedicated mailbox or folder and enter credentials securely in the server environment.</p></div><div><span>03</span><h3>Run a connection check</h3><p>Check the reported status here, then enable the discovery and reply-monitoring workflows.</p></div></div></section>
  </>;
}

function Preferences({ notifications }) {
  const ui = useContext(UI);
  const resource = useResource(signal => api('/preferences', { signal }), [ui.revision]);
  return <Resource resource={resource}>{data => <PreferenceForm initial={data.preferences || data} notifications={notifications} />}</Resource>;
}
function PreferenceForm({ initial, notifications }) {
  const ui = useContext(UI);
  const [form, setForm] = useState({
    skills: [], min_budget: 100, min_hourly_rate: 10, allow_unknown_budget: false, currency: 'USD', work_types: ['fixed', 'hourly'],
    experience_levels: ['entry', 'intermediate', 'expert', 'unknown'], min_score: 70, max_job_age_days: 14,
    max_daily_applications: 5, max_daily_spend: 0, hourly_rate: 25, default_delivery_days: 7,
    verified_profile: '', portfolio_items: [], auto_generate_proposals: false, ai_enabled: false,
    timezone: 'Asia/Kolkata', notify_email: false, notify_telegram: false, notification_email: '',
    telegram_chat_id: '', notification_excerpt: true, retention_days: 90, ...initial,
  });
  const [skillsText, setSkillsText] = useState((initial.skills || []).join(', '));
  const notificationSettingsDirty = ['notify_email', 'notify_telegram', 'notification_email', 'telegram_chat_id', 'notification_excerpt'].some(key => form[key] !== initial[key]);
  const update = (name, value) => setForm(previous => ({ ...previous, [name]: value }));
  const multi = (name, value) => update(name, (form[name] || []).includes(value) ? form[name].filter(item => item !== value) : [...(form[name] || []), value]);
  async function submit(event) {
    event.preventDefault();
    const keys = notifications ? ['notify_email', 'notify_telegram', 'notification_email', 'telegram_chat_id', 'notification_excerpt'] : ['min_budget', 'min_hourly_rate', 'allow_unknown_budget', 'currency', 'work_types', 'experience_levels', 'min_score', 'max_job_age_days', 'max_daily_applications', 'max_daily_spend', 'hourly_rate', 'default_delivery_days', 'verified_profile', 'portfolio_items', 'auto_generate_proposals', 'ai_enabled', 'retention_days'];
    const payload = Object.fromEntries(keys.map(key => [key, form[key]]));
    if (!notifications) payload.skills = skillsText.split(',').map(value => value.trim()).filter(Boolean);
    await ui.mutate('save-preferences', () => api('/preferences', { method: 'PATCH', body: payload }), 'Your preferences have been saved.');
  }
  return <form onSubmit={submit} className="settings-layout"><div className="settings-main">{notifications ? <>
    <section className="panel settings-panel"><SectionHeading title="Email notifications" subtitle="Send opportunity alerts, client replies, and your daily report to your inbox." /><Toggle label="Enable email notifications" checked={form.notify_email} onChange={value => update('notify_email', value)} /><Field label="Notification email address"><input type="email" required={form.notify_email} placeholder="you@yourcompany.com" value={form.notification_email || ''} onChange={e => update('notification_email', e.target.value)} /></Field><div className="test-row"><span className="field-hint">Configure the SMTP connection in the server environment. Tests use your saved settings.</span><Button type="button" icon={Send} disabled={notificationSettingsDirty} title={notificationSettingsDirty ? 'Save your settings before testing' : undefined} loading={ui.pending.has('test-email')} onClick={() => ui.mutate('test-email', () => api('/notifications/test', { method: 'POST', body: { channel: 'email' } }), value => deliveryNotice('email', value))}>Send test email</Button></div></section>
    <section className="panel settings-panel"><SectionHeading title="Telegram notifications" subtitle="Keep client updates close, wherever you are." /><Toggle label="Enable Telegram alerts" checked={form.notify_telegram} onChange={value => update('notify_telegram', value)} /><Field label="Your Telegram chat ID" hint="Start a chat with your bot first, then use your authorized chat ID. Keep the bot token in the server environment."><input type="text" required={form.notify_telegram} pattern="-?[0-9]+" placeholder="Your chat ID" value={form.telegram_chat_id || ''} onChange={e => update('telegram_chat_id', e.target.value)} /></Field><div className="test-row"><span className="field-hint">Save changes before testing a new destination.</span><Button type="button" icon={Send} disabled={notificationSettingsDirty} title={notificationSettingsDirty ? 'Save your settings before testing' : undefined} loading={ui.pending.has('test-telegram')} onClick={() => ui.mutate('test-telegram', () => api('/notifications/test', { method: 'POST', body: { channel: 'telegram' } }), value => deliveryNotice('telegram', value))}>Send test alert</Button></div></section>
    <section className="panel settings-panel"><SectionHeading title="Message privacy" /><Toggle label="Include a short message excerpt in notifications" checked={form.notification_excerpt} onChange={value => update('notification_excerpt', value)} hint="Turn this off to keep message content out of email and mobile notifications. Original conversation links remain available." /></section>
  </> : <>
    <section className="panel settings-panel"><SectionHeading title="Your skills & services" subtitle="Matching uses this list. Separate each skill with a comma." /><Field label="Skills"><textarea required rows={4} value={skillsText} onChange={e => setSkillsText(e.target.value)} placeholder="WordPress, React, SEO, B2B lead generation, SQL, Power BI" /></Field><div className="skill-tags">{skillsText.split(',').map(value => value.trim()).filter(Boolean).map((skill, index) => <span key={`${skill}-${index}`}>{skill}</span>)}</div><Field label="Verified professional profile" hint="Only include facts you can support. Proposals must not invent experience, client results, or qualifications."><textarea rows={6} value={form.verified_profile || ''} onChange={e => update('verified_profile', e.target.value)} placeholder="Describe the services you provide, your working process, and verified experience you want your drafts to use." /></Field></section>
    <section className="panel settings-panel"><SectionHeading title="Opportunity preferences" subtitle="Keep fixed-price budgets and hourly rates separate." /><div className="form-grid"><Field label="Preferred currency"><input required minLength={3} maxLength={3} value={form.currency} onChange={e => update('currency', e.target.value.toUpperCase())} /></Field><Field label="Minimum relevance score"><input type="number" min="0" max="100" required value={form.min_score} onChange={e => update('min_score', Number(e.target.value))} /></Field><Field label="Minimum fixed-price budget"><input type="number" min="0" step="0.01" required value={form.min_budget} onChange={e => update('min_budget', Number(e.target.value))} /></Field><Field label="Minimum hourly rate"><input type="number" min="0" step="0.01" required value={form.min_hourly_rate} onChange={e => update('min_hourly_rate', Number(e.target.value))} /></Field><Field label="Maximum job age (days)"><input type="number" min="1" max="90" required value={form.max_job_age_days} onChange={e => update('max_job_age_days', Number(e.target.value))} /></Field><Field label="Your suggested hourly rate"><input type="number" min="0.01" max="10000" step="0.01" required value={form.hourly_rate} onChange={e => update('hourly_rate', Number(e.target.value))} /></Field></div><Toggle checked={form.allow_unknown_budget} onChange={value => update('allow_unknown_budget', value)} label="Consider opportunities without a stated budget" hint="You will need to confirm the budget with the client." /><div className="field"><span className="field-label">Preferred work types</span><div className="choice-chips">{[['fixed', 'Fixed-price projects'], ['hourly', 'Hourly work']].map(([id, label]) => <label className={(form.work_types || []).includes(id) ? 'checked' : ''} key={id}><input type="checkbox" checked={(form.work_types || []).includes(id)} onChange={() => multi('work_types', id)} />{label}</label>)}</div></div><div className="field"><span className="field-label">Experience requirements to consider</span><div className="choice-chips">{[['entry', 'Entry'], ['intermediate', 'Intermediate'], ['expert', 'Expert'], ['unknown', 'Not specified']].map(([id, label]) => <label className={(form.experience_levels || []).includes(id) ? 'checked' : ''} key={id}><input type="checkbox" checked={(form.experience_levels || []).includes(id)} onChange={() => multi('experience_levels', id)} />{label}</label>)}</div></div></section>
    <section className="panel settings-panel"><SectionHeading title="Proposal controls" subtitle="Set a pace and budget you are comfortable with." /><div className="form-grid"><Field label="Daily application limit"><input type="number" min="0" max="50" required value={form.max_daily_applications} onChange={e => update('max_daily_applications', Number(e.target.value))} /></Field><Field label={`Daily platform spending limit (${form.currency})`} hint="A limit does not authorize buying credits or Connects. This build does not make purchases."><input type="number" min="0" max="1000" step="0.01" required value={form.max_daily_spend} onChange={e => update('max_daily_spend', Number(e.target.value))} /></Field><Field label="Default suggested delivery (days)"><input type="number" min="1" max="365" required value={form.default_delivery_days} onChange={e => update('default_delivery_days', Number(e.target.value))} /></Field><Field label="Message retention (days)"><input type="number" min="7" max="365" required value={form.retention_days} onChange={e => update('retention_days', Number(e.target.value))} /></Field></div><Toggle label="Use OpenAI for matching and drafts" checked={form.ai_enabled} onChange={value => update('ai_enabled', value)} hint="Requires an OpenAI API key in the server environment. Provider usage may be billable; your platform spending limit does not cap AI usage." /><Toggle label="Automatically prepare eligible proposals" checked={form.auto_generate_proposals} onChange={value => update('auto_generate_proposals', value)} hint="Only complete, eligible job descriptions are used. Generated drafts still await your review and manual submission." /></section>
    <section className="panel settings-panel"><SectionHeading title="Verified portfolio" subtitle="Add only work you are authorized to share."><Button type="button" icon={Plus} onClick={() => update('portfolio_items', [...(form.portfolio_items || []), { title: '', url: '', description: '' }])}>Add project</Button></SectionHeading>{(form.portfolio_items || []).length ? form.portfolio_items.map((item, index) => <div className="portfolio-entry" key={index}><div className="portfolio-heading"><strong>Project {index + 1}</strong><button className="icon-button" type="button" aria-label={`Remove portfolio project ${index + 1}`} onClick={() => update('portfolio_items', form.portfolio_items.filter((_, position) => position !== index))}><X size={17} /></button></div><div className="form-grid">{[['title', 'Project title'], ['url', 'Project URL'], ['description', 'Your contribution']].map(([key, label]) => <Field label={label} className={key === 'description' ? 'span-2' : ''} key={key}><input type={key === 'url' ? 'url' : 'text'} required value={item[key] || ''} onChange={e => update('portfolio_items', form.portfolio_items.map((project, position) => position === index ? { ...project, [key]: e.target.value } : project))} /></Field>)}</div></div>) : <p className="muted small">No portfolio projects added. Drafts will not assume any.</p>}</section>
  </>}
    <div className="settings-save"><span className="small muted">Your preferences apply to future workflow runs.</span><Button type="submit" variant="primary" icon={Save} loading={ui.pending.has('save-preferences')}>Save {notifications ? 'notification settings' : 'preferences'}</Button></div>
  </div><aside className="settings-aside"><section className="panel aside-card"><div className="aside-icon">{notifications ? <Clock3 size={24} /> : <ShieldCheck size={24} />}</div><h3>{notifications ? 'Your daily readout' : 'Accurate by design'}</h3>{notifications ? <><div className="report-time">8:00 <span>PM</span></div><Badge>Asia/Kolkata · IST</Badge><p>The included daily report covers discovered jobs, proposals, submissions, replies, interviews, offers, and integration errors.</p><p>Activate the daily-report workflow after configuring email. It also sends a concise report on days with no new opportunities.</p><button type="button" className="text-link" onClick={() => ui.navigate('logs')}>Open workflow controls<ArrowRight size={15} /></button></> : <><p>Good proposals start with accurate information. Keep your skills, profile, and portfolio specific and up to date.</p><div className="aside-rule"><Check size={16} />No invented credentials</div><div className="aside-rule"><Check size={16} />No automatic client replies</div><div className="aside-rule"><Check size={16} />No credit purchases</div><p>Scoring follows the source budget currency. Review jobs in other currencies before comparing amounts.</p></>}</section></aside></form>;
}

function Templates() {
  const ui = useContext(UI);
  const [editing, setEditing] = useState(null);
  const [showGig, setShowGig] = useState(false);
  const resource = useResource(signal => api('/templates', { signal }), [ui.revision]);
  return <><section className="toolkit-banner"><div className="toolkit-icon"><FilePenLine size={25} /></div><div><h2>A stronger starting point</h2><p>Build reusable proposal guidance from your own process and experience.</p></div><Button variant="primary" icon={Plus} onClick={() => setEditing({ name: '', body: '' })}>New template</Button></section><Resource resource={resource}>{data => (data.items || []).length ? <div className="templates-grid">{data.items.map(item => <article className="panel template-card" key={item.id}><div className="template-icon"><ClipboardList size={21} /></div><h2>{item.name}</h2><p>{item.body}</p><div className="template-footer"><span className="small muted">Reusable proposal guidance</span><Button icon={FilePenLine} onClick={() => setEditing(item)}>Edit</Button></div></article>)}</div> : <section className="panel"><Empty icon={ClipboardList} title="Give your proposals a useful starting point" action={<Button icon={Plus} onClick={() => setEditing({ name: '', body: '' })}>Create a template</Button>}>Save the approach and language you prefer. Individual proposals should still address the specific opportunity.</Empty></section>}</Resource><section className="panel fiverr-tool"><div className="integration-logo platform-fiverr">fi</div><div><div className="eyebrow">FIVERR TOOLS</div><h2>Improve your Gig, one detail at a time</h2><p>Prepare title, description, keyword, and package suggestions using your supplied service details. Review all output and publish changes yourself in Fiverr.</p></div><Button icon={Sparkles} onClick={() => setShowGig(true)}>Open Gig optimizer</Button></section>
    {editing && <TemplateModal template={editing} onClose={() => setEditing(null)} />}{showGig && <GigModal onClose={() => setShowGig(false)} />}
  </>;
}
function TemplateModal({ template, onClose }) {
  const ui = useContext(UI);
  const [name, setName] = useState(template.name || '');
  const [body, setBody] = useState(template.body || '');
  async function submit(event) {
    event.preventDefault();
    const result = await ui.mutate('save-template', () => api(template.id ? `/templates/${template.id}` : '/templates', { method: template.id ? 'PATCH' : 'POST', body: { name, body } }), 'Proposal template saved.');
    if (result) onClose();
  }
  return <Modal title={template.id ? 'Edit proposal template' : 'Create proposal template'} onClose={onClose} wide><form onSubmit={submit}><Field label="Template name"><input required maxLength={120} value={name} onChange={e => setName(e.target.value)} placeholder="WordPress discovery approach" /></Field><Field label="Template guidance" hint="Describe your preferred structure, tone, and approach. Include only verified experience."><textarea rows={13} required minLength={20} value={body} onChange={e => setBody(e.target.value)} /></Field><div className="modal-footer"><Button type="button" onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" icon={Save} loading={ui.pending.has('save-template')}>Save template</Button></div></form></Modal>;
}
function GigModal({ onClose }) {
  const ui = useContext(UI);
  const [form, setForm] = useState({ title: '', description: '', keywords: '', packages: '' });
  const [result, setResult] = useState(null);
  async function submit(event) {
    event.preventDefault();
    const response = await ui.mutate('optimize-gig', () => api('/gigs/optimize', { method: 'POST', body: { ...form, keywords: form.keywords.split(',').map(value => value.trim()).filter(Boolean) } }), value => value.note || 'Gig suggestions prepared. Review them before making changes in Fiverr.');
    if (response) setResult(response);
  }
  async function copy() {
    const content = `${result.title}\n\n${result.description}\n\nKeywords: ${(result.keywords || []).join(', ')}\n\nPackages:\n${typeof result.packages === 'string' ? result.packages : JSON.stringify(result.packages, null, 2)}`;
    try { await navigator.clipboard.writeText(content); ui.notify('Gig suggestions copied.'); }
    catch { ui.notify('Select and copy the suggestions manually; clipboard access is unavailable.', 'error'); }
  }
  return <Modal title="Fiverr Gig optimizer" subtitle="Prepare suggestions from the service information you provide." onClose={onClose} wide>{result ? <><div className="modal-context"><Badge tone="amber">{result.generator === 'template' ? 'Input retained · AI disabled' : 'Suggestions for your review'}</Badge><span className="small muted">{['openai', 'ai'].includes(result.generator) ? 'AI-assisted' : 'Template-assisted'}</span></div>{result.note && <Notice>{result.note}</Notice>}<div className="gig-result"><h3>{result.title}</h3><p>{result.description}</p><h4>Keywords</h4><div className="skill-tags">{(result.keywords || []).map((keyword, index) => <span key={index}>{keyword}</span>)}</div><h4>Suggested packages</h4><p>{typeof result.packages === 'string' ? result.packages : JSON.stringify(result.packages, null, 2)}</p></div><div className="modal-footer"><Button onClick={() => setResult(null)}>Edit input</Button><Button variant="primary" icon={Copy} onClick={copy}>Copy suggestions</Button></div></> : <form onSubmit={submit}>{[['title', 'Current Gig title', 1], ['description', 'Service description and verified details', 6], ['keywords', 'Current keywords, separated by commas', 1], ['packages', 'Your service packages, scope, pricing, and delivery times', 4]].map(([key, label, rows]) => <Field label={label} key={key}>{rows === 1 ? <input required={key === 'title'} minLength={key === 'title' ? 5 : undefined} maxLength={key === 'title' ? 160 : undefined} value={form[key]} onChange={e => setForm(previous => ({ ...previous, [key]: e.target.value }))} /> : <textarea required={key === 'description'} minLength={key === 'description' ? 20 : undefined} rows={rows} value={form[key]} onChange={e => setForm(previous => ({ ...previous, [key]: e.target.value }))} />}</Field>)}<Notice>Suggestions use your supplied details. They do not publish a Gig, contact clients, or imply guaranteed ranking or results.</Notice><div className="modal-footer"><Button type="button" onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" icon={Sparkles} loading={ui.pending.has('optimize-gig')}>Prepare suggestions</Button></div></form>}</Modal>;
}

function WorkflowList({ items, compact = false }) {
  const ui = useContext(UI);
  const descriptions = {
    discovery: 'Import permitted opportunities and score matches.',
    proposals: 'Prepare eligible drafts from complete job descriptions.',
    replies: 'Read permitted notification emails and classify replies.',
    notifications: 'Deliver queued email and Telegram notifications.',
    daily_report: 'Prepare your daily report for 8:00 PM IST.',
    retention: 'Remove message content past the configured retention period.',
  };
  return items.length ? <div className={`workflow-list ${compact ? 'compact' : ''}`}>{items.map(item => <div className="workflow-row" key={item.name}><div className={`workflow-icon ${item.enabled ? 'enabled' : ''}`}>{item.enabled ? <Activity size={17} /> : <Pause size={17} />}</div><div className="workflow-details"><h3>{human(item.name)}</h3><p>{compact ? item.last_run ? `Last run ${date(item.last_run.started_at || item.last_run)}` : 'No run recorded' : descriptions[item.name] || 'Configured automation workflow.'}</p>{!compact && item.last_run && <span className="small muted">Last run {date(item.last_run.started_at || item.last_run)}</span>}</div><Toggle checked={item.enabled} label={`${human(item.name)} enabled`} disabled={ui.pending.has(`workflow-${item.name}`)} onChange={enabled => ui.mutate(`workflow-${item.name}`, () => api(`/workflows/${item.name}`, { method: 'PATCH', body: { enabled } }), `${human(item.name)} ${enabled ? 'enabled' : 'paused'}.`)} />{!compact && <Button icon={Play} disabled={!item.enabled} loading={ui.pending.has(`run-${item.name}`)} onClick={() => ui.mutate(`run-${item.name}`, () => api(`/workflows/${item.name}/run`, { method: 'POST', body: {} }), value => workflowNotice(item.name, value))}>Run now</Button>}</div>)}</div> : <Empty title="No workflows reported" icon={Activity}>Check the backend connection and refresh.</Empty>;
}
function Logs() {
  const ui = useContext(UI);
  const [tab, setTab] = useState('runs');
  const resource = useResource(async signal => {
    const [workflows, logs] = await Promise.all([api('/workflows', { signal }), api('/logs', { signal })]);
    return { workflows: workflows.items || [], logs: logs.items || [], notifications: logs.notifications || [], importErrors: logs.import_errors || [], audit: logs.audit || [] };
  }, [ui.revision]);
  return <Resource resource={resource}>{data => <><section className="panel"><SectionHeading title="Workflow controls" subtitle="Enabled workflows can run when called by the configured scheduler." /><WorkflowList items={data.workflows} /></section><section className="panel activity-panel"><SectionHeading title="Activity history" subtitle="Inspect recorded outcomes and delivery attempts."><Button icon={RefreshCw} onClick={ui.refresh}>Refresh</Button></SectionHeading><div className="tab-strip"><button className={tab === 'runs' ? 'selected' : ''} onClick={() => setTab('runs')}>Workflow runs</button><button className={tab === 'notifications' ? 'selected' : ''} onClick={() => setTab('notifications')}>Notifications</button><button className={tab === 'imports' ? 'selected' : ''} onClick={() => setTab('imports')}>Import issues</button><button className={tab === 'audit' ? 'selected' : ''} onClick={() => setTab('audit')}>Action audit</button></div>
    {tab === 'imports' ? <ImportIssues items={data.importErrors} /> : tab === 'audit' ? <AuditHistory items={data.audit} /> : tab === 'runs' ? data.logs.length ? <div className="table-scroll"><table><thead><tr><th>Workflow</th><th>Status</th><th>Started</th><th>Result / error</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{data.logs.map(run => <tr key={run.id}><td><strong>{human(run.workflow)}</strong></td><td><Status value={run.status} /></td><td className="nowrap">{date(run.started_at)}</td><td className="log-detail">{run.error && <p className="error-text">{run.error}</p>}{run.summary && <details className="log-summary" open={!!run.error}><summary>Run details</summary><pre>{typeof run.summary === 'string' ? run.summary : JSON.stringify(run.summary, null, 2)}</pre></details>}{!run.error && !run.summary && 'No details recorded'}</td><td>{run.retryable && <Button icon={RefreshCw} loading={ui.pending.has(`retry-${run.id}`)} onClick={() => ui.mutate(`retry-${run.id}`, () => api(`/logs/${run.id}/retry`, { method: 'POST', body: {} }), value => workflowNotice(run.workflow, value))}>Retry</Button>}</td></tr>)}</tbody></table></div> : <Empty title="Your first workflow run will appear here" icon={Activity}>Enable a configured workflow and run it once, or wait for its n8n schedule.</Empty> : data.notifications.length ? <div className="table-scroll"><table><thead><tr><th>Channel</th><th>Status</th><th>Event</th><th>Time</th><th>Details</th></tr></thead><tbody>{data.notifications.map((item, index) => <tr key={item.id || index}><td>{human(item.channel)}</td><td><Status value={item.status} /></td><td>{human(item.event_type || item.kind || item.type || 'notification')}</td><td className="nowrap">{date(item.sent_at || item.created_at)}</td><td className="log-detail">{item.error || item.last_error || item.subject || item.event_key || '—'}</td></tr>)}</tbody></table></div> : <Empty title="No notification attempts yet" icon={Bell}>Save your email or Telegram settings and send a test to verify the connection.</Empty>}
    </section></>}</Resource>;
}
function ImportIssues({ items }) {
  const ui = useContext(UI);
  return items.length ? <div className="table-scroll"><table><thead><tr><th>Platform</th><th>Import type</th><th>Attempts</th><th>Issue</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{items.map(item => <tr key={item.id}><td>{platformName(item.platform)}</td><td>{human(item.kind)}</td><td>{number(item.attempts)}</td><td className="log-detail error-text">{item.error || 'No error details recorded.'}</td><td><Button onClick={() => ui.navigate('integrations')}>Check source</Button></td></tr>)}</tbody></table><div className="panel-bottom"><p className="small muted">Resolve the reported issue, then rerun discovery or reply monitoring. The backend retries eligible failed imports.</p></div></div> : <Empty title="No failed imports recorded" icon={CheckCircle2}>Source parsing and import failures will appear here when a workflow encounters one.</Empty>;
}
function AuditHistory({ items }) {
  return items.length ? <div className="table-scroll"><table><thead><tr><th>Action</th><th>Record type</th><th>Time</th><th>Details</th></tr></thead><tbody>{items.map(item => <tr key={item.id}><td><strong>{human(item.action)}</strong></td><td>{human(item.entity_type)}</td><td className="nowrap">{date(item.created_at)}</td><td className="log-detail">{item.details && Object.keys(item.details).length ? JSON.stringify(item.details) : '—'}</td></tr>)}</tbody></table></div> : <Empty title="No audit records reported" icon={ShieldCheck}>Application and configuration actions are recorded for review.</Empty>;
}
