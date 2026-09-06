-- ============================================================================
-- 시험관리 custom-role 강제 연결 — Production 진실 확정용 READ-ONLY 감사 (SELECT ONLY)
--
--   ⚠ 이 파일은 조회만 한다.
--      CREATE/ALTER/DROP · CREATE OR REPLACE · INSERT/UPDATE/DELETE/MERGE/TRUNCATE
--      · GRANT/REVOKE · POLICY 변경 · DO/EXECUTE/CALL · SET ROLE/RESET · db reset  전부 없음.
--   ⚠ 모든 statement 는 SELECT(또는 WITH ... SELECT) 뿐. 자동 실행되지 않음.
--   ⚠ PII 조회 금지: 이메일/이름/전화/주민 등 개인 식별 컬럼을 절대 select 하지 않는다.
--      집계(count/sum)와 카탈로그 메타데이터(pg_catalog/information_schema)만 조회.
--
--   [사용법] Supabase SQL Editor 는 "마지막 result set"만 보일 수 있으므로,
--      아래 블록 [A]~[L] 을 "한 블록씩" 실행하고 각 결과를 캡처한다.
--      각 블록은 세미콜론으로 끝나는 단일 SELECT 라 독립 실행 가능하다.
-- ============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- [A] exam RLS helper 실제 원문 (rollback 원본으로 그대로 보존할 것)
--     필수: exam_role_of / exam_scope_readable / exam_scope_allows 전체 원문.
-- ─────────────────────────────────────────────────────────────────────────────
select p.proname,
       pg_get_function_identity_arguments(p.oid) as args,
       pg_get_functiondef(p.oid)                 as definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('exam_role_of','exam_scope_readable','exam_scope_allows',
                     'exam_is_super','exam_is_admin','exam_is_viewer_all','exam_can_access',
                     'exam_custom_role_has_perm','exam_custom_role_scope')
 order by p.proname, args;


-- ─────────────────────────────────────────────────────────────────────────────
-- [B] 함수 메타데이터: owner · security_definer · search_path(proconfig) · 실행 ACL
-- ─────────────────────────────────────────────────────────────────────────────
select p.proname,
       pg_get_function_identity_arguments(p.oid) as args,
       r.rolname     as owner,
       p.prosecdef   as security_definer,
       p.proconfig   as settings,        -- search_path 확인
       p.proacl      as execute_acl       -- anon 실행 불가 확인
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_roles r     on r.oid = p.proowner
 where n.nspname = 'public'
   and p.proname in ('exam_role_of','exam_scope_readable','exam_scope_allows',
                     'exam_is_super','exam_is_admin','exam_is_viewer_all','exam_can_access',
                     'exam_custom_role_has_perm','exam_custom_role_scope')
 order by p.proname, args;


-- ─────────────────────────────────────────────────────────────────────────────
-- [C] exam 관련 실제 RLS policy 목록 + qual/with_check + 역할
--     대상: exam 스코프 테이블 7종(정책이 어떤 helper 를 호출하는지 확인).
--     ※ 괄호로 스키마 필터를 정확히 묶는다(스키마 누수 방지).
-- ─────────────────────────────────────────────────────────────────────────────
select c.relname as table_name,
       pol.polname,
       case pol.polcmd when 'r' then 'SELECT' when 'a' then 'INSERT'
                       when 'w' then 'UPDATE' when 'd' then 'DELETE' else pol.polcmd::text end as cmd,
       pol.polpermissive as permissive,
       coalesce((select array_agg(rolname) from pg_roles where oid = any(pol.polroles)), '{public}') as roles,
       pg_get_expr(pol.polqual,      pol.polrelid) as using_expr,
       pg_get_expr(pol.polwithcheck, pol.polrelid) as check_expr
  from pg_policy pol
  join pg_class     c on c.oid = pol.polrelid
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relname in ('exam_personnel','exam_applications','pm_certifications','dm_certifications',
                     'exam_annual_targets','exam_monthly_results','exam_results')
 order by c.relname, cmd, pol.polname;


-- ─────────────────────────────────────────────────────────────────────────────
-- [D-1] 각 대상 테이블: RLS enabled · force_rls · process_id 컬럼 존재 여부
-- ─────────────────────────────────────────────────────────────────────────────
select c.relname as table_name,
       c.relrowsecurity  as rls_enabled,
       c.relforcerowsecurity as force_rls,
       exists (select 1 from pg_attribute a
                where a.attrelid = c.oid and a.attname = 'process_id' and not a.attisdropped) as has_process_id
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relkind = 'r'
   and c.relname in ('exam_personnel','exam_applications','pm_certifications','dm_certifications',
                     'exam_annual_targets','exam_monthly_results','exam_results')
 order by c.relname;

-- [D-2] 각 대상 테이블의 PK/FK (exam_results ↔ exam_personnel 연결 구조 포함)
select c.relname as table_name,
       con.conname,
       case con.contype when 'p' then 'PK' when 'f' then 'FK' when 'u' then 'UNIQUE'
                        when 'c' then 'CHECK' else con.contype::text end as kind,
       pg_get_constraintdef(con.oid) as definition
  from pg_constraint con
  join pg_class     c on c.oid = con.conrelid
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relname in ('exam_personnel','exam_applications','pm_certifications','dm_certifications',
                     'exam_annual_targets','exam_monthly_results','exam_results')
 order by c.relname, kind, con.conname;


-- ─────────────────────────────────────────────────────────────────────────────
-- [E] exam_user_process_scopes 실제 컬럼 / constraint / index (direct scope — 변경 금지 대상)
-- ─────────────────────────────────────────────────────────────────────────────
-- [E-1] 컬럼
select column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'public' and table_name = 'exam_user_process_scopes'
 order by ordinal_position;

