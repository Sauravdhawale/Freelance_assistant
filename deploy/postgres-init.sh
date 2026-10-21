#!/bin/sh
set -eu
# PostgreSQL only invokes this file for a NEW, empty data volume.
# psql variables are SQL-literal quoted; passwords are never interpolated as SQL.
psql --username "$POSTGRES_USER" --dbname postgres --set ON_ERROR_STOP=1 \
  --set app_password="$APP_DB_PASSWORD" --set n8n_password="$N8N_DB_PASSWORD" <<'SQL'
CREATE ROLE freelance_app LOGIN PASSWORD :'app_password';
CREATE DATABASE freelance OWNER freelance_app;
REVOKE ALL ON DATABASE freelance FROM PUBLIC;
GRANT CONNECT ON DATABASE freelance TO freelance_app;
CREATE ROLE n8n_app LOGIN PASSWORD :'n8n_password';
CREATE DATABASE n8n OWNER n8n_app;
REVOKE ALL ON DATABASE n8n FROM PUBLIC;
GRANT CONNECT ON DATABASE n8n TO n8n_app;
SQL
