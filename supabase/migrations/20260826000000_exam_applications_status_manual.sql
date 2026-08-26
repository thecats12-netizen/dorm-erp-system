-- ============================================================================
-- [제안 · 자동 실행 금지] 시험 응시상태(status) AUTO/MANUAL 모드 플래그
--
-- [배경] 응시상태는 날짜(필기/실기/취득일) 기반 자동계산이 기본이나, 자동계산 결과가
--        status 컬럼에 영속 저장되면서 "빈값/예정 = 자동" 휴리스틱이 재오픈 시 자동값을
--        수동(MANUAL)으로 오판정하는 버그가 있었다. 이를 명시 플래그로 구분한다.
--        · status 컬럼 값/의미는 변경하지 않는다(대시보드/리포트/Excel/중복방지/취득판정 등
--          기존 raw status 소비자는 그대로 동작 — B-2 방식의 핵심).
--        · cert_status_manual(인증취득여부 수동 확정)과 완전히 별개의 컬럼이다. 의미/값 변경 없음.
--
-- [원칙]
--   · add column if not exists 로 컬럼 1개만 추가(비파괴 · 재실행 안전 · not null default false).
--   · 기존 status/cert_status_manual/다른 컬럼 값 변경·drop·rename 없음.
--   · ※ 자동 실행 금지. Supabase SQL Editor 에서 검토 후 1회 수동 실행.
--   · 선행: 20260712000000_create_exam_management.sql, 20260712030000_exam_applications_columns.sql
-- ============================================================================

alter table public.exam_applications
  add column if not exists exam_status_manual boolean not null default false;   -- false=AUTO(날짜기반 자동), true=MANUAL(사용자 명시 상태)

comment on column public.exam_applications.exam_status_manual is
  '응시상태 모드. false=자동(status 는 날짜 기반 계산값), true=수동(사용자가 명시 선택한 status 보존). cert_status_manual(인증취득여부)과 별개.';

-- ── backfill(보수적) ─────────────────────────────────────────────────────────
--   calculateExamStatus 가 "날짜만으로 재현할 수 없는" 명시 수동 상태만 true 로 올린다.
--   (재현 가능: 예정/필기 진행/필기 합격/실기 진행/실기 합격/인증 취득 → false 유지)
--   ⚠ 값 추정이 아니라 STATUS_OPTIONS 중 자동 재현 불가 상태 집합만 대상. status 값 자체는 불변.
update public.exam_applications
set exam_status_manual = true
where deleted_at is null
  and exam_status_manual is distinct from true
  and btrim(coalesce(status, '')) in (
    '취소', '재응시', '필기 불합격', '실기 불합격', '연기', '미취득', '후보', '승인대기'
  );

-- PostgREST 스키마 캐시 갱신(신규 컬럼 즉시 인식).
notify pgrst, 'reload schema';

-- ============================================================================
-- 롤백(필요 시, 검토 후 수동):
--   -- 데이터 보존을 위해 컬럼은 기본적으로 남긴다. 완전 제거가 필요할 때만:
--   -- alter table public.exam_applications drop column if exists exam_status_manual;
-- ============================================================================
