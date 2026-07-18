-- ============================================================================
-- 단일 사용자 로그인 권한 진단 (읽기 전용 · 수정 SQL 아님)
--   대상: 이메일로 1명만. 전체 사용자 수정/일괄 처리 금지.
--   목적: "사용자관리에는 시험관리로 보이는데 로그인은 viewer" 원인 실제값 확인.
--   ⚠ 아래 :target_email 을 대상 계정 이메일로 바꿔 실행.
-- ============================================================================

-- [0] 파라미터
--   psql:   \set target_email '윤태희 계정 이메일'
--   SQL Editor: 아래 CTE 의 이메일 문자열을 직접 교체.
with target as (
  select id as auth_uid, email
  from auth.users
  where email = 'REPLACE_WITH_EMAIL'   -- ← 대상 계정 이메일로 교체
)

-- [1] auth ↔ profile ↔ system role ID 일치 검증
select
  'A. identity' as section,
  left(t.auth_uid::text, 8) || '…' as auth_uid,
  left(p.id::text, 8) || '…'       as profile_id,
  p.role                            as system_role,
  p.tenant_id
from target t
left join public.profiles p on p.id = t.auth_uid;

-- [2] 이 계정에 배정된 user_custom_roles (self-read 대상)
select
  'B. assignment' as section,
  left(ucr.user_id::text, 8) || '…' as user_id,
  left(ucr.custom_role_id::text, 8) || '…' as custom_role_id,
  ucr.is_active,
  ucr.deleted_at,
  ucr.tenant_id
from public.user_custom_roles ucr
join target t on t.auth_uid = ucr.user_id;
--  → 0행이면: 배정이 auth.uid() 가 아닌 다른 id 로 저장됨(=id 불일치) 또는 미배정.
--  → 1행 이상 + is_active=true 면 배정 정상. 다음 [3] 으로.

-- [3] 배정된 custom_roles 실제 값 (RLS 로 로그인 사용자가 못 읽던 그 테이블)
select
  'C. custom_role' as section,
  left(cr.id::text, 8) || '…' as role_id,
  cr.name,
  cr.permission_mode,          -- restrictive 여야 "선택한 메뉴만 허용"
  cr.is_active,
  cr.is_deleted,
  cr.tenant_id
from public.custom_roles cr
where cr.id in (
  select ucr.custom_role_id from public.user_custom_roles ucr
  join target t on t.auth_uid = ucr.user_id
  where ucr.is_active
);
--  → permission_mode 컬럼 오류(42703): 20260724 마이그레이션 미적용.
--  → permission_mode='additive'/null: 저장이 restrictive 가 아님(모드 저장 문제).
--  → permission_mode='restrictive': 저장 정상. 원인은 RLS(custom_roles_select admin 전용).

-- [4] 선택된 메뉴 권한 수
select
  'D. selected permissions' as section,
  crp.custom_role_id,
  count(*) as permission_count
from public.custom_role_permissions crp
where crp.custom_role_id in (
  select ucr.custom_role_id from public.user_custom_roles ucr
  join target t on t.auth_uid = ucr.user_id
  where ucr.is_active
) and crp.is_active
group by crp.custom_role_id;

-- [5] custom_roles SELECT 정책 확인 (self-read 경로가 들어갔는지)
select 'E. rls' as section, polname, pg_get_expr(polqual, polrelid) as using_expr
from pg_policy
where polrelid = 'public.custom_roles'::regclass and polname = 'custom_roles_select';
--  → using_expr 에 auth.uid() 서브쿼리가 없으면 = 20260728 미적용(=현재 버그 상태).
--  → is_custom_role_admin() OR exists(... user_id = auth.uid() ...) 면 = 수정 적용됨.
