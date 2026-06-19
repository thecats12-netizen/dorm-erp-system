-- ============================================================================
-- dorm_contracts 관리사무소 연락처 컬럼 추가
-- (Supabase SQL Editor 에 붙여넣어 실행. 기존 데이터/구조 변경 없음. 멱등)
-- ----------------------------------------------------------------------------
-- 앱의 계약 등록/수정 "추가 정보"에 관리사무소 연락처(managementOfficePhone)를 저장합니다.
-- 부동산 연락처(real_estate_phone)/공동·세대현관과 별개 필드입니다.
-- ============================================================================

alter table public.dorm_contracts
  add column if not exists management_office_phone text;

-- 확인:
-- select column_name, data_type from information_schema.columns
--   where table_schema='public' and table_name='dorm_contracts' and column_name='management_office_phone';
