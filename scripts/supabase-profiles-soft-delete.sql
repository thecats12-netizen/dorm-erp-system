-- ============================================================================
-- profiles 소프트 삭제(숨김) 컬럼 — 사용자관리 "삭제" 가 목록에서 완전히 숨겨지도록
-- (Supabase SQL Editor 에 붙여넣어 실행. 기존 데이터/행 삭제 없음. 멱등)
-- ----------------------------------------------------------------------------
-- 앱 동작:
--   - 삭제 = is_deleted=true + deleted_at + is_active=false (Auth/행은 보존)
--   - 기본/비활성보기 목록에서 is_deleted=true 는 숨김, "삭제 사용자 보기" 에서만 표시 + 복구
--   - 컬럼이 없으면 앱이 deleted_at → is_active 순으로 자동 폴백하지만,
--     "삭제"와 "비활성"을 구분하려면 아래 컬럼 추가를 권장.
-- ============================================================================

alter table public.profiles add column if not exists is_deleted boolean not null default false;
alter table public.profiles add column if not exists deleted_at timestamptz;

-- 확인
-- select column_name, data_type from information_schema.columns
--   where table_schema='public' and table_name='profiles' and column_name in ('is_deleted','deleted_at');
