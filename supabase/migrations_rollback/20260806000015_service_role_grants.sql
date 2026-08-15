-- Rollback for 20260806000015_service_role_grants.sql
-- Plain REVOKEs mirroring the forward file's GRANTs in reverse.

revoke insert on ai_findings_rejected from service_role;
revoke insert on audit_findings from service_role;
revoke select, insert on audits from service_role;
revoke select on jurisdiction_code_chunks from service_role;
revoke select on jurisdictions from service_role;
revoke select on permit_types from service_role;
revoke select, insert on extractions from service_role;
revoke select, update on application_documents from service_role;
revoke select, update on permit_applications from service_role;
