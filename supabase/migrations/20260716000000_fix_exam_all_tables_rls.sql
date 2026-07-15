-- ============================================================================
-- 시험관리 전체 저장 경로 403 수정 (20260715000000 의 확장 · 이 파일 하나로 완결)
--
-- [배경]
--   20260712000000_create_exam_management.sql (16개 테이블) 과
--   20260712010000_exam_master_extra.sql (exam_groups/exam_equipment) 이
--   모든 시험 테이블에 아래 정책을 생성한다.
--     exam_admin_all    : FOR ALL    USING/WITH CHECK (auth.jwt() ->> 'role' = 'admin'
--                                     AND auth.jwt() ->> 'tenant_id' = tenant_id)
--     exam_viewer_select: FOR SELECT USING (auth.jwt() ->> 'role' = 'viewer' AND ...)
--   그러나 이 프로젝트는
--     - supabase/config.toml 의 [auth.hook.custom_access_token] 이 주석 처리(비활성)라
--       JWT 에 커스텀 클레임(role/tenant_id)이 존재하지 않고,
--     - 로그인은 supabase.auth.signInWithPassword (authService.ts:79) → auth.uid() 는 정상,
--     - 관리자 판정은 profiles.role = 'admin' (App.tsx:2016 canEditData) 이며,
--     - tenant_id 는 클라이언트 상수 'default' (App.tsx:3201) 이다.
--   따라서 실제 토큰에서 auth.jwt() ->> 'role' = 'authenticated', 'tenant_id' = NULL 이라
--   두 정책 조건이 항상 거짓 → 모든 INSERT/UPDATE 거부(42501 → HTTP 403),
--   SELECT 도 0건 반환. 시험관리 "전 메뉴"의 저장이 동일 원인으로 실패한다.
--
--   20260715000000_fix_exam_master_rls.sql 은 기준정보 7개 테이블만 복구했으므로
--   나머지 11개 테이블(인력현황/응시/PM·DM 인증/연간목표/월간실적/Excel 가져오기/감사로그)은
--   여전히 동일한 403 상태다. 이 마이그레이션이 18개 전체를 일괄 복구한다.
--
-- [방침]
--   - JWT 클레임 구조를 새로 만들지 않는다. 기존 profiles.role 권한 모델을 그대로 재사용.
--   - 시험관리 18개 테이블에만 적용(public 전체 일괄 부여 금지).
--   - SELECT / INSERT / UPDATE 분리, UPDATE 는 USING + WITH CHECK 모두 적용.
--   - USING (true) / WITH CHECK (true), anon 쓰기, RLS 비활성화 없음.
--   - DELETE 정책 없음 → soft delete(UPDATE) 구조 유지, 물리 삭제 차단.
--   - 기존 데이터/컬럼 변경 없음. 재실행해도 안전(idempotent).
--
-- ※ 자동 실행되지 않습니다. Supabase SQL Editor 에서 1회 실행해주세요.
--    롤백: 20260716000000_fix_exam_all_tables_rls_rollback.sql
-- ============================================================================

-- ── 1) 권한 판정 헬퍼 ────────────────────────────────────────────────────────
-- 정책에서 profiles 를 직접 조회하면 profiles 자신의 RLS 에 걸리므로 SECURITY DEFINER 로 감싼다.
-- (재귀 없음: profiles 의 정책은 exam_* 를 참조하지 않는다.)
create or replace function public.is_exam_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid()
       and p.role = 'admin'                 -- App.tsx canEditData() 와 동일 기준
       and coalesce(p.is_active, true)
  );
$$;

create or replace function public.can_read_exam_master()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid()
       and coalesce(p.is_active, true)
  );
$$;

revoke all on function public.is_exam_admin() from public, anon;
revoke all on function public.can_read_exam_master() from public, anon;
grant execute on function public.is_exam_admin() to authenticated;
grant execute on function public.can_read_exam_master() to authenticated;

-- ── 2) 시험관리 18개 테이블에만 정책/권한 적용 ───────────────────────────────
do $do$
declare
  t text;
  has_tenant boolean;
  tenant_ins text;
  tenant_upd text;
  tables text[] := array[
    -- 인증 기준관리(7)
    'exam_categories', 'exam_groups', 'exam_parts', 'exam_processes',
    'exam_levels', 'exam_equipment', 'exam_rules',
    -- 인력현황 / 응시 / 인증 / 목표 / 실적(8)
    'exam_personnel', 'exam_sessions', 'exam_applications', 'exam_results',
    'pm_certifications', 'dm_certifications', 'exam_annual_targets', 'exam_monthly_results',
    -- Excel 가져오기 / 감사로그(3)
    'exam_import_jobs', 'exam_import_errors', 'exam_audit_logs'
  ];
begin
  foreach t in array tables loop
    if to_regclass('public.' || quote_ident(t)) is null then
      raise notice '건너뜀(테이블 없음): %', t;
      continue;
    end if;

    -- tenant_id 컬럼이 실제로 있는 테이블에만 tenant 조건을 건다(없는 테이블에 걸면 42703).
    select exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = t and column_name = 'tenant_id'
    ) into has_tenant;
    tenant_ins := case when has_tenant then ' and tenant_id is not null' else '' end;
    tenant_upd := tenant_ins;

    execute format('alter table public.%I enable row level security', t);

    -- 동작하지 않는 기존 JWT 클레임 정책 + 본 마이그레이션이 만드는 정책만 정리(이름 중복 방지).
    -- 다른 이름의 기존 정책은 건드리지 않는다.
    execute format('drop policy if exists %I on public.%I', 'exam_admin_all', t);
    execute format('drop policy if exists %I on public.%I', 'exam_viewer_select', t);
    execute format('drop policy if exists %I on public.%I', 'exam_master_select', t);
    execute format('drop policy if exists %I on public.%I', 'exam_master_insert', t);
    execute format('drop policy if exists %I on public.%I', 'exam_master_update', t);

    -- SELECT: 로그인한 활성 사용자(기존 admin/viewer 조회 범위 유지)
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.can_read_exam_master())',
      'exam_master_select', t
    );

    -- INSERT: 관리자만 + tenant_id 필수
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.is_exam_admin()%s)',
      'exam_master_insert', t, tenant_ins
    );

    -- UPDATE: 관리자만. USING(대상 행) + WITH CHECK(변경 후 행) → tenant 변조 차단. soft delete 도 이 정책으로 처리.
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.is_exam_admin()%s) with check (public.is_exam_admin()%s)',
      'exam_master_update', t, tenant_upd, tenant_upd
    );

    -- DELETE 정책 없음 = 물리 삭제 차단.

    -- Grant: 대상 테이블에만, authenticated 에만. anon 쓰기 금지. DELETE 미부여.
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);
  end loop;
end
$do$;
