-- Rollback for 20260806000036_ai_jobs_token_ledger_human_reviews.sql
-- Drops all three tables and their supporting function/triggers/policies
-- outright (this migration created them fresh, with zero call sites either
-- forward or back -- its own header). The three enum types are not
-- referenced by anything else in this schema, so they are dropped last,
-- after every table/column that could reference them is gone.

revoke select, insert on ai_jobs from service_role;
revoke select, insert on ai_token_ledger from service_role;
revoke select, insert on ai_human_reviews from service_role;
revoke select on ai_jobs from authenticated;
revoke select on ai_token_ledger from authenticated;
revoke select, update on ai_human_reviews from authenticated;

drop trigger if exists ai_human_reviews_no_delete on ai_human_reviews;
drop trigger if exists ai_human_reviews_restrict_update_trigger on ai_human_reviews;
drop trigger if exists ai_token_ledger_append_only on ai_token_ledger;
drop trigger if exists ai_jobs_append_only on ai_jobs;

drop policy if exists ai_human_reviews_decide on ai_human_reviews;
drop policy if exists ai_human_reviews_select on ai_human_reviews;
drop policy if exists ai_token_ledger_select on ai_token_ledger;
drop policy if exists ai_jobs_select on ai_jobs;

drop function if exists ai_human_reviews_restrict_update();

revoke execute on function can_read_ai_ledger(uuid) from authenticated;
drop function if exists can_read_ai_ledger(uuid);

drop table if exists ai_human_reviews;
drop table if exists ai_token_ledger;
drop table if exists ai_jobs;

drop type if exists ai_human_review_status;
drop type if exists ai_job_status;
drop type if exists ai_task_kind;
drop type if exists ai_provider;
