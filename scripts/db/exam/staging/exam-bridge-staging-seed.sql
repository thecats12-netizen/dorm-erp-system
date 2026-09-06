-- ============================================================================
-- ⚠⚠⚠  STAGING 전용 · PRODUCTION 실행 금지 · 가짜 데이터만  ⚠⚠⚠
-- 시험 브리지 검증용 seed. 실제 회사명/사용자명/전화/이메일/실데이터 사용 금지.
--
-- [실행 전 필수] 아래 __T_*_UUID__ 자리표시자를 staging Auth 에서 생성한 실제 user UUID 로 치환한다.
--   치환하지 않으면 '__T_..__'::uuid 캐스트가 "invalid input syntax for type uuid" 로 즉시 실패한다(=guard).
--   staging Auth 계정 7개 생성 → 각 UUID 복사 → 아래 전부 치환 → 실행.
-- 재실행 시 중복 방지를 위해 상단에서 테스트 데이터만 정리(가짜 데이터 한정 · Production 아님).
-- ============================================================================

-- (재실행 편의) 이전 seed 정리 — 이 파일이 만든 가짜 데이터만.
delete from public.exam_test_apps  where tenant_id='default';
delete from public.exam_test_certs where tenant_id='default';
delete from public.exam_user_process_scopes where tenant_id='default';
delete from public.custom_role_scopes where tenant_id='default';
delete from public.custom_role_permissions where tenant_id='default';
delete from public.user_custom_roles where tenant_id='default';
delete from public.custom_roles where tenant_id='default';
delete from public.exam_processes where tenant_id='default';
delete from public.exam_categories where tenant_id='default';
delete from public.exam_groups where tenant_id='default';
-- profiles 는 Auth 매핑이므로 upsert 로 관리(삭제하지 않음).

-- ── 1) 시험 계층(가짜) ──────────────────────────────────────────────────────
insert into public.exam_groups(id, code, name) values
  (gen_random_uuid(),'G1','TEST_GROUP_1'),
  (gen_random_uuid(),'G2','TEST_GROUP_2');
insert into public.exam_categories(id, group_id, code, name)
  select gen_random_uuid(), g.id, 'A', 'TEST_PRODGRP_A' from public.exam_groups g where g.code='G1';
insert into public.exam_categories(id, group_id, code, name)
  select gen_random_uuid(), g.id, 'B', 'TEST_PRODGRP_B' from public.exam_groups g where g.code='G2';
insert into public.exam_processes(id, group_id, category_id, code, name)
  select gen_random_uuid(), c.group_id, c.id, 'CMP', 'TEST_CMP'  from public.exam_categories c where c.code='A';
insert into public.exam_processes(id, group_id, category_id, code, name)
  select gen_random_uuid(), c.group_id, c.id, 'CVD', 'TEST_CVD'  from public.exam_categories c where c.code='A';
insert into public.exam_processes(id, group_id, category_id, code, name)
  select gen_random_uuid(), c.group_id, c.id, 'ETCH','TEST_ETCH' from public.exam_categories c where c.code='B';

-- 운영 테스트 row(각 process 1건씩, 두 탭 테이블 모두)
insert into public.exam_test_apps(process_id, label)  select id, 'TEST_APP_'||code  from public.exam_processes;
insert into public.exam_test_certs(process_id, label) select id, 'TEST_CERT_'||code from public.exam_processes;

-- ── 2) 테스트 계정 profiles(Auth UUID 치환 필수) ────────────────────────────
insert into public.profiles(id, role, exam_role, is_active) values
  ('__T_ADMIN_UUID__'::uuid,        'admin',  null, true),          -- super
  ('__T_VIEWER_UUID__'::uuid,       'viewer', null, true),          -- viewer(전체 읽기)
  ('__T_DIRECT_UUID__'::uuid,       'viewer', 'process_owner', true),-- direct scope 대상(아래 CMP 부여)
  ('__T_CUSTOM_UUID__'::uuid,       'viewer', null, true),          -- custom CVD read
  ('__T_CUSTOM_ALL_UUID__'::uuid,   'viewer', null, true),          -- custom all read
  ('__T_CUSTOM_WRITE_UUID__'::uuid, 'viewer', null, true),          -- custom CVD write
  ('__T_COARSE_UUID__'::uuid,       'viewer', null, true)           -- coarse 검증(examApplications.update만)
on conflict (id) do update set role=excluded.role, exam_role=excluded.exam_role, is_active=excluded.is_active;

-- ── 3) direct scope(t_direct = CMP only, view+create+update) ─────────────────
insert into public.exam_user_process_scopes(user_id, process_id, can_view, can_create, can_update, can_approve, can_export)
  select '__T_DIRECT_UUID__'::uuid, p.id, true, true, true, false, false from public.exam_processes p where p.code='CMP';

