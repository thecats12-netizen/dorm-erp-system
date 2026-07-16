-- ============================================================================
-- 20260717000000_exam_process_scopes.sql 롤백 (SQL Editor 수동 실행)
--   시험 스코프 정책/테이블/함수/컬럼을 제거하고 20260716 상태(admin/viewer 기준)로 되돌린다.
--   ※ exam_role 값·스코프 데이터·exam_applications.process_id 백필값이 소실되므로 필요 시 백업.
--   ※ 데이터 행은 삭제하지 않는다(컬럼/정책만 원복).
-- ============================================================================

-- 1) 새 정책 제거 + 20260716 정책(admin/viewer) 재생성
do $rb$
declare t text;
  allt text[] := array['exam_categories','exam_groups','exam_parts','exam_processes','exam_levels','exam_equipment','exam_rules',
    'exam_personnel','exam_sessions','exam_applications','exam_results','pm_certifications','dm_certifications',
    'exam_annual_targets','exam_monthly_results','exam_import_jobs','exam_import_errors','exam_audit_logs','exam_retest_candidates'];
  p text;
begin
  foreach t in array allt loop
    if to_regclass('public.'||quote_ident(t)) is null then continue; end if;
    foreach p in array array['exam_acc_select','exam_acc_insert','exam_acc_update','exam_scope_select','exam_scope_insert','exam_scope_update'] loop
      execute format('drop policy if exists %I on public.%I', p, t);
    end loop;
    -- 20260716 정책 재생성(로그인 활성 사용자 읽기 / admin 쓰기)
    execute format('drop policy if exists %I on public.%I','exam_master_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.can_read_exam_master())','exam_master_select', t);
    execute format('drop policy if exists %I on public.%I','exam_master_insert', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.is_exam_admin() and tenant_id is not null)','exam_master_insert', t);
    execute format('drop policy if exists %I on public.%I','exam_master_update', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.is_exam_admin() and tenant_id is not null) with check (public.is_exam_admin() and tenant_id is not null)','exam_master_update', t);
  end loop;
end $rb$;

-- 2) 스코프 테이블/정책
drop policy if exists eups_select on public.exam_user_process_scopes;
drop policy if exists eups_insert on public.exam_user_process_scopes;
drop policy if exists eups_update on public.exam_user_process_scopes;
drop table if exists public.exam_user_process_scopes;

-- 3) 헬퍼 함수
drop function if exists public.exam_scope_readable(uuid,uuid);
drop function if exists public.exam_scope_allows(uuid,uuid,text);
drop function if exists public.exam_can_access(uuid);
drop function if exists public.exam_is_viewer_all(uuid);
drop function if exists public.exam_is_admin(uuid);
drop function if exists public.exam_is_super(uuid);
drop function if exists public.exam_role_of(uuid);

-- 4) 추가 컬럼(값 소실 주의 — 필요 시 백업 후 실행)
alter table public.exam_applications drop column if exists process_id;
alter table public.profiles drop column if exists exam_role;
