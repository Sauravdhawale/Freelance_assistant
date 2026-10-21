CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE users (
 id text PRIMARY KEY, email text NOT NULL UNIQUE, name text NOT NULL,
 password_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sessions (
 token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 csrf_token text NOT NULL, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE user_preferences (
 user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 config jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE platform_integrations (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 platform text NOT NULL CHECK (platform IN ('upwork','fiverr','peopleperhour','guru')),
 enabled boolean NOT NULL DEFAULT true, mode text NOT NULL DEFAULT 'email_import',
 status text NOT NULL DEFAULT 'not_connected', last_sync_at timestamptz, error text,
 UNIQUE (user_id, platform)
);
CREATE TABLE jobs (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 platform text NOT NULL CHECK (platform IN ('upwork','fiverr','peopleperhour','guru')),
 external_id text NOT NULL, title text NOT NULL, description text NOT NULL,
 url text NOT NULL, budget_min numeric(14,2), budget_max numeric(14,2),
 currency text NOT NULL DEFAULT 'USD', work_type text NOT NULL DEFAULT 'unknown',
 experience_level text NOT NULL DEFAULT 'unknown', client_name text,
 posted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 full_description boolean NOT NULL DEFAULT false, kind text NOT NULL DEFAULT 'job' CHECK (kind IN ('job','inquiry')),
 source text NOT NULL DEFAULT 'user_import', score smallint CHECK (score BETWEEN 0 AND 100),
 score_source text, score_reason text, status text NOT NULL DEFAULT 'new',
 score_attempts integer NOT NULL DEFAULT 0, next_score_at timestamptz NOT NULL DEFAULT now(),
 generation_lock_until timestamptz, generation_lock_token text, revision integer NOT NULL DEFAULT 0,
 UNIQUE (user_id,platform,external_id), UNIQUE (user_id,platform,url), UNIQUE(id,user_id)
);
CREATE INDEX jobs_rank ON jobs(user_id,status,score DESC,posted_at DESC);
CREATE INDEX jobs_recent ON jobs(user_id,created_at DESC);
CREATE TABLE job_skills (
 job_id text NOT NULL REFERENCES jobs(id) ON DELETE CASCADE, skill text NOT NULL,
 PRIMARY KEY(job_id,skill)
);
CREATE TABLE proposal_templates (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name text NOT NULL, body text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE proposals (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 job_id text NOT NULL UNIQUE, body text NOT NULL, suggested_price numeric(14,2),
 currency text NOT NULL DEFAULT 'USD', delivery_days integer, generator text NOT NULL,
 review_required boolean NOT NULL DEFAULT true, reviewed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(job_id,user_id) REFERENCES jobs(id,user_id) ON DELETE CASCADE,
 UNIQUE(id,user_id)
);
CREATE TABLE applications (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 job_id text NOT NULL UNIQUE, proposal_id text NOT NULL,
 status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','awaiting_submission','submitted','interview','information_requested','negotiation','rejected','offer','closed','submission_unknown')),
 submitted_at timestamptz, confirmation text, method text, spend_amount numeric(12,2) NOT NULL DEFAULT 0,
 last_reply_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(job_id,user_id) REFERENCES jobs(id,user_id) ON DELETE CASCADE,
 FOREIGN KEY(proposal_id,user_id) REFERENCES proposals(id,user_id), UNIQUE(id,user_id)
);
CREATE INDEX applications_status ON applications(user_id,status,submitted_at);
CREATE TABLE conversations (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 platform text NOT NULL, external_id text NOT NULL, url text, application_id text,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,platform,external_id), UNIQUE(id,user_id),
 FOREIGN KEY(application_id,user_id) REFERENCES applications(id,user_id)
);
CREATE TABLE client_messages (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 conversation_id text NOT NULL, platform text NOT NULL, external_id text NOT NULL,
 client_name text, body text NOT NULL, classification text NOT NULL,
 classification_source text NOT NULL, received_at timestamptz NOT NULL,
 draft_response text, draft_generator text, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,platform,external_id), FOREIGN KEY(conversation_id,user_id) REFERENCES conversations(id,user_id) ON DELETE CASCADE
);
CREATE INDEX messages_recent ON client_messages(user_id,received_at DESC);
CREATE TABLE notification_logs (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 event_key text NOT NULL, channel text NOT NULL CHECK (channel IN ('email','telegram')),
 payload jsonb NOT NULL, status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','failed','disconnected','unknown','cancelled')),
 attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(),
 last_error text, provider_id text, sent_at timestamptz, locked_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,event_key,channel)
);
CREATE INDEX notifications_queue ON notification_logs(status,next_attempt_at);
CREATE TABLE workflow_controls (
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE, name text NOT NULL,
 enabled boolean NOT NULL DEFAULT true, locked_until timestamptz, lock_owner text, PRIMARY KEY(user_id,name)
);
CREATE TABLE workflow_runs (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 workflow text NOT NULL, idempotency_key text NOT NULL, status text NOT NULL,
 started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz, summary jsonb,
 error text, retryable boolean NOT NULL DEFAULT false, UNIQUE(user_id,workflow,idempotency_key)
);
CREATE INDEX workflow_recent ON workflow_runs(user_id,started_at DESC);
CREATE TABLE audit_log (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 action text NOT NULL, entity_type text NOT NULL, entity_id text,
 details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_recent ON audit_log(user_id,created_at DESC);
CREATE TABLE daily_usage (
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE, local_date date NOT NULL,
 ai_calls integer NOT NULL DEFAULT 0, application_count integer NOT NULL DEFAULT 0,
 spend_amount numeric(12,2) NOT NULL DEFAULT 0, PRIMARY KEY(user_id,local_date)
);
CREATE TABLE mailbox_state (
 user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 uid_validity text, last_uid bigint NOT NULL DEFAULT 0, last_checked_at timestamptz, error text,
 poll_lock_until timestamptz, poll_lock_token text
);
CREATE TABLE email_events (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 source_id text NOT NULL, platform text, kind text NOT NULL, payload jsonb NOT NULL,
 status text NOT NULL DEFAULT 'pending', error text, attempts integer NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,source_id)
);
CREATE INDEX email_events_queue ON email_events(user_id,kind,status,next_attempt_at);
