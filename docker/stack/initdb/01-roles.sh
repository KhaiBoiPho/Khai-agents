#!/bin/sh
# First start only: the application role and Docmost's role and database.
#
# `khai` owns the `khai` database but is neither superuser nor BYPASSRLS, so
# the row-level security policies the migrations install (FORCE ROW LEVEL
# SECURITY) bind the application too. Only `postgres` bypasses them, and the
# application never connects as `postgres`. CREATEROLE lets the gateway create
# each user's worker role (u_<id>); on PostgreSQL 16+ it reaches only roles
# `khai` created. Nobody connects to a database without an explicit grant.
set -eu
psql -v ON_ERROR_STOP=1 --username postgres --dbname postgres \
  -v app_password="$KHAI_PG_APP_PASSWORD" \
  -v docmost_password="$KHAI_PG_DOCMOST_PASSWORD" <<'SQL'
CREATE ROLE khai LOGIN NOSUPERUSER CREATEROLE NOBYPASSRLS PASSWORD :'app_password';
CREATE DATABASE khai OWNER khai;
CREATE ROLE docmost LOGIN NOSUPERUSER NOCREATEROLE NOBYPASSRLS PASSWORD :'docmost_password';
CREATE DATABASE docmost OWNER docmost;
REVOKE CONNECT, TEMPORARY ON DATABASE khai FROM PUBLIC;
REVOKE CONNECT, TEMPORARY ON DATABASE docmost FROM PUBLIC;
SQL
psql -v ON_ERROR_STOP=1 --username postgres --dbname khai <<'SQL'
REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO khai;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
SQL
