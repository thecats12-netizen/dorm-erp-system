-- ============================================================================
-- 시험관리 공정별 담당자 권한 — 구현 SQL (SQL Editor 에서 1회 실행 · 자동 실행 아님)
--   승인된 설계(_draft_exam_process_scopes.sql) 기준. 재실행 안전(idempotent).
--
-- [권한 모델]  기존 시스템 role 미변경. 시험관리 전용 차원만 추가.
--   exam_role_of(uid):
--     role='admin'            → 'super'   (시험 총관리자 · 기준관리 포함 전권 · 기존 admin 무회귀)
--     exam_role 명시값         → 그 값      ('admin'|'process_owner'|'viewer')
--     role='viewer'(기타 없음) → 'viewer'  (기존 viewer 의 시험 전체 읽기 유지 · 무회귀)
--     그 외(maintenance_reporter/dorm_manager/manager) → NULL (시험관리 전면 차단)
--   공정 단위 세부권한 = exam_user_process_scopes (사용자 × 공정, N:N + 플래그).
--
-- [적용 범위]
--   기준정보(7): categories/groups/parts/processes/levels/equipment/rules
--     → 읽기=시험사용자(exam_role_of not null), 쓰기=super(=인증 기준관리 권한)
--   운영 스코프(process_id 보유): personnel/annual_targets/monthly_results/pm_cert/dm_cert
--     + applications(process_id 신규+백필) + results(personnel 경유)
--     → 읽기=admin|viewer|scope, 쓰기=admin|scope(create/update), 승인=admin|scope(approve)
--   인프라(sessions/import_jobs/import_errors/audit_logs/retest_candidates)
--     → 읽기=시험사용자, 쓰기=admin
--   ※ USING(true)/WITH CHECK(true)·anon 쓰기·RLS 비활성화·물리 DELETE 정책 없음.
-- ============================================================================


-- ── 1) 시험 역할 컬럼(additive · nullable) ─────────────────────────────────
alter table public.profiles
  add column if not exists exam_role text
    check (exam_role is null or exam_role in ('super','admin','process_owner','viewer'));


-- ── 2) 공정별 담당자 스코프 테이블 ─────────────────────────────────────────
create table if not exists public.exam_user_process_scopes (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'default',
  organization_id text,
  user_id uuid not null references public.profiles(id) on delete cascade,
  process_id uuid not null references public.exam_processes(id) on delete cascade,
  can_view    boolean not null default true,
  can_create  boolean not null default false,
  can_update  boolean not null default false,
  can_approve boolean not null default false,
  can_export  boolean not null default false,
  is_active   boolean not null default true,
  created_by uuid, created_at timestamptz not null default now(),
  updated_by uuid, updated_at timestamptz not null default now(),
  unique (tenant_id, user_id, process_id)
);
create index if not exists idx_eups_user    on public.exam_user_process_scopes(tenant_id, user_id)    where is_active;
create index if not exists idx_eups_process on public.exam_user_process_scopes(tenant_id, process_id) where is_active;


-- ── 3) 응시관리 공정 정규화: process_id 추가 + 이름/코드 매칭 백필(데이터 손상 없음) ──
alter table public.exam_applications add column if not exists process_id uuid references public.exam_processes(id) on delete set null;
update public.exam_applications a
   set process_id = ep.id
  from public.exam_processes ep
 where a.process_id is null
   and a.process is not null and btrim(a.process) <> ''
   and ep.tenant_id = a.tenant_id and ep.deleted_at is null
   and (ep.name = btrim(a.process) or ep.code = btrim(a.process));


-- ── 4) 권한 판정 헬퍼(SECURITY DEFINER — 재귀 회피) ───────────────────────────
create or replace function public.exam_role_of(uid uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from public.profiles p where p.id = uid and p.role = 'admin'  and coalesce(p.is_active,true)) then 'super'
    when (select p.exam_role from public.profiles p where p.id = uid and coalesce(p.is_active,true)) is not null
      then (select p.exam_role from public.profiles p where p.id = uid and coalesce(p.is_active,true))
    when exists (select 1 from public.profiles p where p.id = uid and p.role = 'viewer' and coalesce(p.is_active,true)) then 'viewer'
    else null end;
