-- ============================================================================
-- audit_logs 조회 성능 인덱스 (Supabase SQL Editor 에서 실행. 멱등)
-- ----------------------------------------------------------------------------
-- 증상: audit_logs 조회가 "canceling statement due to statement timeout" + 500.
-- 원인: 데이터가 많은 audit_logs 를 인덱스 없이 created_at 정렬/전체 조회 → 풀스캔/풀정렬 타임아웃.
-- 조치: 앱은 최신 50건만(created_at desc, limit 50) 조회하도록 수정했고,
--       그 정렬이 인덱스를 타도록 created_at(내림차순) 인덱스를 추가한다.
-- ============================================================================

-- 최신순(created_at desc) 정렬 + limit 가 인덱스를 사용하도록.
create index if not exists idx_audit_logs_created_at_desc
  on public.audit_logs (created_at desc);

-- (선택) 테넌트별 최신순 조회를 추가로 쓸 경우.
create index if not exists idx_audit_logs_tenant_created_at
  on public.audit_logs (tenant_id, created_at desc);

-- 확인:
-- explain analyze
--   select id, created_at from public.audit_logs order by created_at desc limit 50;
