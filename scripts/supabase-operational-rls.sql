-- =====================================================================
-- 운영 모듈 RLS 보강: cleaning_reports / defect_requests / inventory_items
-- ---------------------------------------------------------------------
-- 기존 dorm 계열 RLS와 동일한 JWT 클레임 방식 사용:
--   auth.jwt() ->> 'role', auth.jwt() ->> 'tenant_id', auth.jwt() ->> 'dorm_id'
-- 권한:
--   admin               : SELECT/INSERT/UPDATE/DELETE
--   viewer              : SELECT
--   dorm_manager        : 본인 담당 기숙사 SELECT + 제한적 UPDATE(청소/하자)
--   maintenance_reporter: 본인 담당 기숙사 SELECT + INSERT(청소/하자 등록)
--   inventory_items     : admin만 쓰기, 나머지는 SELECT(담당자는 본인 기숙사만)
--
-- 안전장치:
--   - 트랜잭션으로 원자 적용(중간 실패 시 전체 롤백 → RLS만 켜지고 정책 없는 상태 방지)
--   - 정책은 DROP IF EXISTS 후 CREATE → 재실행해도 중복 오류 없음(idempotent)
--   - 테이블/컬럼/데이터 변경 없음
-- =====================================================================

begin;

-- 1) RLS 활성화 (이미 켜져 있어도 오류 없음)
alter table public.cleaning_reports enable row level security;
alter table public.defect_requests  enable row level security;
alter table public.inventory_items  enable row level security;

-- =========================== cleaning_reports ===========================
drop policy if exists "cleaning_admin_all"            on public.cleaning_reports;
drop policy if exists "cleaning_viewer_select"        on public.cleaning_reports;
drop policy if exists "cleaning_dm_select"            on public.cleaning_reports;
drop policy if exists "cleaning_dm_update"            on public.cleaning_reports;
drop policy if exists "cleaning_reporter_select"      on public.cleaning_reports;
drop policy if exists "cleaning_reporter_insert"      on public.cleaning_reports;
drop policy if exists "cleaning_dm_insert"            on public.cleaning_reports;
drop policy if exists "cleaning_reporter_update"      on public.cleaning_reports;

create policy "cleaning_admin_all" on public.cleaning_reports for all
  using (auth.jwt() ->> 'role' = 'admin' and auth.jwt() ->> 'tenant_id' = tenant_id)
  with check (auth.jwt() ->> 'role' = 'admin' and auth.jwt() ->> 'tenant_id' = tenant_id);

create policy "cleaning_viewer_select" on public.cleaning_reports for select
  using (auth.jwt() ->> 'role' = 'viewer' and auth.jwt() ->> 'tenant_id' = tenant_id);

create policy "cleaning_dm_select" on public.cleaning_reports for select
  using (auth.jwt() ->> 'role' = 'dorm_manager' and auth.jwt() ->> 'tenant_id' = tenant_id and dorm_id = auth.jwt() ->> 'dorm_id');

create policy "cleaning_dm_update" on public.cleaning_reports for update
  using (auth.jwt() ->> 'role' = 'dorm_manager' and auth.jwt() ->> 'tenant_id' = tenant_id and dorm_id = auth.jwt() ->> 'dorm_id')
  with check (auth.jwt() ->> 'role' = 'dorm_manager' and auth.jwt() ->> 'tenant_id' = tenant_id and dorm_id = auth.jwt() ->> 'dorm_id');

create policy "cleaning_reporter_select" on public.cleaning_reports for select
  using (auth.jwt() ->> 'role' = 'maintenance_reporter' and auth.jwt() ->> 'tenant_id' = tenant_id and dorm_id = auth.jwt() ->> 'dorm_id');

create policy "cleaning_reporter_insert" on public.cleaning_reports for insert
  with check (auth.jwt() ->> 'role' = 'maintenance_reporter' and auth.jwt() ->> 'tenant_id' = tenant_id and dorm_id = auth.jwt() ->> 'dorm_id');

-- dorm_manager 도 본인 기숙사 청소보고 등록 가능(앱 canCreateCleaningReport 에 dorm_manager 포함)
create policy "cleaning_dm_insert" on public.cleaning_reports for insert
  with check (auth.jwt() ->> 'role' = 'dorm_manager' and auth.jwt() ->> 'tenant_id' = tenant_id and dorm_id = auth.jwt() ->> 'dorm_id');

-- maintenance_reporter 본인 기숙사 청소보고 수정 가능(앱에서 본인 작성분 수정 + 모듈 일괄 upsert 시 UPDATE 발생)
create policy "cleaning_reporter_update" on public.cleaning_reports for update
  using (auth.jwt() ->> 'role' = 'maintenance_reporter' and auth.jwt() ->> 'tenant_id' = tenant_id and dorm_id = auth.jwt() ->> 'dorm_id')
  with check (auth.jwt() ->> 'role' = 'maintenance_reporter' and auth.jwt() ->> 'tenant_id' = tenant_id and dorm_id = auth.jwt() ->> 'dorm_id');

-- =========================== defect_requests ============================
drop policy if exists "defect_admin_all"              on public.defect_requests;
drop policy if exists "defect_viewer_select"          on public.defect_requests;
drop policy if exists "defect_dm_select"              on public.defect_requests;
drop policy if exists "defect_dm_update"              on public.defect_requests;
drop policy if exists "defect_reporter_select"        on public.defect_requests;
drop policy if exists "defect_reporter_insert"        on public.defect_requests;
drop policy if exists "defect_reporter_update"        on public.defect_requests;