-- ── 4) custom roles(가짜) ───────────────────────────────────────────────────
insert into public.custom_roles(id, code, name, permission_mode, is_active, is_deleted) values
  (gen_random_uuid(),'t_cvd_read',  'TEST_CVD_READ',  'restrictive', true, false),
  (gen_random_uuid(),'t_all_read',  'TEST_ALL_READ',  'restrictive', true, false),
  (gen_random_uuid(),'t_cvd_write', 'TEST_CVD_WRITE', 'restrictive', true, false),
  (gen_random_uuid(),'t_no_menu',   'TEST_NO_MENU',   'restrictive', true, false),
  (gen_random_uuid(),'t_coarse',    'TEST_COARSE',    'restrictive', true, false);

-- 4-1) 메뉴·기능 권한(exam 탭 permission_key)
--   CVD read: examApplications.menu_view
insert into public.custom_role_permissions(custom_role_id, permission_key)
  select id, 'examApplications.menu_view' from public.custom_roles where code in ('t_cvd_read','t_all_read');
--   CVD write: menu_view + create + update
insert into public.custom_role_permissions(custom_role_id, permission_key)
  select id, k from public.custom_roles cr
    cross join (values ('examApplications.menu_view'),('examApplications.create'),('examApplications.update')) v(k)
  where cr.code='t_cvd_write';
--   no_menu: 메뉴 권한 없음(process scope만) — 일부러 미부여
--   coarse: examApplications.update 는 있음, examPmCertifications.update 는 없음(→ certs 테이블 update 시도 시 leak 검증)
insert into public.custom_role_permissions(custom_role_id, permission_key)
  select id, k from public.custom_roles cr
    cross join (values ('examApplications.menu_view'),('examApplications.update')) v(k)
  where cr.code='t_coarse';

-- 4-2) 데이터 범위(process scope)
--   CVD read/write → 특정 process CVD
insert into public.custom_role_scopes(custom_role_id, scope_type, scope_value, action_scope)
  select cr.id, 'process', p.id::text, 'read'
    from public.custom_roles cr, public.exam_processes p where cr.code='t_cvd_read' and p.code='CVD';
insert into public.custom_role_scopes(custom_role_id, scope_type, scope_value, action_scope)
  select cr.id, 'process', p.id::text, 'write'
    from public.custom_roles cr, public.exam_processes p where cr.code='t_cvd_write' and p.code='CVD';
--   all read → scope_value='all'
insert into public.custom_role_scopes(custom_role_id, scope_type, scope_value, action_scope)
  select id, 'process', 'all', 'read' from public.custom_roles where code='t_all_read';
--   no_menu → process CVD 지정하지만 메뉴권한 없음(차단되어야 함)
insert into public.custom_role_scopes(custom_role_id, scope_type, scope_value, action_scope)
  select cr.id, 'process', p.id::text, 'read'
    from public.custom_roles cr, public.exam_processes p where cr.code='t_no_menu' and p.code='CVD';
--   coarse → process CVD write(→ apps update 가능해야, certs update 는 차단되어야 정상)
insert into public.custom_role_scopes(custom_role_id, scope_type, scope_value, action_scope)
  select cr.id, 'process', p.id::text, 'write'
    from public.custom_roles cr, public.exam_processes p where cr.code='t_coarse' and p.code='CVD';

-- ── 5) 사용자 ↔ custom role 배정 ────────────────────────────────────────────
insert into public.user_custom_roles(user_id, custom_role_id)
  select '__T_CUSTOM_UUID__'::uuid,       id from public.custom_roles where code='t_cvd_read';
insert into public.user_custom_roles(user_id, custom_role_id)
  select '__T_CUSTOM_ALL_UUID__'::uuid,   id from public.custom_roles where code='t_all_read';
insert into public.user_custom_roles(user_id, custom_role_id)
  select '__T_CUSTOM_WRITE_UUID__'::uuid, id from public.custom_roles where code='t_cvd_write';
insert into public.user_custom_roles(user_id, custom_role_id)
  select '__T_COARSE_UUID__'::uuid,       id from public.custom_roles where code='t_coarse';
-- (t_no_menu 는 계정 배정 없이 별도 테스트 시 __T_CUSTOM_UUID__ 재배정으로 확인하거나 계정 추가)

-- 확인(개수만):
-- select 'processes', count(*) from public.exam_processes
-- union all select 'apps', count(*) from public.exam_test_apps
-- union all select 'custom_roles', count(*) from public.custom_roles;
