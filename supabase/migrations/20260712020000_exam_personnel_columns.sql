-- ============================================================================
-- 시험관리 인력현황(연명부) — exam_personnel 에 인증 현황 컬럼 추가(신규 컬럼만, 기존 데이터/컬럼 미변경).
-- 시험관리 전용 테이블에만 컬럼 추가. 다른 메뉴/기존 인사(dorm/military) 테이블은 절대 미수정.
-- 재실행 안전(add column if not exists).
-- ============================================================================

begin;

alter table public.exam_personnel add column if not exists group_name text;          -- 그룹
alter table public.exam_personnel add column if not exists product_group text;        -- 제품군
alter table public.exam_personnel add column if not exists part_name text;            -- 파트(텍스트 표기 — Excel 연명부와 동일)
alter table public.exam_personnel add column if not exists position text;             -- 직책
alter table public.exam_personnel add column if not exists employment_status text;    -- 재직여부(재직/휴직/퇴직 등)
alter table public.exam_personnel add column if not exists career_type text;          -- 경력/신입
alter table public.exam_personnel add column if not exists current_pm_level text;      -- 현재 PM Level
alter table public.exam_personnel add column if not exists pm_capable_rate numeric;    -- PM 가능률(%)
alter table public.exam_personnel add column if not exists single_job text;           -- Single Job
alter table public.exam_personnel add column if not exists m1 text;                   -- M1
alter table public.exam_personnel add column if not exists m2 text;                   -- M2
alter table public.exam_personnel add column if not exists m3 text;                   -- M3
alter table public.exam_personnel add column if not exists m4 text;                   -- M4
alter table public.exam_personnel add column if not exists dm text;                   -- D.M
alter table public.exam_personnel add column if not exists cert_level text;           -- 인증 Level
alter table public.exam_personnel add column if not exists dual_multi boolean;         -- Dual Multi 여부

commit;
