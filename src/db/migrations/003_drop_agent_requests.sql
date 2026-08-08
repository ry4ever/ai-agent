-- Migration 003: Drop the unused agent_requests table
--
-- agent_requests was created in 001 for per-agent request analytics, but its
-- only writer (recordAgentRequest) was never called and nothing reads the
-- table — revenue_daily already derives unique_agents from transactions.
-- Drop the dead table (its indexes go with it).

DROP TABLE IF EXISTS agent_requests;
