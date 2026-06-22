-- ============================================================================
-- 청소관리/하자접수 이미지 첨부 컬럼 보장 (Supabase SQL Editor 에 실행. 멱등)
-- ----------------------------------------------------------------------------
-- 증상: 이미지 첨부 후 저장 → 다시 열면 사라짐.
-- 원인: cleaning_reports / defect_requests 에 사진 컬럼이 없으면 저장돼도 로드 시 빈 배열.
-- 사진은 data URL(문자열) 배열을 jsonb 로 저장합니다.
-- ============================================================================

-- 청소관리: 청소 전/후 사진
alter table public.cleaning_reports add column if not exists before_photo_data_urls jsonb default '[]'::jsonb;
alter table public.cleaning_reports add column if not exists after_photo_data_urls jsonb default '[]'::jsonb;

-- 하자접수: 접수/완료 사진
alter table public.defect_requests add column if not exists request_photo_data_urls jsonb default '[]'::jsonb;
alter table public.defect_requests add column if not exists completion_photo_data_urls jsonb default '[]'::jsonb;

-- 확인:
-- select column_name from information_schema.columns
--   where table_schema='public' and table_name in ('cleaning_reports','defect_requests')
--   and column_name like '%photo%';
