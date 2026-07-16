-- ============================================================================
-- [초안 · 자동 실행 금지] PM 인증관리 증빙파일 컬럼 추가
--   pm_certifications 에는 증빙 컬럼이 없어(참고: dm_certifications 는 proof_file 보유),
--   증빙파일 기능을 쓰려면 아래 컬럼을 SQL Editor 에서 1회 실행해 추가한다.
--   additive · nullable · 기존 데이터/정책 무변경 · 재실행 안전.
-- ============================================================================
alter table public.pm_certifications
  add column if not exists proof_file text;   -- 인증 증빙(파일명/URL)

-- 롤백:
-- alter table public.pm_certifications drop column if exists proof_file;
