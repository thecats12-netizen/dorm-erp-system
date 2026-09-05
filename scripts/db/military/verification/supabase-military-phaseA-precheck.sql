-- ============================================================================
-- 군대관리 v2 2G — Phase A 실행 "전" precheck (READ-ONLY · 데이터/ PII 미출력)
-- 목적: Phase A additive SQL 을 적용하기 전 baseline 을 기록한다(적용 후 postcheck 와 대조).
-- 안전: SELECT only · mutation 없음 · JSONB 원문(data) 출력 금지.
-- 실행 위치: Supabase Dashboard → (Production 프로젝트) → SQL Editor. postgres 역할로 실행됨.
-- ============================================================================

-- (A) RLS 활성/강제 상태 — 기대: rls_enabled=true (Phase A 는 이 값을 바꾸지 않아야 함)
select c.relrowsecurity as rls_enabled, c.relforcerowsecurity as force_rls
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname='military_module_data';

-- (B) 현재 정책(이름/cmd/roles/qual/with_check) — 기대: broad 2개
--     military_module_data_admin_all(ALL,{authenticated}) + military_module_data_select(SELECT,{authenticated})
--     Phase A 후 이 2개가 "그대로" 유지되어야 함(추가/삭제/변경 없음).
select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname='public' and tablename='military_module_data'
order by cmd, policyname;

-- (C) Phase A 가 생성할 함수의 "사전" 존재 여부 — 최초 적용이면 대부분 미존재(정상)
select p.proname,
       to_regprocedure('public.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')') as signature,
       p.prosecdef as security_definer, pg_get_userbyid(p.proowner) as owner, p.proacl as execute_acl
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.proname in ('can_read_military_raw','get_military_module_for_current_user',
                    'mask_military_phone','mask_military_birth_date','mil_safe_array')
order by p.proname;

-- (D) Realtime publication 포함 여부 — 기대: 현 상태 기록(Phase A 는 이 값을 바꾸지 않아야 함)
select schemaname, tablename
from pg_publication_tables
where pubname='supabase_realtime' and schemaname='public' and tablename='military_module_data';

-- (E) row count 기준선(데이터 내용 아님 · 개수만) — Phase A 후 동일해야 함
select count(*) as military_row_count from public.military_module_data;

-- (F) profiles role 분포(개수만 · PII 아님) — helper 검증 참고용
select role, coalesce(is_active,false) as is_active, count(*) as n
from public.profiles group by role, coalesce(is_active,false) order by role, is_active;

-- ── 기대값 요약(수동 대조) ────────────────────────────────────────────────
--  (A) rls_enabled=true
--  (B) 정확히 2개(admin_all ALL, select SELECT) · 둘 다 tenant_id='default' · role predicate 없음
--  (C) 최초 적용이면 5개 함수 signature=null(미존재). 재적용이면 존재+owner=postgres+search_path=public
--  (D) 1행(이미 publication 포함) 또는 0행 — 어느 쪽이든 Phase A 후 "동일" 해야 함
--  (E) 이 값을 적어두고 postcheck 의 count 와 비교(변화=0 이어야 함)
