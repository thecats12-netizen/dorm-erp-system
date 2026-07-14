-- 시험관리 > 인증 기준관리 > 인증 규칙(exam_rules) 관리 필드 보강.
-- 정책: 기존 exam_rules 테이블/컬럼/데이터/RLS 미변경. 없는 컬럼만 추가(add column if not exists — 재실행 안전).
--   · 기존 컬럼 재사용: rule_type, part_id, process_id, level_id, effective_date, notes, is_active, deleted_at, tenant_id.
--   · 컬럼명은 자동화 엔진(examAutomationService)이 읽는 키와 일치(require_written/require_practical/min_tenure_months/valid_months 등).
-- 적용: Supabase SQL Editor 에서 1회 수동 실행. (자동 실행하지 않음)
--   · 적용 전에도 목록 조회와 기존 필드(구분/파트/공정/단계/비고) CRUD 는 정상 동작하며,
--     신규 필드(제품군·그룹·선행단계·합격요건·설비수·재직기간·유효기간·만료기준·재시험·자동승급) 저장만 적용 후 활성화된다.

alter table public.exam_rules
  add column if not exists category_id uuid references public.exam_categories(id) on delete set null,   -- 적용 제품군
  add column if not exists group_id uuid references public.exam_groups(id) on delete set null,           -- 적용 그룹
  add column if not exists prerequisite_level_id uuid references public.exam_levels(id) on delete set null, -- 선행 인증 단계
  add column if not exists require_written boolean,          -- 필기 합격 필요 여부
  add column if not exists require_practical boolean,        -- 실기 합격 필요 여부
  add column if not exists required_equipment_count int,     -- 필수 설비 수
  add column if not exists min_tenure_months int,            -- 취득 가능 최소 재직기간(개월)
  add column if not exists valid_months int,                 -- 유효기간(개월)
  add column if not exists expiry_notice_days int,           -- 만료 예정 기준일(일)
  add column if not exists retest_condition text,            -- 재시험 가능 기준
  add column if not exists auto_promote boolean;             -- 자동승급 여부

-- PostgREST 스키마 캐시 갱신.
notify pgrst, 'reload schema';
