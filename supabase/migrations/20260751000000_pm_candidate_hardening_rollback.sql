-- ============================================================================
-- ROLLBACK — PM 후보 생성 무결성 보강 (20260751000000)
--   · RPC/인덱스 제거, history INSERT 정책을 20260750 원상(admin OR can_read_exam_master)으로 복구.
--   · metadata 컬럼은 데이터 보존을 위해 기본 유지(원하면 마지막 줄 주석 해제하여 제거).
-- ============================================================================
begin;

drop function if exists public.exam_generate_pm_candidates(text, jsonb);
drop index if exists public.ux_pmcert_pending_candidate;

-- history INSERT 정책 원복(20260750 기준)
drop policy if exists "certhist_insert" on public.exam_certification_history;
create policy "certhist_insert" on public.exam_certification_history
  for insert to authenticated
  with check ((public.is_exam_admin() or public.can_read_exam_master()) and tenant_id is not null);

commit;

-- (선택) metadata 컬럼 제거 — 이력 데이터 손실 주의:
-- alter table public.pm_certifications drop column if exists metadata;
