-- Created alongside the development database so `docker compose up` produces a
-- ready environment. Integration tests truncate every table between cases, so
-- they must never share a database with anything a person is looking at.
CREATE DATABASE anyq_test;
GRANT ALL PRIVILEGES ON DATABASE anyq_test TO anyq;
