-- ============================================================================
-- 청소보고서 조회 성능 인덱스 (Supabase SQL Editor 에서 실행. 멱등)
-- ----------------------------------------------------------------------------
-- 증상: cleaning_reports 조회 시 500 + "canceling statement due to statement timeout".
-- 원인: 인덱스 없이 대량 행(+사진 base64)을 정렬/스캔 → 서버 statement timeout.
-- 조치: 앱은 청소관리 메뉴 진입 시에만 (필요 컬럼 + 최신순 + limit)로 조회하도록 변경했고,
--       그 정렬/필터가 인덱스를 타도록 아래 인덱스를 추가한다.
-- 컬럼명: 본 프로젝트 cleaning_reports 는 tenant_id / created_at / report_date 를 사용.
-- ============================================================================

-- 최신순(created_at desc) 정렬 + limit 가 인덱스를 타도록(테넌트 포함).
create index if not exists idx_cleaning_reports_tenant_created_at
  on public.cleaning_reports (tenant_id, created_at desc);

-- 보고일(report_date) 기준 조회/정렬 대비(테넌트 포함).
create index if not exists idx_cleaning_reports_tenant_report_date
  on public.cleaning_reports (tenant_id, report_date desc);

-- tenant 필터 없이 최신순 조회하는 경로(레거시 NULL tenant_id 호환) 대비.
create index if not exists idx_cleaning_reports_created_at
  on public.cleaning_reports (created_at desc);

-- 확인:
-- explain analyze
--   select id, created_at from public.cleaning_reports order by created_at desc limit 500;
