-- ============================================================================
-- 롤백: 시험 쓰기 RLS 를 관리자 전용(20260716 원본)으로 되돌린다.
--   ⚠ 되돌리면 사용자 정의(시험관리) 권한 계정의 저장이 다시 403(42501)으로 차단된다.
--   SELECT 정책·grant·DELETE 미부여는 20260716 그대로 유지된다(여기서 미변경).
-- ============================================================================

do $do$
declare
  t          text;
  has_tenant boolean;
  tcheck     text;
  tables text[] := array[
    'exam_categories','exam_groups','exam_parts','exam_processes','exam_levels','exam_equipment','exam_rules',
    'exam_personnel','exam_sessions','exam_applications','exam_results',
    'pm_certifications','dm_certifications','exam_annual_targets','exam_monthly_results',
    'exam_import_jobs','exam_import_errors','exam_audit_logs'
  ];
begin
  if to_regprocedure('public.is_exam_admin()') is null then
    raise exception '선행 함수 is_exam_admin 없음(20260716 미적용). 롤백 불가.';
  end if;
  foreach t in array tables loop
    if to_regclass('public.' || quote_ident(t)) is null then continue; end if;
    select exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = t and column_name = 'tenant_id'
    ) into has_tenant;
    tcheck := case when has_tenant then ' and tenant_id is not null' else '' end;

    execute format('drop policy if exists %I on public.%I', 'exam_master_insert', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.is_exam_admin()%s)',
      'exam_master_insert', t, tcheck
    );
    execute format('drop policy if exists %I on public.%I', 'exam_master_update', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.is_exam_admin()%s) with check (public.is_exam_admin()%s)',
      'exam_master_update', t, tcheck, tcheck
    );
  end loop;
end
$do$;
