-- Rollback for 20260806000011_grants.sql
-- Plain REVOKEs, mirroring the forward file's GRANTs line for line in
-- reverse. Revoke order carries no dependency constraint (unlike DROP), so
-- this simply undoes each grant.

revoke select on jurisdiction_code_chunks from authenticated;
revoke select on permit_form_fields from authenticated;
revoke select on permit_type_filings from authenticated;
revoke select on permit_types from authenticated;
revoke select on authorities from authenticated;
revoke select on jurisdictions from authenticated;

revoke select, insert, update, delete on audit_findings from authenticated;
revoke select, insert, update, delete on audits from authenticated;
revoke select, insert, update, delete on extractions from authenticated;

revoke select on jurisdictions from anon;
revoke select on permit_applications from anon;

revoke select, insert, delete on application_documents from authenticated;
revoke select, insert, update, delete on permit_applications from authenticated;
revoke select, insert, update, delete on contractors from authenticated;
revoke select, insert, update, delete on org_members from authenticated;
revoke select, insert, update, delete on organizations from authenticated;
