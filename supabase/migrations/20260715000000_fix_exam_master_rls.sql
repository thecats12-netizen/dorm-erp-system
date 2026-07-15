-- ============================================================================
-- 시험관리 > 인증 기준관리 저장 403(Forbidden) 수정
--
-- [원인]
--   20260712000000_create_exam_management.sql 이 시험 기준정보 테이블에
--   아래 정책을 생성한다.
--     exam_admin_all    : FOR ALL   USING/WITH CHECK (auth.jwt() ->> 'role' = 'admin'
--                                    AND auth.jwt() ->> 'tenant_id' = tenant_id)
--     exam_viewer_select: FOR SELECT USING (auth.jwt() ->> 'role' = 'viewer' AND ...)
--   그러나 이 프로젝트는
--     - supabase/config.toml 에서 [auth.hook.custom_access_token] 이 주석 처리(비활성)되어 있어
--       JWT 에 커스텀 클레임(role/tenant_id)이 들어가지 않고,
--     - 권한은 profiles.role (authService.ts:274 `role: profile.role`) 로 판정하며,
--     - tenant_id 는 클라이언트 상수 'default' (App.tsx:3201) 이다.
--   따라서 실제 토큰에서 auth.jwt() ->> 'role' 은 'authenticated', 'tenant_id' 는 NULL 이라
--   exam_admin_all 조건이 항상 거짓 → 모든 INSERT/UPDATE 거부(42501 → HTTP 403),
--   exam_viewer_select 도 항상 거짓 → SELECT 가 0건.
--
-- [수정 방침]
--   - JWT 클레임 구조를 새로 만들지 않는다. 기존 profiles.role 권한 모델을 그대로 재사용한다.
--   - 대상은 시험 기준정보 7개 테이블로만 한정한다(다른 public 테이블 일괄 부여 금지).
--   - SELECT / INSERT / UPDATE 를 분리하고, UPDATE 는 USING + WITH CHECK 를 모두 적용한다.
--   - USING (true) / WITH CHECK (true) 형태의 무조건 허용, anon 쓰기 허용은 만들지 않는다.
--   - DELETE 정책은 추가하지 않는다(기존 기능은 soft delete = UPDATE 만 사용).
--   - 기존 데이터는 수정/삭제하지 않는다.
--
-- ※ 자동 실행되지 않습니다. Supabase SQL Editor 에서 직접 실행해주세요.
--    롤백 SQL: 20260715000000_fix_exam_master_rls_rollback.sql
-- ============================================================================

-- ── 1) 권한 판정 헬퍼 ────────────────────────────────────────────────────────
-- profiles 를 정책에서 직접 조회하면 profiles 자신의 RLS 에 걸려 판정이 불안정하므로
-- SECURITY DEFINER 함수로 감싼다(재귀 없음: profiles 정책은 exam_* 를 참조하지 않음).
create or replace function public.is_exam_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.profiles p
     where p.id = auth.uid()
       and p.role = 'admin'
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
    select 1
      from public.profiles p
     where p.id = auth.uid()
       and coalesce(p.is_active, true)
  );
$$;

revoke all on function public.is_exam_admin() from public, anon;
revoke all on function public.can_read_exam_master() from public, anon;
grant execute on function public.is_exam_admin() to authenticated;
grant execute on function public.can_read_exam_master() to authenticated;

-- ── 2) 시험 기준정보 7개 테이블에만 정책/권한 적용 ───────────────────────────
do $do$
declare
  t text;
  tables text[] := array[
    'exam_categories', 'exam_groups', 'exam_parts', 'exam_processes',
    'exam_levels', 'exam_equipment', 'exam_rules'
  ];
begin
  foreach t in array tables loop
    if to_regclass('public.' || quote_ident(t)) is null then
      raise notice '건너뜀(테이블 없음): %', t;
      continue;
    end if;

    execute format('alter table public.%I enable row level security', t);

    -- 동작하지 않는 기존 JWT 클레임 기반 정책만 정리한다(다른 정책은 건드리지 않음).
    execute format('drop policy if exists %I on public.%I', 'exam_admin_all', t);
    execute format('drop policy if exists %I on public.%I', 'exam_viewer_select', t);
    execute format('drop policy if exists %I on public.%I', 'exam_master_select', t);
    execute format('drop policy if exists %I on public.%I', 'exam_master_insert', t);
    execute format('drop policy if exists %I on public.%I', 'exam_master_update', t);

    -- SELECT: 로그인한 활성 사용자(admin/viewer 등 기존 역할 전부)
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.can_read_exam_master())',
      'exam_master_select', t
    );

    -- INSERT: 관리자만. tenant_id 는 반드시 채워져 있어야 한다(전체 조직 무조건 허용 아님).
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.is_exam_admin() and tenant_id is not null)',
      'exam_master_insert', t
    );

    -- UPDATE: 관리자만. USING(대상 행) + WITH CHECK(변경 후 행) 모두 적용 → tenant_id 변조 차단.
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.is_exam_admin() and tenant_id is not null) with check (public.is_exam_admin() and tenant_id is not null)',
      'exam_master_update', t
    );

    -- DELETE 정책 없음 = 물리 삭제 차단(기존 soft delete 정책 유지).

    -- 권한 부여: 대상 테이블에만, authenticated 에만. anon 쓰기 금지.
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);
  end loop;
end
$do$;
