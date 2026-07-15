-- ============================================================================
-- 20260715000000_fix_exam_master_rls.sql 롤백
-- 시험 기준정보 7개 테이블의 정책을 원래(20260712000000) 상태로 되돌린다.
-- ※ 되돌리면 403 이 다시 발생합니다(원래 정책이 동작하지 않는 상태였기 때문).
-- ※ 자동 실행되지 않습니다. 데이터는 수정/삭제하지 않습니다.
-- ============================================================================
do $do$
declare
  t text;
  tables text[] := array[
    'exam_categories', 'exam_groups', 'exam_parts', 'exam_processes',
    'exam_levels', 'exam_equipment', 'exam_rules'
  ];
begin
  foreach t in array tables loop
    if to_regclass('public.' || quote_ident(t)) is null then continue; end if;

    execute format('drop policy if exists %I on public.%I', 'exam_master_select', t);
    execute format('drop policy if exists %I on public.%I', 'exam_master_insert', t);
    execute format('drop policy if exists %I on public.%I', 'exam_master_update', t);

    -- 원래 정책 재생성(20260712000000_create_exam_management.sql 과 동일)
    execute format('drop policy if exists %I on public.%I', 'exam_admin_all', t);
    execute format(
      'create policy %I on public.%I for all using (auth.jwt() ->> %L = %L and auth.jwt() ->> %L = tenant_id) with check (auth.jwt() ->> %L = %L and auth.jwt() ->> %L = tenant_id)',
      'exam_admin_all', t, 'role', 'admin', 'tenant_id', 'role', 'admin', 'tenant_id'
    );
    execute format('drop policy if exists %I on public.%I', 'exam_viewer_select', t);
    execute format(
      'create policy %I on public.%I for select using (auth.jwt() ->> %L = %L and auth.jwt() ->> %L = tenant_id)',
      'exam_viewer_select', t, 'role', 'viewer', 'tenant_id'
    );
  end loop;
end
$do$;

drop function if exists public.is_exam_admin();
drop function if exists public.can_read_exam_master();
