#!/bin/bash
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    SELECT 'CREATE DATABASE sentinel' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'sentinel')\gexec
    SELECT 'CREATE DATABASE capital' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'capital')\gexec
    SELECT 'CREATE DATABASE pipeline' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'pipeline')\gexec
EOSQL
