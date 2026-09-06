-- ============================================================================
-- 군대 부서 범위 강제 — POSTCHECK (SELECT ONLY · 실행 무변경)
-- ============================================================================

-- [N1] 신규 helper 2개 존재 + owner + security_definer + volatility + search_path.
--   기대: military_allowed_units(SD=true, stable) · military_unit_in_scope(SD=false, immutable) · 둘 다 search_path=public.
select p.proname, pg_get_function_identity_arguments(p.oid) as args,
       r.rolname as owner, p.prosecdef as security_definer,
       case p.provolatile when 'i' then 'immutable' when 's' then 'stable' when 'v' then 'volatile' end as volatility,
       p.proconfig as settings
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner
 where n.nspname='public' and p.proname in ('military_allowed_units','military_unit_in_scope')
 order by p.proname;

-- [N2] 신규 helper + RPC 실행 ACL — anon 실행 불가 확인.
select p.proname, p.proacl
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('military_allowed_units','military_unit_in_scope','get_military_module_for_current_user')
 order by p.proname;

-- [N3] RPC owner/security_definer/search_path 불변(여전히 postgres/SD/public).
select p.proname, r.rolname as owner, p.prosecdef as security_definer, p.proconfig as settings
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner
 where n.nspname='public' and p.proname='get_military_module_for_current_user';

-- [N4] military_module_data RLS/force_rls 불변.
select c.relname, c.relrowsecurity as rls_enabled, c.relforcerowsecurity as force_rls
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relname='military_module_data';

-- [N5] military_module_data 정책 불변(raw 정책·tenant/ can_read_military_raw 그대로).
select pol.polname,
       case pol.polcmd when 'r' then 'SELECT' when 'a' then 'INSERT' when 'w' then 'UPDATE' when 'd' then 'DELETE' else pol.polcmd::text end as cmd,
       pg_get_expr(pol.polqual, pol.polrelid) as using_expr, pg_get_expr(pol.polwithcheck, pol.polrelid) as check_expr
  from pg_policy pol join pg_class c on c.oid=pol.polrelid join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relname='military_module_data'
 order by cmd, pol.polname;

-- [N6] military_module_data GRANT 불변(anon 없음 · authenticated select/insert/update).
select grantee, privilege_type from information_schema.role_table_grants
 where table_schema='public' and table_name='military_module_data' order by grantee, privilege_type;

-- [N7] 원본 데이터 무변경(행수 + 크기 + md5 체크섬 — apply 전/후 동일해야).
select count(*) as rows,
       sum(pg_column_size(data)) as total_data_bytes,
       md5(string_agg(data::text, '|' order by updated_at)) as data_md5
  from public.military_module_data where tenant_id='default';

-- [N8] ⭐ canonical 매칭 예상 인원(helper 적용 후 · SELECT-only 시뮬레이션).
--   기대: CMP=33(D-CMP16+F-CMP17) · CVD=8(D-CVD3+F-CVD5) · CMP+CVD=41. 빈/NULL unit 은 미포함.
select
  count(*) filter (where public.military_unit_in_scope(p->>'unit', array['CMP']))       as cmp_expect_33,
  count(*) filter (where public.military_unit_in_scope(p->>'unit', array['CVD']))       as cvd_expect_8,
  count(*) filter (where public.military_unit_in_scope(p->>'unit', array['CMP','CVD'])) as cmp_cvd_expect_41,
  count(*) filter (where (p->>'unit' is null or btrim(p->>'unit')='')
                     and public.military_unit_in_scope(p->>'unit', array['CMP','CVD'])) as empty_unit_in_scope_expect_0
  from public.military_module_data d,
       lateral jsonb_array_elements(case when jsonb_typeof(d.data->'militaryPersonnel')='array' then d.data->'militaryPersonnel' else '[]'::jsonb end) p
 where d.tenant_id='default';

-- [N9] canonical 정확성 표본(부서명별 매칭 결과 · PII 없음). D-/F- prefix 제거 후 exact match 확인.
select p->>'unit' as unit,
       public.military_unit_in_scope(p->>'unit', array['CMP','CVD']) as in_cmp_cvd,
       count(*) as cnt
  from public.military_module_data d,
       lateral jsonb_array_elements(case when jsonb_typeof(d.data->'militaryPersonnel')='array' then d.data->'militaryPersonnel' else '[]'::jsonb end) p
 where d.tenant_id='default'
 group by p->>'unit' order by in_cmp_cvd desc, unit;
