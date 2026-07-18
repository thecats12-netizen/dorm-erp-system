-- ============================================================================
-- [제안 · 자동 실행 금지] 인증 규칙(exam_rules) 재시험 대기 개월 컬럼 추가
--
-- [배경] 마법사 7단계(재시험 조건)의 "재시험 대기 개월(retest_months)"을 개월 단위로 저장하려면
--        전용 정수 컬럼이 필요하다. 현재 exam_rules 에는 자유형 텍스트 retest_condition 만 존재한다.
--        → 기존 retest_condition 은 유지하고, 개월 계산용 정수 컬럼만 "추가"한다(비파괴).
--
-- [원칙]
--   · 기존 컬럼/데이터/RLS/트리거 변경 없음. add column if not exists 로 컬럼 1개만 추가.
--   · required_months 와 동일하게 음수 방지 CHECK(가드) 포함. 재실행 안전(idempotent).
--   · ※ 자동 실행 금지. Supabase SQL Editor 에서 검토 후 1회 수동 실행.
--
-- [적용 필요 여부] 마법사 7단계에서 retest_months 를 "저장"까지 하려면 필요.
--   미적용 시: 화면 입력/요약 표시까지는 가능하나 저장은 하지 않는다(기존 retest_condition 만 저장).
--   선행: 20260712000000_create_exam_management.sql, 20260714040000_exam_rules_columns.sql
-- ============================================================================

alter table public.exam_rules
  add column if not exists retest_months int;   -- 재시험 대기(개월). 불합격 후 재응시 가능까지의 대기 개월.

comment on column public.exam_rules.retest_months is '재시험 대기(개월). 불합격/미취득 후 재응시 가능일 = 발생일 + retest_months 개월. 기존 retest_condition(텍스트)과 병행.';

-- 음수 방지(제약이 없을 때만 추가)
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'exam_rules_retest_months_nonneg') then
    alter table public.exam_rules
      add constraint exam_rules_retest_months_nonneg check (retest_months is null or retest_months >= 0);
  end if;
end $$;

notify pgrst, 'reload schema';

-- ============================================================================
-- 롤백(필요 시, 검토 후 수동):
--   alter table public.exam_rules drop constraint if exists exam_rules_retest_months_nonneg;
--   -- 데이터 보존을 위해 컬럼은 기본적으로 남긴다. 완전 제거가 필요할 때만:
--   -- alter table public.exam_rules drop column if exists retest_months;
-- ============================================================================