$$;
create or replace function public.exam_is_super(uid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select public.exam_role_of(uid) = 'super'; $$;
create or replace function public.exam_is_admin(uid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select public.exam_role_of(uid) in ('super','admin'); $$;
create or replace function public.exam_is_viewer_all(uid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select public.exam_role_of(uid) = 'viewer'; $$;
create or replace function public.exam_can_access(uid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select public.exam_role_of(uid) is not null; $$;
create or replace function public.exam_scope_allows(uid uuid, p_process uuid, perm text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.exam_user_process_scopes s
    where s.user_id = uid and s.process_id = p_process and s.is_active
      and case perm when 'view' then s.can_view when 'create' then s.can_create
                    when 'update' then s.can_update when 'approve' then s.can_approve
                    when 'export' then s.can_export else false end); $$;
-- 쓰기 후 .select() 반환을 위해 읽기는 view/create/update/approve 중 하나라도 있으면 허용
create or replace function public.exam_scope_readable(uid uuid, p_process uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.exam_user_process_scopes s
    where s.user_id = uid and s.process_id = p_process and s.is_active
      and (s.can_view or s.can_create or s.can_update or s.can_approve)); $$;

revoke all on function public.exam_role_of(uuid), public.exam_is_super(uuid), public.exam_is_admin(uuid),
  public.exam_is_viewer_all(uuid), public.exam_can_access(uuid), public.exam_scope_allows(uuid,uuid,text),
  public.exam_scope_readable(uuid,uuid) from public, anon;
grant execute on function public.exam_role_of(uuid), public.exam_is_super(uuid), public.exam_is_admin(uuid),
  public.exam_is_viewer_all(uuid), public.exam_can_access(uuid), public.exam_scope_allows(uuid,uuid,text),
  public.exam_scope_readable(uuid,uuid) to authenticated;


-- ── 5) 스코프 테이블 grant + 자체 RLS(관리=super, 본인 조회 허용) ─────────────
revoke all on public.exam_user_process_scopes from anon;
grant select, insert, update on public.exam_user_process_scopes to authenticated;
alter table public.exam_user_process_scopes enable row level security;
drop policy if exists eups_select on public.exam_user_process_scopes;
create policy eups_select on public.exam_user_process_scopes for select to authenticated
  using (public.exam_is_super(auth.uid()) or user_id = auth.uid());
drop policy if exists eups_insert on public.exam_user_process_scopes;
create policy eups_insert on public.exam_user_process_scopes for insert to authenticated
  with check (public.exam_is_super(auth.uid()) and tenant_id is not null);
drop policy if exists eups_update on public.exam_user_process_scopes;
create policy eups_update on public.exam_user_process_scopes for update to authenticated
  using (public.exam_is_super(auth.uid())) with check (public.exam_is_super(auth.uid()));


-- ── 6) 기존(20260716) 정책 정리 후 새 정책 적용 ──────────────────────────────
--   6-1) 기준정보(7) + 인프라: 시험사용자 읽기 / 쓰기(super=기준정보, admin=인프라)
do $m$
declare t text;
  master7 text[] := array['exam_categories','exam_groups','exam_parts','exam_processes','exam_levels','exam_equipment','exam_rules'];
  infra   text[] := array['exam_sessions','exam_import_jobs','exam_import_errors','exam_audit_logs','exam_retest_candidates'];
  wr text;
begin
  foreach t in array (master7 || infra) loop
    if to_regclass('public.'||quote_ident(t)) is null then continue; end if;
    execute format('alter table public.%I enable row level security', t);
    -- 이전 정책 제거(무동작 JWT 정책 + 20260716 정책 + 본 정책)
    foreach wr in array array['exam_admin_all','exam_viewer_select','exam_master_select','exam_master_insert','exam_master_update','exam_acc_select','exam_acc_insert','exam_acc_update'] loop
      execute format('drop policy if exists %I on public.%I', wr, t);
    end loop;
    -- SELECT: 시험 사용자(any exam_role)만
    execute format('create policy %I on public.%I for select to authenticated using (public.exam_can_access(auth.uid()))','exam_acc_select', t);
    wr := case when t = any(master7) then 'public.exam_is_super(auth.uid())' else 'public.exam_is_admin(auth.uid())' end;
    execute format('create policy %I on public.%I for insert to authenticated with check (%s and tenant_id is not null)','exam_acc_insert', t, wr);
    execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)','exam_acc_update', t, wr, wr);
  end loop;
end $m$;

--   6-2) 운영 스코프(process_id 보유 5종): admin|viewer|scope 읽기, admin|scope 쓰기
do $s$
declare t text;
  scoped text[] := array['exam_personnel','exam_annual_targets','exam_monthly_results','pm_certifications','dm_certifications'];
  p text;
begin
  foreach t in array scoped loop
    if to_regclass('public.'||quote_ident(t)) is null then continue; end if;
    execute format('alter table public.%I enable row level security', t);
    foreach p in array array['exam_admin_all','exam_viewer_select','exam_master_select','exam_master_insert','exam_master_update','exam_scope_select','exam_scope_insert','exam_scope_update'] loop
      execute format('drop policy if exists %I on public.%I', p, t);
    end loop;
    execute format($f$create policy exam_scope_select on public.%I for select to authenticated
      using (public.exam_is_admin(auth.uid()) or public.exam_is_viewer_all(auth.uid()) or public.exam_scope_readable(auth.uid(), process_id))$f$, t);
    execute format($f$create policy exam_scope_insert on public.%I for insert to authenticated
      with check ((public.exam_is_admin(auth.uid()) or public.exam_scope_allows(auth.uid(), process_id, 'create')) and tenant_id is not null)$f$, t);
    execute format($f$create policy exam_scope_update on public.%I for update to authenticated
      using (public.exam_is_admin(auth.uid()) or public.exam_scope_allows(auth.uid(), process_id, 'update') or public.exam_scope_allows(auth.uid(), process_id, 'approve'))
      with check (public.exam_is_admin(auth.uid()) or public.exam_scope_allows(auth.uid(), process_id, 'update') or public.exam_scope_allows(auth.uid(), process_id, 'approve'))$f$, t);
  end loop;
