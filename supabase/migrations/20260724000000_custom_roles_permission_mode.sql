-- ============================================================================
-- custom_roles.permission_mode 컬럼 추가 (restrictive 권한 기능의 DB 기반)
--
-- [목적]
--   사용자 정의 권한이 "기존 권한에 추가(additive)"인지 "선택한 메뉴만 허용(restrictive)"
--   인지를 저장한다. 이번 단계는 컬럼/타입만 추가하고, Sidebar·라우트·버튼 권한 계산은
--   변경하지 않는다(다음 단계).
--
-- [값]  additive(기본) | restrictive
--
-- [안전 원칙]
--   - add column if not exists + not null default 'additive' → 기존 행은 전부 'additive' 로 채워진다.
--   - CHECK 제약은 존재하지 않을 때만 추가(재실행 안전).
--   - 기존 profiles/시스템 role/하자접수/기존 사용자/기존 RLS 무변경. 자동 배정/변환 없음.
--   - drop table/truncate/cascade 없음.
--
-- ※ 자동 실행되지 않습니다. Supabase SQL Editor 에서 1회 실행하세요.
--    선행: custom_roles 존재(20260723000000_permission_system_repair.sql 적용 후).
--    롤백: supabase/rollback/20260724000000_custom_roles_permission_mode_rollback.sql
-- ============================================================================

begin;

-- 1) 컬럼 추가(기존 행은 default 'additive' 로 채워짐)
alter table public.custom_roles
  add column if not exists permission_mode text not null default 'additive';

-- 2) CHECK 제약(없을 때만 추가)
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'custom_roles_permission_mode_chk'
       and conrelid = 'public.custom_roles'::regclass
  ) then
    alter table public.custom_roles
      add constraint custom_roles_permission_mode_chk
      check (permission_mode in ('additive','restrictive'));
  end if;
end $$;

-- 3) PostgREST 스키마 캐시 리로드
notify pgrst, 'reload schema';

commit;

-- 완료. 재실행해도 안전(idempotent). 기존 데이터는 모두 additive.
