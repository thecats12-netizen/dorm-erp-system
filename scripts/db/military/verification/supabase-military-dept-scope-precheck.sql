-- ============================================================================
-- 군대 custom-role 부서 범위 서버 강제 — 설계 확정용 PRECHECK (SELECT ONLY · 실행 무변경)
--   목적: 기존 sanitized RPC 를 "부서 필터"로 최소 확장하기 전, 현재 Production 구조를 원문으로 확정.
--   ⚠ CREATE/ALTER/DROP/DML/GRANT/POLICY/DO/EXECUTE 없음. 블록 단위 실행. PII 직접 select 금지.
-- ============================================================================

-- [M1] 현재 sanitized RPC 전체 원문(= 확장 기준 + rollback 원본). viewer projection 에 포함된
--   personnel 참조 배열(training/notices/reports/actionItems/calendar 등)을 전부 열거하기 위함.
select p.proname, pg_get_function_identity_arguments(p.oid) as args,
       r.rolname as owner, p.prosecdef as security_definer, p.proconfig as settings,
       pg_get_functiondef(p.oid) as definition
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner
 where n.nspname='public' and p.proname='get_military_module_for_current_user';

-- [M2] 확장이 재사용할 보조 함수 존재 확인(Phase A 배포분).
select fn, (to_regprocedure(fn) is not null) as exists
  from (values ('public.mil_safe_array(jsonb)'),
               ('public.mask_military_phone(text)'),
               ('public.mask_military_birth_date(text)'),
               ('public.can_read_military_raw()'),
               ('public.current_user_tenant_id()')) as t(fn)
 order by fn;

-- [M3] military_module_data RLS/정책 — raw SELECT 확대가 없는지(viewer 직접 raw 접근 차단 유지 확인).
select c.relname, c.relrowsecurity as rls_enabled, c.relforcerowsecurity as force_rls
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relname='military_module_data';
select pol.polname,
       case pol.polcmd when 'r' then 'SELECT' when 'a' then 'INSERT' when 'w' then 'UPDATE' when 'd' then 'DELETE' else pol.polcmd::text end as cmd,
       coalesce((select array_agg(rolname) from pg_roles where oid=any(pol.polroles)),'{public}') as roles,
       pg_get_expr(pol.polqual, pol.polrelid) as using_expr,
       pg_get_expr(pol.polwithcheck, pol.polrelid) as check_expr
  from pg_policy pol join pg_class c on c.oid=pol.polrelid join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relname='military_module_data'
 order by cmd, pol.polname;

-- [M4] military_module_data 실행 GRANT(anon SELECT 없어야 · authenticated 범위 확인).
select grantee, privilege_type
  from information_schema.role_table_grants
 where table_schema='public' and table_name='military_module_data'
 order by grantee, privilege_type;

-- [M5] custom_role_scopes 의 military_department 부서값 분포(개수/부서명 · 개인정보 아님).
--   기대: CMP, CVD 등. 이 값들이 militaryPersonnel[].unit 와 매칭되어야 필터가 동작.
select s.scope_value as unit, count(*) as scope_cnt
  from public.custom_role_scopes s
 where s.is_active and s.deleted_at is null and s.scope_type='military_department'
   and (s.valid_from is null or s.valid_from<=now()) and (s.valid_until is null or s.valid_until>=now())
 group by s.scope_value order by s.scope_value;

-- [M6] 실제 militaryPersonnel JSONB 의 unit 분포(부서명 · 개수만 · PII 미노출).
--   custom_role_scopes.military_department 값과 unit 표기가 정확히 일치하는지(대소문자/공백) 확인용.
select p->>'unit' as unit, count(*) as personnel_cnt
  from public.military_module_data d,
       lateral jsonb_array_elements(case when jsonb_typeof(d.data->'militaryPersonnel')='array'
                                         then d.data->'militaryPersonnel' else '[]'::jsonb end) p
 where d.tenant_id='default'
 group by p->>'unit' order by p->>'unit';

-- [M7] viewer + 활성 military_department scope 보유 사용자 수(필터 대상 · count only · PII 없음).
select count(distinct ucr.user_id) as viewer_with_dept_scope
  from public.user_custom_roles ucr
  join public.custom_roles r on r.id=ucr.custom_role_id
  join public.custom_role_scopes s on s.custom_role_id=r.id
  join public.profiles pr on pr.id=ucr.user_id
 where ucr.is_active and ucr.deleted_at is null and r.is_active and r.is_deleted=false and r.deleted_at is null
   and s.is_active and s.deleted_at is null and s.scope_type='military_department'
   and pr.role='viewer' and coalesce(pr.is_active,true);

-- [M8] JSONB 내 personnel 참조 키 존재 여부(연관 레코드 필터 대상 열거).
--   기대 true 인 배열은 apply 에서 personnelId(s) 기준으로 함께 필터해야 함.
select
  jsonb_typeof(d.data->'militaryPersonnel')       as personnel,
  jsonb_typeof(d.data->'militaryTrainingRecords') as training,
  jsonb_typeof(d.data->'militaryActionItems')     as action_items,
  jsonb_typeof(d.data->'militaryNotices')         as notices,
  jsonb_typeof(d.data->'militaryCalendar')        as calendar,
  jsonb_typeof(d.data->'militaryReports')         as reports
  from public.military_module_data d where d.tenant_id='default';