end $s$;

--   6-3) 응시관리(process_id 신규): 위와 동일 규칙. 단 process_id NULL 행은 admin/viewer 만 접근.
do $a$
begin
  if to_regclass('public.exam_applications') is not null then
    alter table public.exam_applications enable row level security;
    drop policy if exists exam_admin_all on public.exam_applications;
    drop policy if exists exam_viewer_select on public.exam_applications;
    drop policy if exists exam_master_select on public.exam_applications;
    drop policy if exists exam_master_insert on public.exam_applications;
    drop policy if exists exam_master_update on public.exam_applications;
    drop policy if exists exam_scope_select on public.exam_applications;
    drop policy if exists exam_scope_insert on public.exam_applications;
    drop policy if exists exam_scope_update on public.exam_applications;
    create policy exam_scope_select on public.exam_applications for select to authenticated
      using (public.exam_is_admin(auth.uid()) or public.exam_is_viewer_all(auth.uid())
             or (process_id is not null and public.exam_scope_readable(auth.uid(), process_id)));
    create policy exam_scope_insert on public.exam_applications for insert to authenticated
      with check ((public.exam_is_admin(auth.uid()) or (process_id is not null and public.exam_scope_allows(auth.uid(), process_id, 'create'))) and tenant_id is not null);
    create policy exam_scope_update on public.exam_applications for update to authenticated
      using (public.exam_is_admin(auth.uid()) or (process_id is not null and (public.exam_scope_allows(auth.uid(), process_id, 'update') or public.exam_scope_allows(auth.uid(), process_id, 'approve'))))
      with check (public.exam_is_admin(auth.uid()) or (process_id is not null and (public.exam_scope_allows(auth.uid(), process_id, 'update') or public.exam_scope_allows(auth.uid(), process_id, 'approve'))));
  end if;
end $a$;

--   6-4) exam_results(process_id 없음): 연결된 personnel 의 process_id 로 간접 스코프.
do $r$
begin
  if to_regclass('public.exam_results') is not null then
    alter table public.exam_results enable row level security;
    drop policy if exists exam_admin_all on public.exam_results;
    drop policy if exists exam_viewer_select on public.exam_results;
    drop policy if exists exam_master_select on public.exam_results;
    drop policy if exists exam_master_insert on public.exam_results;
    drop policy if exists exam_master_update on public.exam_results;
    drop policy if exists exam_scope_select on public.exam_results;
    drop policy if exists exam_scope_insert on public.exam_results;
    drop policy if exists exam_scope_update on public.exam_results;
    create policy exam_scope_select on public.exam_results for select to authenticated
      using (public.exam_is_admin(auth.uid()) or public.exam_is_viewer_all(auth.uid())
             or exists (select 1 from public.exam_personnel ep where ep.id = exam_results.personnel_id
                        and ep.process_id is not null and public.exam_scope_readable(auth.uid(), ep.process_id)));
    create policy exam_scope_insert on public.exam_results for insert to authenticated
      with check ((public.exam_is_admin(auth.uid())
             or exists (select 1 from public.exam_personnel ep where ep.id = exam_results.personnel_id
                        and ep.process_id is not null and public.exam_scope_allows(auth.uid(), ep.process_id, 'create'))) and tenant_id is not null);
    create policy exam_scope_update on public.exam_results for update to authenticated
      using (public.exam_is_admin(auth.uid())
             or exists (select 1 from public.exam_personnel ep where ep.id = exam_results.personnel_id
                        and ep.process_id is not null and public.exam_scope_allows(auth.uid(), ep.process_id, 'update')))
      with check (public.exam_is_admin(auth.uid())
             or exists (select 1 from public.exam_personnel ep where ep.id = exam_results.personnel_id
                        and ep.process_id is not null and public.exam_scope_allows(auth.uid(), ep.process_id, 'update')));
  end if;
end $r$;

-- ── 7) grant 재확인(대상 테이블에만 · anon 쓰기 없음) ─────────────────────────
do $g$
declare t text;
  allt text[] := array['exam_categories','exam_groups','exam_parts','exam_processes','exam_levels','exam_equipment','exam_rules',
    'exam_personnel','exam_sessions','exam_applications','exam_results','pm_certifications','dm_certifications',
    'exam_annual_targets','exam_monthly_results','exam_import_jobs','exam_import_errors','exam_audit_logs','exam_retest_candidates'];
begin
  foreach t in array allt loop
    if to_regclass('public.'||quote_ident(t)) is null then continue; end if;
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);
  end loop;
end $g$;
