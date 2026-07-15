-- ============================================================================
-- [진단 전용 — 조회만 합니다. 데이터/정책을 바꾸지 않습니다]
-- 시험관리 인증 기준관리 403 원인 확정용. Supabase SQL Editor 에서 실행 후 결과를 알려주세요.
-- ============================================================================

-- ① 시험 기준정보 테이블의 현재 정책 (403 의 직접 원인)
select tablename, policyname, cmd, roles, qual as using_expr, with_check as check_expr
  from pg_policies
 where schemaname = 'public'
   and tablename in ('exam_categories','exam_groups','exam_parts','exam_processes',
                     'exam_levels','exam_equipment','exam_rules')
 order by tablename, cmd, policyname;

-- ② RLS 활성 여부
select relname, relrowsecurity, relforcerowsecurity
  from pg_class
 where relnamespace = 'public'::regnamespace
   and relname in ('exam_categories','exam_groups','exam_parts','exam_processes',
                   'exam_levels','exam_equipment','exam_rules');

-- ③ 테이블 권한(GRANT) — authenticated 에 insert/update 가 있는지
select table_name, grantee, privilege_type
  from information_schema.role_table_grants
 where table_schema = 'public'
   and table_name in ('exam_categories','exam_groups','exam_parts','exam_processes',
                      'exam_levels','exam_equipment','exam_rules')
   and grantee in ('anon','authenticated')
 order by table_name, grantee, privilege_type;

-- ④ tenant_id 실제 분포 (앱은 'default' 로 저장)
select 'exam_categories' as t, tenant_id, count(*) from public.exam_categories group by 2
union all select 'exam_rules', tenant_id, count(*) from public.exam_rules group by 2;

-- ⑤ 내 계정의 실제 권한 판정값 — 로그인한 브라우저가 아닌 SQL Editor 에서는
--    auth.uid() 가 NULL 이므로, 사용자 이메일로 profiles 를 직접 확인합니다.
select id, role, is_active from public.profiles where id in (select id from auth.users where email = 'thecats12@naver.com');

-- ⑥ 커스텀 액세스 토큰 훅 등록 여부(=JWT 에 role/tenant_id 클레임이 들어가는지)
select * from pg_proc where proname ilike '%access_token%' or proname ilike '%custom_claims%';
