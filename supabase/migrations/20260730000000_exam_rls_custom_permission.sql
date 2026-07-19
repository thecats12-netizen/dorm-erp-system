-- ============================================================================
-- 시험관리 쓰기 RLS ↔ 사용자 정의 권한 정합 (P0-3)
--
-- [문제]
--   20260716000000_fix_exam_all_tables_rls.sql 는 시험 18개 테이블의
--   INSERT/UPDATE 를 public.is_exam_admin()(=profiles.role='admin') 전용으로 만들었다.
--   따라서 시스템 역할이 viewer 인 "사용자 정의(시험관리) 권한" 계정은 UI 에서
--   수정 버튼이 보여도 실제 저장 시 42501(RLS) → HTTP 403 으로 차단된다.
--   (프론트 selected_only 권한이 DB 에 반영되지 않는 상태 = 권한 정합 불일치)
--
-- [수정 — 최소 보완]
--   INSERT/UPDATE 정책을 "관리자 OR 해당 메뉴×기능의 사용자 정의 권한 보유"로 확장한다.
--   · 이미 존재하는 헬퍼 public.crp_user_has_permission(permission_key) 를 재사용한다
--     (20260722000000 / 20260723000000). 이 함수는 현재 사용자의 활성 custom role 이
--     effect='allow' 로 그 permission_key 를 가지며 tenant 가 일치할 때만 true.
--   · permission_key 는 코드 카탈로그와 동일: '<tabKey>.create' / '<tabKey>.update'
--     (permissionCatalog.ts). 테이블→탭 매핑은 아래 표와 같다.
--   · SELECT 정책(can_read_exam_master)·관리자 경로·tenant_id not null·DELETE 미부여는 유지.
--   · authenticated/viewer 전체 쓰기 허용 아님. 다른 tenant 쓰기 불가(함수가 tenant 검증).
--   · 재실행 안전(drop policy if exists + create). 컬럼/데이터/FK 변경 없음.
--
-- [선행]
--   20260716000000_fix_exam_all_tables_rls.sql (is_exam_admin/can_read_exam_master)
--   20260722000000_security_hardening.sql 또는 20260723000000_permission_system_repair.sql
--     (crp_user_has_permission). 미적용이면 아래에서 즉시 예외로 중단(안전).
--
-- ※ 자동 실행 금지. Supabase SQL Editor 에서 검토 후 1회 수동 실행.
--    롤백: 20260730000000_exam_rls_custom_permission_rollback.sql
-- ============================================================================

do $do$
declare
  rec       record;
  has_tenant boolean;
  tcheck    text;
begin
  -- 선행 함수 확인(미적용 시 관리자 정책이 훼손되지 않도록 즉시 중단).
  if to_regprocedure('public.crp_user_has_permission(text)') is null then
    raise exception '선행 마이그레이션 필요: crp_user_has_permission (20260722/20260723 미적용). 먼저 적용 후 재실행하세요.';
  end if;
  if to_regprocedure('public.is_exam_admin()') is null then
    raise exception '선행 마이그레이션 필요: is_exam_admin (20260716 미적용). 먼저 적용 후 재실행하세요.';
  end if;

  -- 테이블 → 권한 탭키 매핑(기준정보 7종은 단일 탭 examRules).
  for rec in
    select * from (values
      ('exam_categories',     'examRules'),
      ('exam_groups',         'examRules'),
      ('exam_parts',          'examRules'),
      ('exam_processes',      'examRules'),
      ('exam_levels',         'examRules'),
      ('exam_equipment',      'examRules'),
      ('exam_rules',          'examRules'),
      ('exam_personnel',      'examPersonnel'),
      ('exam_sessions',       'examApplications'),
      ('exam_applications',   'examApplications'),
      ('exam_results',        'examApplications'),
      ('pm_certifications',   'examPmCertifications'),
      ('dm_certifications',   'examDmCertifications'),
      ('exam_annual_targets', 'examAnnualTargets'),
      ('exam_monthly_results','examMonthlyResults'),
      ('exam_import_jobs',    'examExcelImport'),
      ('exam_import_errors',  'examExcelImport')
    ) as m(tbl, tabkey)
  loop
    if to_regclass('public.' || quote_ident(rec.tbl)) is null then
      raise notice '건너뜀(테이블 없음): %', rec.tbl;
      continue;
    end if;

    select exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = rec.tbl and column_name = 'tenant_id'
    ) into has_tenant;
    tcheck := case when has_tenant then ' and tenant_id is not null' else '' end;

    -- INSERT: 관리자 OR '<tab>.create' 보유 (+ tenant_id 필수)
    execute format('drop policy if exists %I on public.%I', 'exam_master_insert', rec.tbl);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check ((public.is_exam_admin() or public.crp_user_has_permission(%L))%s)',
      'exam_master_insert', rec.tbl, rec.tabkey || '.create', tcheck
    );

    -- UPDATE: 관리자 OR '<tab>.update' (USING=대상행, WITH CHECK=변경후행 → tenant 변조 차단)
    execute format('drop policy if exists %I on public.%I', 'exam_master_update', rec.tbl);
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.is_exam_admin() or public.crp_user_has_permission(%L)) with check ((public.is_exam_admin() or public.crp_user_has_permission(%L))%s)',
      'exam_master_update', rec.tbl, rec.tabkey || '.update', rec.tabkey || '.update', tcheck
    );
  end loop;

  -- 감사로그: append-only(업데이트/삭제 정책 없음). custom 사용자 작업도 감사가 남도록,
  --  활성 로그인 사용자면 자신의 tenant 로 INSERT 허용(과도 완화 아님 — 조회 가능 사용자 한정 + tenant 고정).
  if to_regclass('public.exam_audit_logs') is not null then
    execute 'drop policy if exists exam_master_insert on public.exam_audit_logs';
    execute 'create policy exam_master_insert on public.exam_audit_logs for insert to authenticated with check ((public.is_exam_admin() or public.can_read_exam_master()) and tenant_id is not null)';
  end if;
end
$do$;