-- [E-2] constraint
select con.conname,
       case con.contype when 'p' then 'PK' when 'f' then 'FK' when 'u' then 'UNIQUE'
                        when 'c' then 'CHECK' else con.contype::text end as kind,
       pg_get_constraintdef(con.oid) as definition
  from pg_constraint con
  join pg_class c on c.oid = con.conrelid
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname = 'exam_user_process_scopes'
 order by kind, con.conname;

-- [E-3] index
select indexname, indexdef
  from pg_indexes
 where schemaname = 'public' and tablename = 'exam_user_process_scopes'
 order by indexname;


-- ─────────────────────────────────────────────────────────────────────────────
-- [F] user_custom_roles 실제 컬럼 / constraint / index
-- ─────────────────────────────────────────────────────────────────────────────
-- [F-1] 컬럼
select column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'public' and table_name = 'user_custom_roles'
 order by ordinal_position;

-- [F-2] constraint
select con.conname,
       case con.contype when 'p' then 'PK' when 'f' then 'FK' when 'u' then 'UNIQUE'
                        when 'c' then 'CHECK' else con.contype::text end as kind,
       pg_get_constraintdef(con.oid) as definition
  from pg_constraint con
  join pg_class c on c.oid = con.conrelid
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname = 'user_custom_roles'
 order by kind, con.conname;

-- [F-3] index
select indexname, indexdef
  from pg_indexes
 where schemaname = 'public' and tablename = 'user_custom_roles'
 order by indexname;


-- ─────────────────────────────────────────────────────────────────────────────
-- [G] custom_role_permissions / custom_role_scopes 실제 컬럼
--     확인 대상 컬럼: permission_key · effect · action_scope · is_active
--                    · valid_from · valid_until · deleted_at 등 존재 여부.
-- ─────────────────────────────────────────────────────────────────────────────
select table_name, column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'public'
   and table_name in ('custom_role_permissions','custom_role_scopes')
 order by table_name, ordinal_position;


-- ─────────────────────────────────────────────────────────────────────────────
-- [H] 실제 exam permission_key 분포(개수 중심 · PII 없음)
-- ─────────────────────────────────────────────────────────────────────────────
select split_part(crp.permission_key, '.', 1) as tab,
       split_part(crp.permission_key, '.', 2) as action,
       count(*) as cnt
  from public.custom_role_permissions crp
 where crp.is_active
   and split_part(crp.permission_key, '.', 1) like 'exam%'
 group by 1, 2
 order by 1, 2;


-- ─────────────────────────────────────────────────────────────────────────────
-- [I] 실제 custom role process scope 분포(개수만 · UUID/PII 원문 미출력)
--     action_scope별 · 'all' 개수 · orphan 개수 · tenant별 개수.
-- ─────────────────────────────────────────────────────────────────────────────
-- [I-1] action_scope별 + 'all' 개수
select coalesce(s.action_scope,'(null)') as action_scope,
       count(*)                              as total,
       sum((s.scope_value = 'all')::int)     as all_cnt,
       sum((s.scope_value <> 'all')::int)    as specific_cnt
  from public.custom_role_scopes s
 where s.is_active and s.scope_type = 'process' and s.deleted_at is null
 group by s.action_scope
 order by s.action_scope;

-- [I-2] tenant별 개수
select s.tenant_id, count(*) as process_scope_cnt
  from public.custom_role_scopes s
 where s.is_active and s.scope_type = 'process' and s.deleted_at is null
 group by s.tenant_id
 order by s.tenant_id;

-- [I-3] orphan(특정 process_id 인데 exam_processes 에 매핑 안 됨) 개수
select count(*)         as total_specific,
       count(ep.id)     as resolvable,
       count(*) - count(ep.id) as orphan
  from public.custom_role_scopes s
  left join public.exam_processes ep
         on ep.id::text = s.scope_value and ep.deleted_at is null
 where s.is_active and s.scope_type = 'process'
   and s.scope_value <> 'all' and s.deleted_at is null;


-- ─────────────────────────────────────────────────────────────────────────────
-- [J] 현재 user_custom_roles 활성 연결 수(개수만)
-- ─────────────────────────────────────────────────────────────────────────────
select count(*)                       as ucr_rows,
       count(*) filter (where is_active) as active_links,
       count(distinct user_id) filter (where is_active) as distinct_active_users,
       count(distinct custom_role_id) filter (where is_active) as distinct_active_roles
  from public.user_custom_roles;


-- ─────────────────────────────────────────────────────────────────────────────
-- [K] 현재 exam 역할 분포(count only · PII 금지)
--     admin / viewer / 명시 exam_role / custom-role 연결 사용자 수.
-- ─────────────────────────────────────────────────────────────────────────────
select
  count(*) filter (where role = 'admin'  and coalesce(is_active,true)) as admin_cnt,
  count(*) filter (where role = 'viewer' and coalesce(is_active,true)) as viewer_cnt,
  count(*) filter (where exam_role is not null and coalesce(is_active,true)) as explicit_exam_role_cnt,
  (select count(distinct ucr.user_id)
     from public.user_custom_roles ucr where ucr.is_active)             as custom_role_linked_users
  from public.profiles;


-- ─────────────────────────────────────────────────────────────────────────────
-- [L] 관련 인덱스 존재 여부(생성하지 않음 · 확인만)
-- ─────────────────────────────────────────────────────────────────────────────
select tablename, indexname, indexdef
  from pg_indexes
 where schemaname = 'public'
   and tablename in ('user_custom_roles','custom_role_permissions','custom_role_scopes',
                     'exam_user_process_scopes')
 order by tablename, indexname;