create policy "defect_admin_all" on public.defect_requests for all
  using (auth.jwt() ->> 'role' = 'admin' and auth.jwt() ->> 'tenant_id' = tenant_id)
  with check (auth.jwt() ->> 'role' = 'admin' and auth.jwt() ->> 'tenant_id' = tenant_id);

create policy "defect_viewer_select" on public.defect_requests for select
  using (auth.jwt() ->> 'role' = 'viewer' and auth.jwt() ->> 'tenant_id' = tenant_id);

create policy "defect_dm_select" on public.defect_requests for select
  using (auth.jwt() ->> 'role' = 'dorm_manager' and auth.jwt() ->> 'tenant_id' = tenant_id and dorm_id = auth.jwt() ->> 'dorm_id');

create policy "defect_dm_update" on public.defect_requests for update
  using (auth.jwt() ->> 'role' = 'dorm_manager' and auth.jwt() ->> 'tenant_id' = tenant_id and dorm_id = auth.jwt() ->> 'dorm_id')
  with check (auth.jwt() ->> 'role' = 'dorm_manager' and auth.jwt() ->> 'tenant_id' = tenant_id and dorm_id = auth.jwt() ->> 'dorm_id');

create policy "defect_reporter_select" on public.defect_requests for select
  using (auth.jwt() ->> 'role' = 'maintenance_reporter' and auth.jwt() ->> 'tenant_id' = tenant_id and dorm_id = auth.jwt() ->> 'dorm_id');

create policy "defect_reporter_insert" on public.defect_requests for insert
  with check (auth.jwt() ->> 'role' = 'maintenance_reporter' and auth.jwt() ->> 'tenant_id' = tenant_id and dorm_id = auth.jwt() ->> 'dorm_id');

-- maintenance_reporter 본인 기숙사 하자접수 수정 가능(본인 작성분 수정 + 모듈 일괄 upsert 시 UPDATE 발생)
create policy "defect_reporter_update" on public.defect_requests for update
  using (auth.jwt() ->> 'role' = 'maintenance_reporter' and auth.jwt() ->> 'tenant_id' = tenant_id and dorm_id = auth.jwt() ->> 'dorm_id')
  with check (auth.jwt() ->> 'role' = 'maintenance_reporter' and auth.jwt() ->> 'tenant_id' = tenant_id and dorm_id = auth.jwt() ->> 'dorm_id');

-- =========================== inventory_items ===========================
-- 쓰기는 admin만, 나머지는 조회만 (담당자는 본인 기숙사 행만 조회)
drop policy if exists "inventory_admin_all"           on public.inventory_items;
drop policy if exists "inventory_viewer_select"       on public.inventory_items;
drop policy if exists "inventory_dm_select"           on public.inventory_items;
drop policy if exists "inventory_reporter_select"     on public.inventory_items;

create policy "inventory_admin_all" on public.inventory_items for all
  using (auth.jwt() ->> 'role' = 'admin' and auth.jwt() ->> 'tenant_id' = tenant_id)
  with check (auth.jwt() ->> 'role' = 'admin' and auth.jwt() ->> 'tenant_id' = tenant_id);

create policy "inventory_viewer_select" on public.inventory_items for select
  using (auth.jwt() ->> 'role' = 'viewer' and auth.jwt() ->> 'tenant_id' = tenant_id);

create policy "inventory_dm_select" on public.inventory_items for select
  using (auth.jwt() ->> 'role' = 'dorm_manager' and auth.jwt() ->> 'tenant_id' = tenant_id and dorm_id = auth.jwt() ->> 'dorm_id');

create policy "inventory_reporter_select" on public.inventory_items for select
  using (auth.jwt() ->> 'role' = 'maintenance_reporter' and auth.jwt() ->> 'tenant_id' = tenant_id and dorm_id = auth.jwt() ->> 'dorm_id');

commit;

-- =====================================================================
-- 확인 쿼리 (적용 후 실행)
-- =====================================================================

-- (A) RLS 활성화 여부 — 7개 테이블 모두 rls_enabled = true 여야 함
select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('dorms','occupants','new_hires','dorm_contracts',
                    'cleaning_reports','defect_requests','inventory_items')
order by c.relname;

-- (B) 신규 3개 운영 테이블 정책 목록
select tablename, policyname, cmd, roles
from pg_policies
where schemaname = 'public'
  and tablename in ('cleaning_reports','defect_requests','inventory_items')
order by tablename, cmd, policyname;

-- (C) dorm 계열 4개 테이블 RLS 정책이 role/tenant_id 기준으로 동작하는지 확인
--     qual(using)/with_check 식에 auth.jwt() ->> 'role' / 'tenant_id' 가 보여야 정상
select tablename, policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('dorms','occupants','new_hires','dorm_contracts')
order by tablename, cmd, policyname;

-- (D) JWT 클레임 점검 안내
--     SQL Editor 는 service_role 로 실행되어 아래 결과가 NULL 입니다(정상).
--     실제 클레임은 로그인한 앱(브라우저)에서 확인해야 합니다:
--       const { data } = await supabase.auth.getSession();
--       JSON.parse(atob(data.session.access_token.split('.')[1]))
--     결과에 role / tenant_id / dorm_id / site_access 가 있어야 RLS 가 정상 동작합니다.
select auth.jwt() ->> 'role' as jwt_role, auth.jwt() ->> 'tenant_id' as jwt_tenant;
