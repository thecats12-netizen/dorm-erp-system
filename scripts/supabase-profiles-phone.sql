-- ============================================================================
-- profiles 담당자 연락처 컬럼 추가 (Supabase SQL Editor 에 실행. 멱등)
-- ----------------------------------------------------------------------------
-- 청소관리 기숙사 목록의 "담당 관리자 연락처" 표시를 위해 profiles 에 phone 보관.
-- 값이 없으면 화면에는 "-" 로 표시됩니다.
-- ============================================================================

alter table public.profiles add column if not exists phone text;

-- 확인:
-- select column_name from information_schema.columns
--   where table_schema='public' and table_name='profiles' and column_name='phone';
