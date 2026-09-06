-- ============================================================================
-- resource-aware APPLY 선행 검증 — PRECHECK (SELECT ONLY · 실행해도 무변경)
--   목적: apply 전에 (1) 선행 helper 존재 (2) 기존 정책/함수 drift (3) 대상 테이블/RLS
--         (4) 신규 정책명 미충돌 (5) custom role 유효 사용자/legacy 현황 을 확인.
--   ⚠ 조회만. CREATE/ALTER/DROP/DML/GRANT/POLICY/DO/EXECUTE 없음. 블록 단위 실행.
-- ============================================================================

-- [P1] apply 가 의존하는 선행 helper 가 모두 존재하는가(하나라도 없으면 apply 중단).
--   기대: 아래 8개 모두 exists=true.
select fn, (to_regprocedure(fn) is not null) as exists
  from (values
    ('public.crp_user_has_permission(text)'),
    ('public.current_user_tenant_id()'),
    ('public.is_exam_admin()'),
    ('public.exam_is_admin(uuid)'),
    ('public.exam_is_viewer_all(uuid)'),
    ('public.exam_scope_readable(uuid,uuid)'),
    ('public.exam_scope_allows(uuid,uuid,text)'),
    ('public.can_read_exam_master()')
  ) as t(fn)
 order by fn;

-- [P2] 이미 신규 helper 가 존재하는지(재적용/충돌 여부). 기대: 최초 적용이면 셋 다 false.
select fn, (to_regprocedure(fn) is not null) as already_exists
  from (values ('public.exam_custom_menu_ok(text,text)'),
               ('public.exam_custom_process_ok(uuid,text)'),
               ('public.exam_has_any_custom_perm()')) as t(fn);

-- [P2b] can_read_exam_master() 의미 재확인(v2 SELECT 게이트 설계 근거).
--   기대: "활성 profiles 로그인 사용자면 broad read" 구조(admin/viewer/role 판정 아님).
--   → 이 원문이 그대로면 v2 게이트(비-custom 은 broad read 유지) 설계가 유효.
select pg_get_functiondef(p.oid) as can_read_exam_master_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='can_read_exam_master';

-- [P3] 재사용 대상 함수 원문 drift 확인 — audit [A] 캡처본과 육안 대조.
--   특히 crp_user_has_permission / exam_scope_readable / exam_scope_allows / exam_role_of.
select p.proname, pg_get_function_identity_arguments(p.oid) as args,
       p.prosecdef as security_definer, p.proconfig as settings,
       pg_get_functiondef(p.oid) as definition
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public'
   and p.proname in ('crp_user_has_permission','exam_scope_readable','exam_scope_allows',
                     'exam_role_of','is_exam_admin','exam_is_admin','exam_is_viewer_all',
                     'can_read_exam_master','current_user_tenant_id')
 order by p.proname;

-- [P4] 대상 7 테이블 RLS 활성 + process_id 보유(apply 전제와 일치해야 함).
select c.relname as table_name, c.relrowsecurity as rls_enabled, c.relforcerowsecurity as force_rls,
       exists (select 1 from pg_attribute a where a.attrelid=c.oid and a.attname='process_id' and not a.attisdropped) as has_process_id
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind='r'
   and c.relname in ('exam_personnel','exam_applications','pm_certifications','dm_certifications',
                     'exam_annual_targets','exam_monthly_results','exam_results')
 order by c.relname;

-- [P5] 현재 정책 목록 + permissive/restrictive 구분(apply 가 추가할 이름과 충돌 없는지).
--   기대: exam_cr_restrict_*/exam_cr_custom_select 는 아직 없음. exam_master_*/exam_scope_* 는 존재.
select c.relname as table_name, pol.polname,
       case when pol.polpermissive then 'PERMISSIVE' else 'RESTRICTIVE' end as kind,
       case pol.polcmd when 'r' then 'SELECT' when 'a' then 'INSERT' when 'w' then 'UPDATE' when 'd' then 'DELETE' else pol.polcmd::text end as cmd
  from pg_policy pol join pg_class c on c.oid=pol.polrelid join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public'
   and c.relname in ('exam_personnel','exam_applications','pm_certifications','dm_certifications',
                     'exam_annual_targets','exam_monthly_results','exam_results')
 order by c.relname, cmd, kind, pol.polname;

-- [P6] exam_results ↔ exam_personnel FK(personnel_id) 존재 확인(간접 스코프 전제).
select con.conname, pg_get_constraintdef(con.oid) as definition
  from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relname='exam_results' and con.contype='f'
 order by con.conname;

-- [P7] custom role 유효 사용자 수(적용 시점 회귀 위험 평가 · PII 없음). 기대: 현재 0.
select count(distinct ucr.user_id) as valid_custom_users
  from public.user_custom_roles ucr
  join public.custom_roles r on r.id = ucr.custom_role_id
 where ucr.is_active and ucr.deleted_at is null
   and (ucr.valid_from is null or ucr.valid_from <= now())
   and (ucr.valid_until is null or ucr.valid_until >= now())
   and r.is_active and r.is_deleted = false and r.deleted_at is null;

-- [P8] legacy orphan process scope 존재(값 원문 미출력 · 개수만). helper 에서 자동 DENY 되므로 데이터 무변경.
select count(*) as legacy_non_uuid_process_scopes
  from public.custom_role_scopes s
 where s.is_active and s.deleted_at is null and s.scope_type='process'
   and s.scope_value <> 'all'
   and not exists (select 1 from public.exam_processes ep where ep.id::text = s.scope_value and ep.deleted_at is null);

-- [P9] exam 역할 분포(무회귀 확인용 · count only). 기대: admin/viewer 보존 대상.
select
  count(*) filter (where role='admin'  and coalesce(is_active,true)) as admin_cnt,
  count(*) filter (where role='viewer' and coalesce(is_active,true)) as viewer_cnt,
  count(*) filter (where exam_role is not null and coalesce(is_active,true)) as explicit_exam_role_cnt
  from public.profiles;

-- [P10] exam_results resource_tab='examApplications' 근거(읽기 전용).
--   기존 exam_results 정책(exam_master_*)의 with_check/using 표현식에 crp_user_has_permission('examApplications....')
--   가 박혀 있으면, 기존 권한 의미가 exam_results↔examApplications 임을 Production 원문이 증명한다.
--   (프론트 근거: examMasterService.ExamPersonnelChildTable 에 exam_results 포함 · migration 20260730000000 line58.)
select c.relname as table_name, pol.polname,
       case when pol.polpermissive then 'PERMISSIVE' else 'RESTRICTIVE' end as kind,
       case pol.polcmd when 'r' then 'SELECT' when 'a' then 'INSERT' when 'w' then 'UPDATE' when 'd' then 'DELETE' else pol.polcmd::text end as cmd,
       pg_get_expr(pol.polqual, pol.polrelid)      as using_expr,
       pg_get_expr(pol.polwithcheck, pol.polrelid) as check_expr
  from pg_policy pol
  join pg_class c on c.oid = pol.polrelid
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname = 'exam_results'
 order by cmd, pol.polname;
