-- ============================================================================
-- [제안 · 자동 실행 금지] D.M 인증(dm_certifications) 워크플로화 — acquired_date NOT NULL 해제
--
-- [배경] dm_certifications 는 승인대기/후보 → 승인(취득 확정) 워크플로 테이블이다(approval_status:
--        대기/승인/반려). 그러나 acquired_date 가 NOT NULL 이라 "취득 전" 후보/대기 row 저장 시
--        23502(null value in column "acquired_date") 로 실패한다.
--        · PM 인증은 이미 동일 사유로 20260714030000_pm_certifications_workflow.sql 에서
--          acquired_date NOT NULL 을 해제했다. D.M 도 동일 선례를 따른다(정합).
--        · 취득일은 "승인/취득 확정" 시점에만 설정한다(후보 단계 임의 today/created_at 복사 금지).
--
-- [원칙]
--   · alter column ... drop not null 만 수행(비파괴 · 재실행 안전). default 추가/backfill/값 변경 없음.
--   · 기존 unique index(… , acquired_date …)는 그대로 둔다(NULL 은 서로 distinct → 후보 다건 허용).
--   · ※ 자동 실행 금지. Supabase SQL Editor 에서 검토 후 1회 수동 실행.
--   · 선행: 20260712000000_create_exam_management.sql
-- ============================================================================

alter table public.dm_certifications alter column acquired_date drop not null;

comment on column public.dm_certifications.acquired_date is 'D.M 인증 취득일. 승인/취득 확정 시 설정. 후보·승인대기 단계에서는 NULL 허용(워크플로). 만료 계산은 값이 있을 때만.';

notify pgrst, 'reload schema';

-- ============================================================================
-- 롤백(필요 시, 검토 후 수동 · 데이터에 NULL 존재 시 실패할 수 있음):
--   -- alter table public.dm_certifications alter column acquired_date set not null;
-- ============================================================================
