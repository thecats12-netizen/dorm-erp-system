-- ============================================================================
-- 군대관리 v2 RLS 정책 교체 ROLLBACK (LOCAL/STAGING 검증용)
-- ⚠ PRODUCTION 실행 금지 — 로컬/스테이징 rollback 정확성 확인용.
-- 목표: 정책 교체 "이전" 상태로 복원. RLS 는 ON 유지(절대 DISABLE 하지 않음).
--   - 신규 정책 3개 제거
--   - 기존 broad 정책 2개 복원
--   - helper 는 타 모듈 미사용 → 선택 삭제(주석)
--   - GRANT 원상변경은 이번 rollback 에 포함하지 않음
-- ============================================================================
begin;

-- 신규 정책 제거(존재할 때만 · 비파괴)
drop policy if exists military_module_select on public.military_module_data;
drop policy if exists military_module_insert on public.military_module_data;
drop policy if exists military_module_update on public.military_module_data;

-- 기존 broad 정책 복원(중복 방지: 이미 있으면 재생성 스킵)
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='military_module_data' and policyname='military_module_data_admin_all') then
    create policy military_module_data_admin_all on public.military_module_data
      for all to authenticated using (tenant_id='default') with check (tenant_id='default');
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='military_module_data' and policyname='military_module_data_select') then
    create policy military_module_data_select on public.military_module_data
      for select to authenticated using (tenant_id='default');
  end if;
end $$;

commit;

-- helper 선택 삭제(타 모듈 미사용 확인 후에만):
-- drop function if exists public.can_view_military();
-- drop function if exists public.can_edit_military();

-- ⚠ 절대 'alter table public.military_module_data disable row level security;' 로 rollback 하지 말 것.
--    현재 RLS ON 운영 상태 → disable 시 더 취약해짐. 긴급 최후수단으로만 별도 판단.
