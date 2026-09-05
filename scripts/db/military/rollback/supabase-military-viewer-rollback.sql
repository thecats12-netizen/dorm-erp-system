-- ============================================================================
-- 군대관리 v2 2E — viewer PII 차단 ROLLBACK (LOCAL/STAGING)
-- ⚠ 보안 rollback 을 "viewer raw SELECT 복원(can_view_military)"으로 삼지 않는다(원문 PII 재노출).
--   기본 rollback 은 프론트 이전 버전 + RPC 유지 + admin-only 정책 유지로 보안 수준을 지킨다.
--   아래는 "v3(admin-only SELECT) → v2(can_view_military SELECT) 로 되돌리는" 최후 수단 SQL(신중히).
-- ============================================================================

-- (기본) 프론트 rollback 우선 — 이 SQL 없이 프론트만 이전 버전으로 되돌려도 admin-only 보안 유지.

-- (최후수단) SELECT 정책을 v2(can_view_military)로 되돌림 — viewer raw SELECT 다시 허용됨(원문 PII 재노출 주의).
begin;
drop policy if exists military_module_select on public.military_module_data;
create policy military_module_select on public.military_module_data
  for select to authenticated
  using (tenant_id = 'default' and public.can_view_military());
commit;

-- RPC/mask helper 제거(선택 · 타 경로 미사용 확인 후):
-- drop function if exists public.get_military_module_for_current_user();
-- drop function if exists public.mask_military_phone(text);
-- drop function if exists public.mask_military_birth_date(text);

-- ⚠ 'disable row level security' 금지(현재 RLS ON 운영 유지).
