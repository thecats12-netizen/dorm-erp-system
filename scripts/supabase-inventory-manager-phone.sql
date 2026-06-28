-- ============================================================================
-- 비품(inventory_items) 담당자 연락처 컬럼 추가 (Supabase SQL Editor 에 실행. 멱등)
-- ----------------------------------------------------------------------------
-- 목적: 비품 등록/수정 시 기숙사 담당자명(manager_name)과 함께 담당자 연락처를
--       저장/표시하기 위한 컬럼. 기숙사 선택 시 자동 입력 + 수동 수정 모두 지원.
-- 기존 데이터는 값이 없으면 빈 문자열로 처리(앱에서 "" 기본값) — 오류 없음.
-- ============================================================================

alter table public.inventory_items
  add column if not exists manager_phone text default '';

-- 확인:
-- select column_name from information_schema.columns
--   where table_schema='public' and table_name='inventory_items' and column_name='manager_phone';
