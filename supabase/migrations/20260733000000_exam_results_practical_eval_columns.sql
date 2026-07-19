-- ============================================================================
-- 실기 평가관리 — exam_results 확장 컬럼(설비별 평가 결과)
--
-- [목적]
--   기존 exam_results 를 실기 평가 결과 본체로 사용한다(신규 결과 테이블 만들지 않음).
--   한 응시(application_id)당 설비(equipment_id) × 평가위원(evaluator_no) 로 N행을 저장하고,
--   전체 합격은 exam_rules(equipment_cert_method/required_equipment_count) 로 파생 계산한다.
--
-- [원칙]
--   · 전부 ADD COLUMN IF NOT EXISTS · 모두 nullable · 기존 컬럼/데이터/NOT NULL/FK/RLS/트리거 무변경.
--   · DROP/RENAME 없음. 기존 행에 기본값 강제 없음(레거시 = result_type null). 재실행 안전(멱등).
--   · CHECK 제약은 넣지 않는다(기존 exam_results.status/자유문자열 데이터 호환 · eval_status 는 앱/서비스에서 검증).
--   · equipment_id 는 exam_equipment(id) 참조, ON DELETE SET NULL(설비 삭제 시 결과 보존).
--   · finalized_by 는 uuid(기존 created_by/updated_by 와 동일 = profiles.id/auth.uid()).
--
-- [주의 — 앱측 처리 필요(스키마 변경 아님)]
--   exam_results.personnel_id 는 NOT NULL 이다. 평면 exam_applications 의 personnel_id 는 null 일 수 있으므로,
--   실기행 저장 시 앱/서비스가 employee_no → exam_personnel.id 로 personnel_id 를 확정해 넣어야 한다.
--
-- ※ 자동 실행 금지. 승인 후 Supabase SQL Editor 에서 1회 수동 실행.
--    선행: 20260712000000(exam_results), 20260712010000(exam_equipment), 20260714040000/20260731000000(exam_rules 실기 요건)
--    롤백: 20260733000000_exam_results_practical_eval_columns_rollback.sql
-- ============================================================================

begin;

alter table public.exam_results
  add column if not exists equipment_id   uuid references public.exam_equipment(id) on delete set null,  -- 설비별 결과
  add column if not exists evaluator       text,        -- 평가위원(사용자 마스터 없어 text 로 시작)
  add column if not exists evaluator_no    int,         -- 위원 순번(evaluator_count 다수 시 1..N)
  add column if not exists max_score       int,         -- 만점(rule practical_pass_score 와 비교)
  add column if not exists checklist       jsonb,       -- 점검 항목 배열([{id,label,required,passed,score,maxScore,note}])
  add column if not exists eval_status     text,        -- pending/in_progress/awaiting_decision/passed/failed/review_required
  add column if not exists result_type     text,        -- 'practical'(구분 · 레거시 행은 null)
  add column if not exists score_variance  numeric,     -- 위원 점수 편차(최고-최저) — 20점 이상 재검토
  add column if not exists finalized_at    timestamptz, -- 설비 판정 확정 시각
  add column if not exists finalized_by    uuid;        -- 확정자(profiles.id/auth.uid())

-- 중복 방지: 동일 응시 × 동일 설비 × 동일 위원 순번(실기 결과, 미삭제)만 1행.
create unique index if not exists ux_exam_results_practical_eval
  on public.exam_results (tenant_id, application_id, equipment_id, evaluator_no)
  where deleted_at is null and equipment_id is not null and result_type = 'practical';

-- 조회 최적화(중복 회피 — application/personnel 은 기존 ix 존재. eval_status 만 신규).
create index if not exists ix_exam_results_eval_status
  on public.exam_results (tenant_id, eval_status)
  where result_type = 'practical';

commit;

-- PostgREST 스키마 캐시 갱신.
notify pgrst, 'reload schema';
