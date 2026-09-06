-- ============================================================================
-- 시험 custom-role SELECT 수정(v3) — PRECHECK (SELECT ONLY · 실행 무변경)
--   목적: viewer + custom exam 권한 동시 보유 시 exam_is_viewer_all() 무조건 OR 로 scope 우회하는 버그를 고치기 전,
--         현재 Production 의 exam_cr_restrict_select 7개 정책 원문을 캡처(= rollback 원본) 하고 helper 존재를 재확인.
--   ⚠ CREATE/ALTER/DROP/DML/GRANT/POLICY/DO/EXECUTE 없음. 블록 단위 실행.
-- ============================================================================

-- [S1] 수정 대상 7개 SELECT 정책의 현재 원문(= 적용 직전 rollback 원본으로 보존).
select c.relname as table_name, pol.polname,
       case when pol.polpermissive then 'PERMISSIVE' else 'RESTRICTIVE' end as kind,
       pg_get_expr(pol.polqual, pol.polrelid) as using_expr
  from pg_policy pol
  join pg_class c on c.oid = pol.polrelid
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and pol.polname = 'exam_cr_restrict_select'
   and c.relname in ('exam_personnel','exam_applications','pm_certifications','dm_certifications',
                     'exam_annual_targets','exam_monthly_results','exam_results')
 order by c.relname;

-- [S2] 현재 원문에 exam_is_viewer_all( 이 "독립 OR 분기"로 존재하는지(버그 지표) 확인.
--   기대(수정 전): 7개 모두 using_expr 에 exam_is_viewer_all 포함(=버그). 수정 후: 0.
select c.relname as table_name,
       (pg_get_expr(pol.polqual, pol.polrelid) ilike '%exam_is_viewer_all%') as has_viewer_all_branch
  from pg_policy pol join pg_class c on c.oid=pol.polrelid join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and pol.polname='exam_cr_restrict_select'
   and c.relname in ('exam_personnel','exam_applications','pm_certifications','dm_certifications',
                     'exam_annual_targets','exam_monthly_results','exam_results')
 order by c.relname;

-- [S3] 수정이 재사용할 helper 존재 재확인(모두 true 기대).
select fn, (to_regprocedure(fn) is not null) as exists
  from (values ('public.exam_has_any_custom_perm()'),
               ('public.exam_custom_menu_ok(text,text)'),
               ('public.exam_custom_process_ok(uuid,text)'),
               ('public.exam_is_admin(uuid)'),
               ('public.is_exam_admin()'),
               ('public.exam_scope_readable(uuid,uuid)')) as t(fn)
 order by fn;

-- [S4] 실검증 사용자 상황 재현용(개수만 · PII 없음): viewer 이면서 활성 custom exam 권한 보유 사용자 수.
--   기대: >=1(TEST 사용자). 이들이 수정 후 scope 로 제한될 대상.
select count(distinct ucr.user_id) as viewer_with_custom_exam
  from public.user_custom_roles ucr
  join public.custom_roles r on r.id = ucr.custom_role_id
  join public.custom_role_permissions crp on crp.custom_role_id = r.id
  join public.profiles p on p.id = ucr.user_id
 where ucr.is_active and ucr.deleted_at is null
   and (ucr.valid_from is null or ucr.valid_from<=now()) and (ucr.valid_until is null or ucr.valid_until>=now())
   and r.is_active and r.is_deleted=false and r.deleted_at is null
   and crp.is_active and crp.effect='allow' and crp.deleted_at is null
   and split_part(crp.permission_key,'.',1) like 'exam%'
   and p.role='viewer' and coalesce(p.is_active,true);
