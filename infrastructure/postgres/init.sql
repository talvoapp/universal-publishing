-- ============================================================
-- Universal Publishing Platform - PostgreSQL Initialization
-- Runs once on first container start (docker-entrypoint-initdb.d)
-- ============================================================

-- ------------------------------------------------------------
-- 1. CREATE LOGICAL DATABASES
-- ------------------------------------------------------------
-- (In docker-compose, POSTGRES_DB already creates the default `upp` DB.
--  This script creates the three additional per-service databases.)

CREATE DATABASE auth_db;
CREATE DATABASE marketplace_db;
CREATE DATABASE wallet_db;

-- ------------------------------------------------------------
-- 2. EXTENSIONS (installed per database)
-- ------------------------------------------------------------

\c auth_db
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

\c marketplace_db
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

\c wallet_db
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ------------------------------------------------------------
-- 3. ROLES & PERMISSIONS
-- ------------------------------------------------------------

-- Application role (used by services at runtime)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'upp_app') THEN
    CREATE ROLE upp_app LOGIN PASSWORD 'upp_app_password_dev';
  END IF;
END
$$;

-- Read-only role (for analytics / BI)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'upp_readonly') THEN
    CREATE ROLE upp_readonly LOGIN PASSWORD 'upp_readonly_password_dev';
  END IF;
END
$$;

-- Migrations role (owns schemas, DDL only)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'upp_migrator') THEN
    CREATE ROLE upp_migrator LOGIN PASSWORD 'upp_migrator_password_dev';
  END IF;
END
$$;

-- ------------------------------------------------------------
-- 4. GRANTS PER DATABASE
-- ------------------------------------------------------------

\c auth_db
GRANT CONNECT ON DATABASE auth_db TO upp_app, upp_readonly, upp_migrator;
GRANT USAGE ON SCHEMA public TO upp_app, upp_readonly, upp_migrator;
ALTER DEFAULT PRIVILEGES FOR ROLE upp_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO upp_app;
ALTER DEFAULT PRIVILEGES FOR ROLE upp_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO upp_app;
ALTER DEFAULT PRIVILEGES FOR ROLE upp_migrator IN SCHEMA public
  GRANT SELECT ON TABLES TO upp_readonly;

\c marketplace_db
GRANT CONNECT ON DATABASE marketplace_db TO upp_app, upp_readonly, upp_migrator;
GRANT USAGE ON SCHEMA public TO upp_app, upp_readonly, upp_migrator;
ALTER DEFAULT PRIVILEGES FOR ROLE upp_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO upp_app;
ALTER DEFAULT PRIVILEGES FOR ROLE upp_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO upp_app;
ALTER DEFAULT PRIVILEGES FOR ROLE upp_migrator IN SCHEMA public
  GRANT SELECT ON TABLES TO upp_readonly;

\c wallet_db
GRANT CONNECT ON DATABASE wallet_db TO upp_app, upp_readonly, upp_migrator;
GRANT USAGE ON SCHEMA public TO upp_app, upp_readonly, upp_migrator;
ALTER DEFAULT PRIVILEGES FOR ROLE upp_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO upp_app;
ALTER DEFAULT PRIVILEGES FOR ROLE upp_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO upp_app;
ALTER DEFAULT PRIVILEGES FOR ROLE upp_migrator IN SCHEMA public
  GRANT SELECT ON TABLES TO upp_readonly;

-- ------------------------------------------------------------
-- 5. SESSION / PERFORMANCE SETTINGS (per database defaults)
-- ------------------------------------------------------------

\c auth_db
ALTER DATABASE auth_db SET timezone TO 'UTC';
ALTER DATABASE auth_db SET statement_timeout TO '30s';
ALTER DATABASE auth_db SET idle_in_transaction_session_timeout TO '60s';

\c marketplace_db
ALTER DATABASE marketplace_db SET timezone TO 'UTC';
ALTER DATABASE marketplace_db SET statement_timeout TO '30s';
ALTER DATABASE marketplace_db SET idle_in_transaction_session_timeout TO '60s';

\c wallet_db
ALTER DATABASE wallet_db SET timezone TO 'UTC';
ALTER DATABASE wallet_db SET statement_timeout TO '30s';
ALTER DATABASE wallet_db SET idle_in_transaction_session_timeout TO '60s';
-- Wallet is more sensitive: stricter isolation level by default
ALTER DATABASE wallet_db SET default_transaction_isolation TO 'serializable';

-- ------------------------------------------------------------
-- 6. AUDIT / HEALTH LOG (in default `upp` DB)
-- ------------------------------------------------------------

\c upp

CREATE TABLE IF NOT EXISTS _db_init_log (
  id           BIGSERIAL PRIMARY KEY,
  event        TEXT        NOT NULL,
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  details      JSONB
);

INSERT INTO _db_init_log (event, details)
VALUES ('database_initialized', jsonb_build_object(
  'databases', jsonb_build_array('auth_db', 'marketplace_db', 'wallet_db'),
  'extensions', jsonb_build_array('uuid-ossp', 'pgcrypto', 'citext', 'pg_trgm'),
  'roles', jsonb_build_array('upp_app', 'upp_readonly', 'upp_migrator'),
  'postgres_version', version()
));

-- ------------------------------------------------------------
-- 7. VERIFY
-- ------------------------------------------------------------
\echo '============================================================'
\echo ' PostgreSQL initialization complete.'
\echo ' Databases: upp, auth_db, marketplace_db, wallet_db'
\echo ' Extensions: uuid-ossp, pgcrypto, citext, pg_trgm'
\echo ' Roles: upp_app, upp_readonly, upp_migrator'
\echo ' Run migrations: make migrate'
\echo '============================================================'