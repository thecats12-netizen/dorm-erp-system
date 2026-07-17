-- ============================================================================
-- [검증 · 비파괴] custom_roles.permission_mode 적용 확인
--   20260724000000_custom_roles_permission_mode.sql 실행 후 이 파일을 SQL Editor 에서 실행.
--   §1~§6 은 읽기 전용. §7 은 tx 내 테스트 INSERT 후 반드시 rollback(데이터 미변경).
-- ============================================================================

-- 1) 컬럼 존재 + 데이터 타입 + 기본값 + NOT NULL 확인 -------------------------
select column_name, data_type, column_default, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'custom_roles' and column_name = 'permission_mode';
-- 기대: text / default 'additive'::text / is_nullable = NO

-- 2) CHECK 제약 확인 ----------------------------------------------------------
select con.conname, pg_get_constraintdef(con.oid) as definition
from pg_constraint con
where con.conrelid = 'public.custom_roles'::regclass
  and con.contype = 'c'
  and pg_get_constraintdef(con.oid) ilike '%permission_mode%';
-- 기대: CHECK (permission_mode = ANY (ARRAY['additive','restrictive']))  (제약명: custom_roles_permission_mode_chk)

-- 3) 기존 데이터가 모두 additive(또는 유효값)인지 + NULL 없음 확인 -----------
select permission_mode, count(*) as cnt
from public.custom_roles
group by permission_mode
order by permission_mode;
-- 기대: NULL 없음. 신규 도입 직후엔 전부 'additive'.

select count(*) as null_or_invalid_should_be_0
from public.custom_roles
where permission_mode is null or permission_mode not in ('additive','restrictive');
-- 기대: 0

-- 4) 기존 custom_roles 조회 정상(컬럼 포함) -----------------------------------
select id, code, name, role_type, permission_mode, is_active, is_deleted, created_at
from public.custom_roles
order by created_at desc
limit 20;

-- 5) (참고) 기존 role/시스템 무결성 — permission_mode 도입이 profiles 를 건드리지 않았는지 -
select role, count(*) as cnt from public.profiles group by role order by role;
-- 기대: 도입 전과 동일(admin/viewer/dorm_manager/maintenance_reporter).

-- 6) PostgREST 스키마 반영(프론트가 컬럼을 인식하도록) ------------------------
notify pgrst, 'reload schema';

-- 7) [선택 · tx-rollback] 허용값 외 입력 차단 + 기본값 동작 테스트 ------------
--    ★ 반드시 rollback. Production 데이터 변경 없음. (custom_roles RLS 로 admin 세션에서만 INSERT 가능)
/*
begin;
  -- (a) 기본값: permission_mode 미지정 → 'additive' 로 채워지는지
  insert into public.custom_roles (tenant_id, code, name, role_type)
  values ('default', '__verify_mode_default__', '검증기본', 'custom')
  returning code, permission_mode;   -- 기대: additive

  -- (b) 허용값 외 입력 → CHECK 위반으로 실패해야 정상(아래 문장이 오류 나면 정상)
  insert into public.custom_roles (tenant_id, code, name, role_type, permission_mode)
  values ('default', '__verify_mode_bad__', '검증불량', 'custom', 'invalid_mode');
  -- ↑ ERROR: new row ... violates check constraint "custom_roles_permission_mode_chk"  ← 이 오류가 나야 정상

rollback;   -- ★ 반드시 rollback
*/
