-- ============================================================================
-- 군대관리 v2 — GRANT hardening ROLLBACK (security-preserving)
-- 원칙: 예전의 과도한 권한을 자동 복구하지 않는다.
--   🚫 anon 에 어떤 권한도 복구하지 않는다(제품은 anon 으로 이 테이블을 쓰지 않음).
--   🚫 authenticated 의 DELETE/TRUNCATE/REFERENCES/TRIGGER 를 복구하지 않는다(제품 미사용).
--   ✅ 하드닝 후 admin 기능(load/save)이 실제로 깨진 경우에만, 최소 필요권한만 정확히 복구.
-- ⚠ 이 파일 자체는 실행/commit 하지 않음. 필요 시 승인 후 SQL Editor 에서 직접.
-- ============================================================================

-- (진단 우선) 먼저 무엇이 부족한지 확인(READ-ONLY):
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_name='military_module_data' and grantee='authenticated' order by privilege_type;
--   → SELECT/INSERT/UPDATE 가 모두 있어야 admin 정상. 하나라도 없으면 아래 최소복구.

-- (최소 복구) admin 기능이 깨졌을 때만: authenticated 의 SELECT/INSERT/UPDATE 만 복구.
begin;
grant select, insert, update on table public.military_module_data to authenticated;
commit;

-- 🚫 아래는 "예전 상태로 되돌리는" 위험한 복구 — 기본적으로 실행하지 않는다(보안 회귀).
--    정말 불가피한 장애에서 명시적 승인이 있을 때만, 그것도 필요한 항목만 개별 검토.
-- grant all privileges on table public.military_module_data to anon;          -- ❌ 금지(anon 원문 접근 재개방)
-- grant delete, truncate, references, trigger on table public.military_module_data to authenticated; -- ❌ 금지(미사용·과도)
