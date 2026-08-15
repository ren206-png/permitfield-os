-- Rollback for 20260806000010_ai_findings_rejected.sql
-- No policies were created (default-deny table) -- just the table and its
-- implicit index.

drop table if exists ai_findings_rejected;
