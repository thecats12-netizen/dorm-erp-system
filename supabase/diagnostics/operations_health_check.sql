-- ============================================================================
-- [읽기 전용 · 운영 자동 점검] 권한/계정 상태 헬스체크
--   ※ SELECT 만 수행. 데이터 변경 없음. Supabase SQL Editor 또는 예약 조회로 정기 실행.
--   ※ 운영 대시보드/알림의 데이터 소스로 사용(예: 주1회 실행 후 결과 검토).
-- 대상 테이블: profiles, custom_roles, user_custom_roles, custom_role_permissions, custom_role_scopes
-- ============================================================================

-- 1) 관리자 계정 수 / admin 사용자 목록 -----------------------------------------
select count(*) as active_admin_count
from public.profiles where role = 'admin' and coalesce(is_active, true);
--   → 권장 2~3명. 0 또는 과다 시 점검.

select id, email, display_name, is_active
from public.profiles where role = 'admin' order by is_active desc, email;

-- 2) 비활성 사용자 --------------------------------------------------------------
select count(*) as inactive_users
from public.profiles where is_active = false;

-- 3) 장기 미접속 사용자 (Auth 로그인 시각 기준) ---------------------------------
--   profiles 에 last_login 컬럼이 없으므로 auth.users.last_sign_in_at 사용.
select p.email, p.role, u.last_sign_in_at
from public.profiles p
join auth.users u on u.id = p.id
where coalesce(p.is_active, true)
  and (u.last_sign_in_at is null or u.last_sign_in_at < now() - interval '60 days')
order by u.last_sign_in_at nulls first;
--   → 60일+ 미접속 관리자/계정 검토.

-- 4) 퇴사자/삭제 예정 계정 (is_deleted 또는 비활성) -----------------------------
select id, email, role, is_active
from public.profiles
where is_active = false
order by email;
--   → 운영 규정상 "퇴사=비활성화" 이면 여기 목록을 인수인계/정리 대상과 대조.

-- 5) 비활성/삭제된 Custom Role --------------------------------------------------
select id, code, name, is_active, is_deleted, deleted_at
from public.custom_roles
where is_active = false or is_deleted = true
order by updated_at desc;

-- 6) 삭제/비활성 Role 이 여전히 계정에 활성 배정된 경우(정리 필요) --------------
select ucr.user_id, r.code, r.name, r.is_active as role_active, r.is_deleted as role_deleted
from public.user_custom_roles ucr
join public.custom_roles r on r.id = ucr.custom_role_id
where ucr.is_active
  and (r.is_active = false or r.is_deleted = true);
--   → 0행이 정상. 있으면 해당 배정 회수.

-- 7) 중복 Role 배정 (유니크 제약상 활성 중복은 없어야 함) ------------------------
select tenant_id, user_id, custom_role_id, count(*) as cnt
from public.user_custom_roles
group by tenant_id, user_id, custom_role_id
having count(*) > 1;
--   → 0행 정상.

-- 8) 잘못된 Scope (허용 외 scope_type / 빈 값 / all+조건 동시) -------------------
select id, custom_role_id, scope_type, scope_value
from public.custom_role_scopes
where is_active
  and (scope_type not in ('organization','region','gender','dorm','process','owner')
       or length(btrim(scope_value)) = 0);
--   → 0행 정상.

-- all(전체) 과 다른 조건이 같은 역할에 동시 저장된 비정상 상태
select s.custom_role_id
from public.custom_role_scopes s
where s.is_active and s.scope_type = 'organization' and s.scope_value = 'all'
  and exists (
    select 1 from public.custom_role_scopes s2
     where s2.custom_role_id = s.custom_role_id and s2.is_active
       and s2.scope_type in ('region','gender','dorm','process','owner')
  )
group by s.custom_role_id;
--   → 0행 정상(전체 선택 시 다른 조건 없어야 함).

-- 9) restrictive 설정 오류 (선택 방식인데 메뉴/기능 권한이 하나도 없음 → 0건 화면) ---
select r.id, r.code, r.name
from public.custom_roles r
where r.permission_mode = 'restrictive' and r.is_active and r.is_deleted = false
  and not exists (
    select 1 from public.custom_role_permissions p
     where p.custom_role_id = r.id and p.is_active
  );
--   → 있으면 해당 restrictive 역할 사용자는 아무 메뉴도 못 봄. 검토 필요.

-- 10) maintenance_reporter / dorm_manager 정책 위반 (보호 계정에 추가 권한 배정) ---
select ucr.user_id, p.email, p.role
from public.user_custom_roles ucr
join public.profiles p on p.id = ucr.user_id
where ucr.is_active and p.role in ('maintenance_reporter','dorm_manager');
--   → 0행 정상(보호 계정엔 사용자 정의 권한이 없어야 함).

-- 11) 다운로드 권한 과다 사용자 (excel/pdf/csv 부여된 역할을 가진 계정) ---------
select distinct p.email, p.role
from public.custom_role_permissions crp
join public.user_custom_roles ucr on ucr.custom_role_id = crp.custom_role_id and ucr.is_active
join public.profiles p on p.id = ucr.user_id
where crp.is_active
  and split_part(crp.permission_key, '.', 2) in ('excel_download','pdf_download','csv_download','excel_upload')
order by p.email;
--   → 목록을 정책상 다운로드 허용 대상과 대조.

-- 12) 요약 카운트(운영 대시보드용) ---------------------------------------------
select
  (select count(*) from public.profiles) as total_users,
  (select count(*) from public.profiles where coalesce(is_active,true)) as active_users,
  (select count(*) from public.profiles where role='admin' and coalesce(is_active,true)) as admin_users,
  (select count(*) from public.custom_roles where is_deleted=false) as custom_roles,
  (select count(*) from public.user_custom_roles where is_active) as active_assignments,
  (select count(*) from public.custom_role_scopes where is_active) as active_scopes;
