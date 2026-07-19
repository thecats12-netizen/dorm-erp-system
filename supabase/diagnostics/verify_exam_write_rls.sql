-- ============================================================================
-- 시험 쓰기 RLS ↔ 사용자 정의 권한 정합 검증 (P0-3, 읽기 전용)
--   적용 전: insert/update 정책이 is_exam_admin() 단독 → custom 계정 저장 403.
--   적용 후: is_exam_admin() OR crp_user_has_permission('<tab>.create/update').
-- ============================================================================

-- [1] 선행 헬퍼 함수 존재 확인(없으면 20260722/20260723, 20260716 먼저 적용)
select
  to_regprocedure('public.crp_user_has_permission(text)') as crp_fn,
  to_regprocedure('public.is_exam_admin()')               as admin_fn,
  to_regprocedure('public.can_read_exam_master()')        as read_fn;
--  → 셋 다 non-null 이어야 함.

-- [2] 현재 exam_applications 의 insert/update 정책 정의(적용 여부 판단)
select polname, cmd,
       pg_get_expr(polqual, polrelid)      as using_expr,
       pg_get_expr(polwithcheck, polrelid) as check_expr
from pg_policy
where polrelid = 'public.exam_applications'::regclass
  and polname in ('exam_master_insert','exam_master_update')
order by polname;
--  → check_expr 에 crp_user_has_permission 이 있으면 20260730 적용됨.
--  → is_exam_admin() 만 있으면 미적용(=custom 계정 저장 차단 상태).

-- [3] 18개 시험 테이블에 insert/update 정책이 모두 존재하는지 개수 확인
select c.relname as table_name,
       count(*) filter (where p.cmd = 'a') as insert_policies,
       count(*) filter (where p.cmd = 'w') as update_policies,
       count(*) filter (where p.cmd = 'r') as select_policies
from pg_class c
join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
left join pg_policy p on p.polrelid = c.oid
where c.relname in (
  'exam_categories','exam_groups','exam_parts','exam_processes','exam_levels','exam_equipment','exam_rules',
  'exam_personnel','exam_sessions','exam_applications','exam_results',
  'pm_certifications','dm_certifications','exam_annual_targets','exam_monthly_results',
  'exam_import_jobs','exam_import_errors','exam_audit_logs')
group by c.relname order by c.relname;

-- [4] 특정 사용자(custom role)가 실제 보유한 시험 쓰기 permission_key 시뮬레이션
--     ⚠ 아래 이메일을 대상 계정으로 교체. crp_user_has_permission 은 auth.uid() 기준이라
--        SQL Editor(관리자 세션)에서는 직접 호출 대신 원천 데이터를 조회해 확인한다.
with target as (
  select id as uid from auth.users where email = 'REPLACE_WITH_EMAIL'
)
select cr.name as custom_role, crp.permission_key, crp.effect, crp.is_active
from public.user_custom_roles ucr
join target t              on t.uid = ucr.user_id
join public.custom_roles cr on cr.id = ucr.custom_role_id
join public.custom_role_permissions crp on crp.custom_role_id = cr.id
where ucr.is_active and cr.is_active and cr.is_deleted = false
  and crp.permission_key like 'exam%'
order by crp.permission_key;
--  → 'examApplications.create' 등이 나오면, 그 계정은 20260730 적용 후 해당 저장이 허용된다.
--  → viewer(커스텀 없음)은 결과 0행 → 여전히 쓰기 차단(정상).
