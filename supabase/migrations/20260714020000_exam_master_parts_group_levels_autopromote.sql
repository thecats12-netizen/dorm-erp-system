-- 시험관리 > 인증 기준관리 보강: 파트→그룹 연결, 인증 레벨 자동승급 여부
-- 정책: 기존 컬럼/데이터/RLS 미변경, 신규 컬럼만 추가(add column if not exists — 재실행 안전).
-- 적용: Supabase SQL Editor 에서 1회 수동 실행. (자동 실행하지 않음)
--   · 이 SQL 적용 전에도 제품군/그룹/공정/설비/레벨(정렬순서·사용여부) 관리는 정상 동작하며,
--     "파트의 그룹 연결"과 "레벨 자동승급 여부" 저장만 적용 후 활성화된다.

-- 1) 파트(exam_parts) → 그룹(exam_groups) 연결 컬럼. (기존 category_id 컬럼/데이터는 그대로 유지)
alter table public.exam_parts
  add column if not exists group_id uuid references public.exam_groups(id) on delete set null;

-- 2) 인증 레벨(exam_levels) 자동승급 여부.
alter table public.exam_levels
  add column if not exists auto_promote boolean not null default false;

-- PostgREST 스키마 캐시 갱신(컬럼 추가 직후 조회/저장 반영).
notify pgrst, 'reload schema';
